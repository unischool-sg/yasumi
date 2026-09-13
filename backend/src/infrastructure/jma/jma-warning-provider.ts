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
 * - 各県の取得はタイムアウト付き＋短間隔リトライ（更新境界の一時的 5xx を吸収）
 * - リトライ後も失敗した県は例外にせず failedPrefCodes で返す（該当県のみ UNKNOWN / §51）
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
    const prefCodes = uniquePrefCodes(areaCodes);
    const requested = [...new Set(areaCodes)];

    const warnings: Warning[] = [];
    const failedPrefCodes: string[] = [];
    for (const prefCode of prefCodes) {
      let json: JmaWarningJson;
      try {
        json = await this.fetchPrefecture(prefCode);
      } catch (e) {
        // リトライ後も失敗 → 例外にせず記録（該当県の学校のみ UNKNOWN）。
        console.error(`[jma] prefecture ${prefCode} fetch failed:`, describeError(e));
        failedPrefCodes.push(prefCode);
        continue;
      }
      const parsed = parseJmaWarnings(json, requested, {
        ...(this.resolveAreaName ? { resolveAreaName: this.resolveAreaName } : {}),
      });
      for (const w of parsed) {
        if (w.status === "active") warnings.push(w);
      }
    }
    return { warnings, failedPrefCodes };
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

/** 地域コード（例 280010）→ 都道府県 JSON コード（例 280000）に変換し重複排除。 */
function uniquePrefCodes(areaCodes: string[]): string[] {
  const set = new Set<string>();
  for (const code of areaCodes) {
    set.add(`${code.slice(0, 2)}0000`);
  }
  return [...set];
}
