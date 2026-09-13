import { describe, expect, it } from "bun:test";
import { JmaWarningProvider, officeCodesForArea } from "./jma-warning-provider.ts";
import type { JmaWarningJson } from "./parse.ts";

const SANDA = "2820900"; // 兵庫県三田市（7桁市区町村コード）
const KOBE = "2810000"; // 兵庫県神戸市
const OSAKA = "2710000"; // 別都道府県（大阪市）
const NAHA = "4720100"; // 沖縄県那覇市（office は 471000）
const SAPPORO = "0110000"; // 北海道札幌市（office は 016000）

function response(json: JmaWarningJson): Response {
  return new Response(JSON.stringify(json), { status: 200 });
}

function jmaJson(areas: JmaWarningJson["areaTypes"][number]["areas"]): JmaWarningJson {
  return { reportDatetime: "2026-09-09T08:00:00+09:00", areaTypes: [{ areas }] };
}

// リトライ待機を即時化（テスト高速化）。
const noSleep = async () => {};

describe("JmaWarningProvider", () => {
  it("V1: 同一都道府県の複数地域 → 取得は1回（バッチ/キャッシュ §33）", async () => {
    let calls = 0;
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        calls++;
        return response(
          jmaJson([
            { code: SANDA, warnings: [{ code: "05", status: "発表" }] },
            { code: KOBE, warnings: [{ code: "03", status: "発表" }] },
          ]),
        );
      },
    });
    const { warnings, failedOfficeCodes } = await provider.getActiveWarnings([SANDA, KOBE]);
    expect(calls).toBe(1);
    expect(warnings).toHaveLength(2);
    expect(failedOfficeCodes).toHaveLength(0);
  });

  it("V1b: 異なる都道府県 → 都道府県ぶん取得", async () => {
    const urls: string[] = [];
    const provider = new JmaWarningProvider({
      fetchFn: async (url) => {
        urls.push(url);
        return response(jmaJson([]));
      },
    });
    await provider.getActiveWarnings([SANDA, OSAKA]);
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => u.includes("280000.json"))).toBe(true);
    expect(urls.some((u) => u.includes("270000.json"))).toBe(true);
  });

  it("V2: HTTP エラー → リトライ後も失敗した県は failedOfficeCodes（例外にしない / §51）", async () => {
    let calls = 0;
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        calls++;
        return new Response("", { status: 500 });
      },
      maxRetries: 2,
      sleep: noSleep,
    });
    const { warnings, failedOfficeCodes } = await provider.getActiveWarnings([SANDA]);
    expect(warnings).toHaveLength(0);
    expect(failedOfficeCodes).toEqual(["280000"]);
    expect(calls).toBe(3); // 初回 + リトライ2
  });

  it("V2b: fetch reject → リトライ後も失敗した県は failedOfficeCodes（§51）", async () => {
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        throw new Error("network down");
      },
      maxRetries: 1,
      sleep: noSleep,
    });
    const { failedOfficeCodes } = await provider.getActiveWarnings([SANDA]);
    expect(failedOfficeCodes).toEqual(["280000"]);
  });

  it("V2c: 一時的失敗 → リトライで回復（取りこぼさない）", async () => {
    let calls = 0;
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        calls++;
        if (calls === 1) return new Response("", { status: 503 }); // 更新境界の一瞬の 5xx
        return response(jmaJson([{ code: SANDA, warnings: [{ code: "05", status: "発表" }] }]));
      },
      maxRetries: 2,
      sleep: noSleep,
    });
    const { warnings, failedOfficeCodes } = await provider.getActiveWarnings([SANDA]);
    expect(calls).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(failedOfficeCodes).toHaveLength(0);
  });

  it("V2d: 一部県のみ失敗 → 成功県の警報は返しつつ失敗県を記録", async () => {
    const provider = new JmaWarningProvider({
      fetchFn: async (url) => {
        if (url.includes("280000")) return new Response("", { status: 500 });
        return response(jmaJson([{ code: OSAKA, warnings: [{ code: "05", status: "発表" }] }]));
      },
      maxRetries: 0,
      sleep: noSleep,
    });
    const { warnings, failedOfficeCodes } = await provider.getActiveWarnings([SANDA, OSAKA]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.areaCode).toBe(OSAKA);
    expect(failedOfficeCodes).toEqual(["280000"]);
  });

  it("V2e: 沖縄/北海道は複数 office を取得（`${pref}0000` を使わない / 404回避）", async () => {
    const urls: string[] = [];
    const provider = new JmaWarningProvider({
      fetchFn: async (url) => {
        urls.push(url);
        return response(jmaJson([{ code: NAHA, warnings: [{ code: "05", status: "発表" }] }]));
      },
    });
    const { warnings } = await provider.getActiveWarnings([NAHA]);
    // 存在しない 470000.json ではなく、沖縄の 4 office を取得する。
    expect(urls.some((u) => u.includes("470000.json"))).toBe(false);
    expect(urls.some((u) => u.includes("471000.json"))).toBe(true);
    expect(urls.some((u) => u.includes("474000.json"))).toBe(true);
    // 那覇の警報がいずれかの office JSON から拾える。
    expect(warnings.some((w) => w.areaCode === NAHA)).toBe(true);
  });

  it("officeCodesForArea: 単一県は1件、沖縄/北海道は分割 office", () => {
    expect(officeCodesForArea(SANDA)).toEqual(["280000"]);
    expect(officeCodesForArea(NAHA)).toEqual(["471000", "472000", "473000", "474000"]);
    expect(officeCodesForArea(SAPPORO)).toContain("016000");
    expect(officeCodesForArea(SAPPORO)).not.toContain("010000");
  });

  it("V3: active のみ返す（cancelled は除外）", async () => {
    const provider = new JmaWarningProvider({
      fetchFn: async () =>
        response(
          jmaJson([
            { code: SANDA, warnings: [{ code: "05", status: "発表" }] },
            { code: KOBE, warnings: [{ code: "05", status: "解除" }] },
          ]),
        ),
    });
    const { warnings } = await provider.getActiveWarnings([SANDA, KOBE]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.areaCode).toBe(SANDA);
    expect(warnings[0]?.status).toBe("active");
  });

  it("TTL キャッシュ: 2回目の呼び出しは再取得しない", async () => {
    let calls = 0;
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        calls++;
        return response(jmaJson([{ code: SANDA, warnings: [{ code: "05", status: "発表" }] }]));
      },
      cacheTtlMs: 90_000,
      now: () => 1_000, // 固定時刻 → TTL 内
    });
    await provider.getActiveWarnings([SANDA]);
    await provider.getActiveWarnings([SANDA]);
    expect(calls).toBe(1);
  });
});
