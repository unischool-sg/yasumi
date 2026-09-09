import type { Warning } from "@yasumi/shared";
import { resolveWarningName } from "./warning-codes.ts";

/** 気象庁 bosai warning JSON の必要部分（backend/JMA_ADAPTER.md §2）。 */
export interface JmaWarningJson {
  reportDatetime: string;
  publishingOffice?: string;
  headlineText?: string;
  areaTypes: {
    areas: {
      code: string;
      warnings: { code?: string; status: string }[];
    }[];
  }[];
}

interface ParseOptions {
  /** 地域コード → 名称。未指定ならコードをそのまま名称に使う（M3 の areas で解決）。 */
  resolveAreaName?: (code: string) => string;
}

/**
 * 気象庁固有の JSON を内部 `Warning[]` に正規化する純粋関数（PRD §31, §32）。
 * requestedAreaCodes に含まれる地域のみ対象。code なし（発表なし）はスキップ。
 * active(発表/継続) と cancelled(解除) の両方を返す（利用側で絞り込む）。
 */
export function parseJmaWarnings(
  json: JmaWarningJson,
  requestedAreaCodes: string[],
  opts: ParseOptions = {},
): Warning[] {
  const requested = new Set(requestedAreaCodes);
  const issuedAt = new Date(json.reportDatetime);
  const resolveAreaName = opts.resolveAreaName ?? ((code: string) => code);

  const result: Warning[] = [];
  for (const areaType of json.areaTypes) {
    for (const area of areaType.areas) {
      if (!requested.has(area.code)) continue;
      for (const w of area.warnings) {
        if (!w.code) continue; // 「発表警報・注意報はなし」等はスキップ
        result.push({
          areaCode: area.code,
          areaName: resolveAreaName(area.code),
          warningType: resolveWarningName(w.code),
          status: w.status === "解除" ? "cancelled" : "active",
          issuedAt,
        });
      }
    }
  }
  return result;
}
