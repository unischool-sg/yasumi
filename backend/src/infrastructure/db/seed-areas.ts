import { getDb } from "./client.ts";
import areasJapan from "./areas-japan.json";
import type { AreaRow } from "./repositories/areas.ts";
import { upsertAreas } from "./repositories/areas.ts";

/**
 * 気象庁地域コード（class20s / 全国の市区町村）を投入する。
 * データは `areas-japan.json`（気象庁 area.json の class20s 全件を抽出したもの）。
 * 追加/更新は upsert なので何度実行しても安全。
 */
export const AREA_SEED: AreaRow[] = areasJapan as AreaRow[];

const CHUNK = 500;

if (import.meta.main) {
  const db = getDb();
  for (let i = 0; i < AREA_SEED.length; i += CHUNK) {
    await upsertAreas(db, AREA_SEED.slice(i, i + CHUNK));
  }
  console.log(`[seed] areas upserted: ${AREA_SEED.length}（全国 ${new Set(AREA_SEED.map((a) => a.prefecture)).size} 都道府県）`);
  process.exit(0);
}
