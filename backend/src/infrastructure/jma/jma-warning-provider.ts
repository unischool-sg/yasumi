import type { Warning } from "@yasumi/shared";
import type { WarningFetchResult, WarningProvider } from "../../domain/warning/provider.ts";
import { type JmaWarningJson, parseJmaWarnings } from "./parse.ts";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface JmaWarningProviderOptions {
  /** 差し替え可能な fetch（テスト用）。既定はグローバル fetch。 */
  fetchFn?: FetchFn;
  /** 都道府県 JSON のキャッシュ TTL(ms)。既定 90 秒（§33）。 */
  cacheTtlMs?: number;
  /** 現在時刻(ms)。テスト用に注入可能。 */
  now?: () => number;
  /** 地域コード → 名称の解決（M3 の areas で注入）。 */
  resolveAreaName?: (code: string) => string;
  /** fetch タイムアウト(ms)。既定 10 秒。 */
  timeoutMs?: number;
  /** 取得失敗時の追加リトライ回数（初回を除く）。既定 2（計3回試行）。 */
  maxRetries?: number;
  /** リトライ間隔(ms)。既定 1500。JMA 更新境界の一瞬の 5xx を跨ぐため。 */
  retryDelayMs?: number;
  /** リトライ待機（テスト用に注入可能）。既定は setTimeout ベース。 */
  sleep?: (ms: number) => Promise<void>;
}

const JMA_WARNING_URL = "https://www.jma.go.jp/bosai/warning/data/warning";

interface CacheEntry {
  at: number;
  json: JmaWarningJson;
}

/**
 * 気象庁防災情報から警報を取得する WarningProvider 実装（backend/JMA_ADAPTER.md）。
 * - 都道府県単位でバッチ取得し TTL キャッシュで学校間共有（§33）
 * - 各 office(府県予報区) の取得はタイムアウト付き＋短間隔リトライ（更新境界の一時的 5xx を吸収）
 * - リトライ後も失敗した office は例外にせず failedOfficeCodes で返す（該当地域のみ UNKNOWN / §51）
 */
export class JmaWarningProvider implements WarningProvider {
  private readonly fetchFn: FetchFn;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly resolveAreaName: ((code: string) => string) | undefined;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: JmaWarningProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.cacheTtlMs = options.cacheTtlMs ?? 90_000;
    this.now = options.now ?? (() => Date.now());
    this.resolveAreaName = options.resolveAreaName;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 1500;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async getActiveWarnings(areaCodes: string[]): Promise<WarningFetchResult> {
    const officeCodes = uniqueOfficeCodes(areaCodes);
    const requested = [...new Set(areaCodes)];

    const warnings: Warning[] = [];
    const failedOfficeCodes: string[] = [];
    for (const officeCode of officeCodes) {
      let json: JmaWarningJson;
      try {
        json = await this.fetchPrefecture(officeCode);
      } catch (e) {
        // リトライ後も失敗 → 例外にせず記録（該当 office の学校のみ UNKNOWN）。
        console.error(`[jma] office ${officeCode} fetch failed:`, describeError(e));
        failedOfficeCodes.push(officeCode);
        continue;
      }
      const parsed = parseJmaWarnings(json, requested, {
        ...(this.resolveAreaName ? { resolveAreaName: this.resolveAreaName } : {}),
      });
      for (const w of parsed) {
        if (w.status === "active") warnings.push(w);
      }
    }
    return { warnings, failedOfficeCodes };
  }

  private async fetchPrefecture(prefCode: string): Promise<JmaWarningJson> {
    const cached = this.cache.get(prefCode);
    if (cached && this.now() - cached.at < this.cacheTtlMs) {
      return cached.json;
    }

    const url = `${JMA_WARNING_URL}/${prefCode}.json`;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryDelayMs);
      try {
        return await this.fetchOnce(url, prefCode);
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`JMA fetch failed after ${this.maxRetries + 1} attempts: ${url}`, {
      cause: lastError,
    });
  }

  /** 1 回分の取得（タイムアウト付き）。失敗は例外。 */
  private async fetchOnce(url: string, prefCode: string): Promise<JmaWarningJson> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      throw new Error(`JMA fetch error: ${url}`, { cause });
    }
    if (!res.ok) {
      throw new Error(`JMA fetch HTTP ${res.status}: ${url}`);
    }

    let json: JmaWarningJson;
    try {
      json = (await res.json()) as JmaWarningJson;
    } catch (cause) {
      throw new Error(`JMA response parse failed: ${url}`, { cause });
    }

    this.cache.set(prefCode, { at: this.now(), json });
    return json;
  }
}

/** ログ用にエラーを短く整形（HTTP ステータス/接続エラーの種別を残す）。 */
function describeError(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof Error) return `${e.message} <- ${cause.name}: ${cause.message}`;
    return e.message;
  }
  return String(e);
}

/**
 * 気象庁 warning JSON は府県予報区(office)単位のファイル。多くの県は `${pref}0000` だが、
 * 北海道・鹿児島・沖縄は複数 office に分割され `${pref}0000.json` が存在しない（404）。
 * 該当県は県内の全 office を対象にする（parse は要求コードのみ一致させるので余分な office は無害）。
 * office 一覧は気象庁 area.json の offices（府県予報区）から取得（2026-09 時点）。
 */
const PREF_OFFICES: Record<string, string[]> = {
  "01": ["011000", "012000", "013000", "014030", "014100", "015000", "016000", "017000"], // 北海道
  "46": ["460040", "460100"], // 鹿児島県（奄美地方 / それ以外）
  "47": ["471000", "472000", "473000", "474000"], // 沖縄県（本島 / 大東島 / 宮古島 / 八重山）
};

/** 地域コード（例 2820900）→ 対応する office JSON コード群（単一県なら1件）。 */
export function officeCodesForArea(areaCode: string): string[] {
  const pref = areaCode.slice(0, 2);
  return PREF_OFFICES[pref] ?? [`${pref}0000`];
}

/** 地域コード群 → 取得すべき office JSON コード群（重複排除）。 */
function uniqueOfficeCodes(areaCodes: string[]): string[] {
  const set = new Set<string>();
  for (const code of areaCodes) {
    for (const office of officeCodesForArea(code)) set.add(office);
  }
  return [...set];
}
