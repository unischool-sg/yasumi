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
    const warnings = await provider.getActiveWarnings([SANDA, KOBE]);
    expect(calls).toBe(1);
    expect(warnings).toHaveLength(2);
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

  it("V2: HTTP エラー → 例外（§51）", async () => {
    const provider = new JmaWarningProvider({
      fetchFn: async () => new Response("", { status: 500 }),
    });
    await expect(provider.getActiveWarnings([SANDA])).rejects.toThrow();
  });

  it("V2b: fetch reject → 例外（§51）", async () => {
    const provider = new JmaWarningProvider({
      fetchFn: async () => {
        throw new Error("network down");
      },
    });
    await expect(provider.getActiveWarnings([SANDA])).rejects.toThrow();
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
    const warnings = await provider.getActiveWarnings([SANDA, KOBE]);
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
