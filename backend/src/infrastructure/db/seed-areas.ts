import { getDb } from "./client.ts";
import type { AreaRow } from "./repositories/areas.ts";
import { upsertAreas } from "./repositories/areas.ts";

/**
 * 気象庁地域コード（class20s / 市区町村）の初期シード。
 * まず PRD §13 の兵庫県・阪神地域を投入する。コードは JMA area.json 由来。
 * 対象地域は随時追加していく（`make seed`）。
 */
export const AREA_SEED: AreaRow[] = [
  // 神戸市（市＋区）
  { code: "2810100", name: "神戸市", prefecture: "兵庫県" },
  { code: "2810200", name: "神戸市東灘区", prefecture: "兵庫県" },
  { code: "2810500", name: "神戸市兵庫区", prefecture: "兵庫県" },
  { code: "2810600", name: "神戸市北区", prefecture: "兵庫県" },
  { code: "2810700", name: "神戸市中央区", prefecture: "兵庫県" },
  { code: "2810800", name: "神戸市西区", prefecture: "兵庫県" },
  { code: "2810900", name: "神戸市須磨区", prefecture: "兵庫県" },
  { code: "2811000", name: "神戸市垂水区", prefecture: "兵庫県" },
  { code: "2811100", name: "神戸市長田区", prefecture: "兵庫県" },
  // 阪神地域
  { code: "2820200", name: "尼崎市", prefecture: "兵庫県" },
  { code: "2820600", name: "西宮市", prefecture: "兵庫県" },
  { code: "2820700", name: "芦屋市", prefecture: "兵庫県" },
  { code: "2821400", name: "伊丹市", prefecture: "兵庫県" },
  { code: "2821900", name: "宝塚市", prefecture: "兵庫県" },
  { code: "2830100", name: "川西市", prefecture: "兵庫県" },
  { code: "2834100", name: "三田市", prefecture: "兵庫県" },
  { code: "2836500", name: "猪名川町", prefecture: "兵庫県" },
];

if (import.meta.main) {
  const db = getDb();
  await upsertAreas(db, AREA_SEED);
  console.log(`[seed] areas upserted: ${AREA_SEED.length}`);
  process.exit(0);
}
