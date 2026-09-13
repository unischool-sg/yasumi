import { describe, expect, it } from "bun:test";
import { JmaWarningProvider } from "./jma-warning-provider.ts";
import type { JmaWarningJson } from "./parse.ts";

const SANDA = "280010";
const KOBE = "280020";
const OSAKA = "270000"; // 別都道府県

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
    const { warnings, failedPrefCodes } = await provider.getActiveWarnings([SANDA, KOBE]);
    expect(calls).toBe(1);
    expect(warnings).toHaveLength(2);
    expect(failedPrefCodes).toHaveLength(0);
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

  it("V2: HTTP エラー → リトライ後も失敗した県は failedPrefCodes（例外にしない / §51）", async () => {
    let calls = 0;
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        calls++;
        return new Response("", { status: 500 });
      },
      maxRetries: 2,
      sleep: noSleep,
    });
    const { warnings, failedPrefCodes } = await provider.getActiveWarnings([SANDA]);
    expect(warnings).toHaveLength(0);
    expect(failedPrefCodes).toEqual(["280000"]);
    expect(calls).toBe(3); // 初回 + リトライ2
  });

  it("V2b: fetch reject → リトライ後も失敗した県は failedPrefCodes（§51）", async () => {
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        throw new Error("network down");
      },
      maxRetries: 1,
      sleep: noSleep,
    });
    const { failedPrefCodes } = await provider.getActiveWarnings([SANDA]);
    expect(failedPrefCodes).toEqual(["280000"]);
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
    const { warnings, failedPrefCodes } = await provider.getActiveWarnings([SANDA]);
    expect(calls).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(failedPrefCodes).toHaveLength(0);
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
    const { warnings, failedPrefCodes } = await provider.getActiveWarnings([SANDA, OSAKA]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.areaCode).toBe(OSAKA);
    expect(failedPrefCodes).toEqual(["280000"]);
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
