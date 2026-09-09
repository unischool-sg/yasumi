import { describe, expect, it } from "bun:test";
import { type JmaWarningJson, parseJmaWarnings } from "./parse.ts";

const REPORT_AT = "2026-09-09T08:00:00+09:00";
const SANDA = "280010";
const KOBE = "280020";
const NISHINOMIYA = "280030";

function jsonWith(areas: JmaWarningJson["areaTypes"][number]["areas"]): JmaWarningJson {
  return {
    reportDatetime: REPORT_AT,
    publishingOffice: "神戸地方気象台",
    headlineText: "",
    areaTypes: [{ areas }],
  };
}

describe("parseJmaWarnings", () => {
  it("P1: 発表中の暴風警報(05) → active・名称 暴風警報", () => {
    const result = parseJmaWarnings(
      jsonWith([{ code: SANDA, warnings: [{ code: "05", status: "発表" }] }]),
      [SANDA],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.areaCode).toBe(SANDA);
    expect(result[0]?.warningType).toBe("暴風警報");
    expect(result[0]?.status).toBe("active");
  });

  it("P2: status=解除 → cancelled", () => {
    const result = parseJmaWarnings(
      jsonWith([{ code: SANDA, warnings: [{ code: "05", status: "解除" }] }]),
      [SANDA],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("cancelled");
  });

  it("P3: 発表警報・注意報はなし（code なし）→ 除外", () => {
    const result = parseJmaWarnings(
      jsonWith([{ code: SANDA, warnings: [{ status: "発表警報・注意報はなし" }] }]),
      [SANDA],
    );
    expect(result).toEqual([]);
  });

  it("P4: requestedAreaCodes 外の area → 除外", () => {
    const result = parseJmaWarnings(
      jsonWith([{ code: KOBE, warnings: [{ code: "05", status: "発表" }] }]),
      [SANDA],
    );
    expect(result).toEqual([]);
  });

  it("P5: 未知 code → 名称フォールバックで返す", () => {
    const result = parseJmaWarnings(
      jsonWith([{ code: SANDA, warnings: [{ code: "99", status: "発表" }] }]),
      [SANDA],
    );
    expect(result[0]?.warningType).toBe("警報コード99");
  });

  it("P6: reportDatetime が issuedAt に入る", () => {
    const result = parseJmaWarnings(
      jsonWith([{ code: SANDA, warnings: [{ code: "05", status: "発表" }] }]),
      [SANDA],
    );
    expect(result[0]?.issuedAt.toISOString()).toBe(new Date(REPORT_AT).toISOString());
  });

  it("P7: 複数 area / 複数 warning の混在を正しく展開", () => {
    const result = parseJmaWarnings(
      jsonWith([
        {
          code: SANDA,
          warnings: [
            { code: "05", status: "発表" },
            { code: "03", status: "継続" },
          ],
        },
        { code: KOBE, warnings: [{ code: "05", status: "発表" }] },
        { code: NISHINOMIYA, warnings: [{ status: "発表警報・注意報はなし" }] },
      ]),
      [SANDA, KOBE, NISHINOMIYA],
    );
    expect(result).toHaveLength(3);
    expect(result.filter((w) => w.status === "active")).toHaveLength(3);
    expect(result.map((w) => w.warningType).sort()).toEqual(["大雨警報", "暴風警報", "暴風警報"].sort());
  });

  it("resolveAreaName が指定されれば areaName に反映される", () => {
    const result = parseJmaWarnings(
      jsonWith([{ code: SANDA, warnings: [{ code: "05", status: "発表" }] }]),
      [SANDA],
      { resolveAreaName: (code) => (code === SANDA ? "三田市" : code) },
    );
    expect(result[0]?.areaName).toBe("三田市");
  });
});
