import type { Warning } from "@yasumi/shared";
import type { WarningProvider } from "../../domain/warning/provider.ts";
import { type JmaWarningJson, parseJmaWarnings } from "./parse.ts";

type FetchFn = (url: string) => Promise<Response>;

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
}

const JMA_WARNING_URL = "https://www.jma.go.jp/bosai/warning/data/warning";

interface CacheEntry {
  at: number;
  json: JmaWarningJson;
}

/**
 * 気象庁防災情報から警報を取得する WarningProvider 実装（backend/JMA_ADAPTER.md）。
 * - 都道府県単位でバッチ取得し TTL キャッシュで学校間共有（§33）
 * - 取得失敗は例外（呼び出し側で UNKNOWN / §51）
 */
export class JmaWarningProvider implements WarningProvider {
  private readonly fetchFn: FetchFn;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly resolveAreaName: ((code: string) => string) | undefined;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: JmaWarningProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((url) => fetch(url));
    this.cacheTtlMs = options.cacheTtlMs ?? 90_000;
    this.now = options.now ?? (() => Date.now());
    this.resolveAreaName = options.resolveAreaName;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getActiveWarnings(areaCodes: string[]): Promise<Warning[]> {
    const prefCodes = uniquePrefCodes(areaCodes);
    const requested = [...new Set(areaCodes)];

    const warnings: Warning[] = [];
    for (const prefCode of prefCodes) {
      const json = await this.fetchPrefecture(prefCode);
      const parsed = parseJmaWarnings(json, requested, {
        ...(this.resolveAreaName ? { resolveAreaName: this.resolveAreaName } : {}),
      });
      for (const w of parsed) {
        if (w.status === "active") warnings.push(w);
      }
    }
    return warnings;
  }

  private async fetchPrefecture(prefCode: string): Promise<JmaWarningJson> {
    const cached = this.cache.get(prefCode);
    if (cached && this.now() - cached.at < this.cacheTtlMs) {
      return cached.json;
    }

    const url = `${JMA_WARNING_URL}/${prefCode}.json`;
    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch (cause) {
      throw new Error(`JMA fetch failed: ${url}`, { cause });
    }
    if (!res.ok) {
      throw new Error(`JMA fetch failed: ${url} (HTTP ${res.status})`);
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

/** 地域コード（例 280010）→ 都道府県 JSON コード（例 280000）に変換し重複排除。 */
function uniquePrefCodes(areaCodes: string[]): string[] {
  const set = new Set<string>();
  for (const code of areaCodes) {
    set.add(`${code.slice(0, 2)}0000`);
  }
  return [...set];
}
