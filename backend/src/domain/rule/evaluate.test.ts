import { describe, expect, it } from "bun:test";
import type { School, SchoolRule, Warning } from "@yasumi/shared";
import { evaluateSchoolRule } from "./evaluate.ts";

// 基準となる学校設定（PRD §28）
// 対象地域: 三田市 / 神戸市 / 西宮市、対象警報: 暴風警報
const SANDA = "280001";
const KOBE = "280002";
const NISHINOMIYA = "280003";
const AMAGASAKI = "280009"; // 対象外地域

const school: School = {
  id: "school-1",
  name: "三田学園高等学校",
  areaCodes: [SANDA, KOBE, NISHINOMIYA],
  warningTypes: ["暴風警報"],
};

function ruleWith(result: SchoolRule["result"]): SchoolRule {
  return {
    id: "rule-1",
    schoolId: school.id,
    checkTime: "08:00",
    condition: { type: "WARNING_ACTIVE" },
    result,
  };
}

const rule = ruleWith("AM_OFF");

function warning(overrides: Partial<Warning> & Pick<Warning, "areaCode" | "warningType">): Warning {
  return {
    areaName: overrides.areaCode,
    status: "active",
    issuedAt: new Date("2026-09-09T08:00:00+09:00"),
    ...overrides,
  };
}

describe("evaluateSchoolRule", () => {
  it("T1: 三田市・暴風警報 active → MATCH (§28)", () => {
    const result = evaluateSchoolRule({
      school,
      rule,
      activeWarnings: [warning({ areaCode: SANDA, warningType: "暴風警報" })],
    });
    expect(result.matched).toBe(true);
    expect(result.result).toBe("AM_OFF");
    expect(result.matchedWarnings).toHaveLength(1);
    expect(result.matchedWarnings[0]?.areaCode).toBe(SANDA);
  });

  it("T2: active 警報なし → NORMAL", () => {
    const result = evaluateSchoolRule({ school, rule, activeWarnings: [] });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
    expect(result.matchedWarnings).toEqual([]);
  });

  it("T3: 対象外地域(尼崎市)・暴風警報 active → NORMAL", () => {
    const result = evaluateSchoolRule({
      school,
      rule,
      activeWarnings: [warning({ areaCode: AMAGASAKI, warningType: "暴風警報" })],
    });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
    expect(result.matchedWarnings).toEqual([]);
  });

  it("T4: 対象外警報(大雨警報)・三田市 active → NORMAL", () => {
    const result = evaluateSchoolRule({
      school,
      rule,
      activeWarnings: [warning({ areaCode: SANDA, warningType: "大雨警報" })],
    });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
  });

  it("T5: 三田市・暴風警報が cancelled → 無視して NORMAL", () => {
    const result = evaluateSchoolRule({
      school,
      rule,
      activeWarnings: [warning({ areaCode: SANDA, warningType: "暴風警報", status: "cancelled" })],
    });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
  });

  it("T6: 別対象地域(神戸市)・暴風警報 active → MATCH", () => {
    const result = evaluateSchoolRule({
      school,
      rule,
      activeWarnings: [warning({ areaCode: KOBE, warningType: "暴風警報" })],
    });
    expect(result.matched).toBe(true);
    expect(result.matchedWarnings[0]?.areaCode).toBe(KOBE);
  });

  it("T7: 三田市＋神戸市の暴風警報が同時 active → matchedWarnings 2件", () => {
    const result = evaluateSchoolRule({
      school,
      rule,
      activeWarnings: [
        warning({ areaCode: SANDA, warningType: "暴風警報" }),
        warning({ areaCode: KOBE, warningType: "暴風警報" }),
      ],
    });
    expect(result.matched).toBe(true);
    expect(result.matchedWarnings).toHaveLength(2);
  });

  it("T8: rule.result=AM_OFF で成立 → AM_OFF", () => {
    const result = evaluateSchoolRule({
      school,
      rule: ruleWith("AM_OFF"),
      activeWarnings: [warning({ areaCode: SANDA, warningType: "暴風警報" })],
    });
    expect(result.result).toBe("AM_OFF");
  });

  it("T9: rule.result=FULL_OFF で成立 → FULL_OFF", () => {
    const result = evaluateSchoolRule({
      school,
      rule: ruleWith("FULL_OFF"),
      activeWarnings: [warning({ areaCode: SANDA, warningType: "暴風警報" })],
    });
    expect(result.result).toBe("FULL_OFF");
  });

  it("T10: areaCodes 空 → NORMAL", () => {
    const result = evaluateSchoolRule({
      school: { ...school, areaCodes: [] },
      rule,
      activeWarnings: [warning({ areaCode: SANDA, warningType: "暴風警報" })],
    });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
  });

  it("T11: warningTypes 空 → NORMAL", () => {
    const result = evaluateSchoolRule({
      school: { ...school, warningTypes: [] },
      rule,
      activeWarnings: [warning({ areaCode: SANDA, warningType: "暴風警報" })],
    });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
  });

  it("T12: 同一 (area, type) の重複警報 → 重複排除して 1件", () => {
    const result = evaluateSchoolRule({
      school,
      rule,
      activeWarnings: [
        warning({ areaCode: SANDA, warningType: "暴風警報" }),
        warning({ areaCode: SANDA, warningType: "暴風警報" }),
      ],
    });
    expect(result.matched).toBe(true);
    expect(result.matchedWarnings).toHaveLength(1);
  });

  it("T13: 入力 activeWarnings を破壊しない（不変性）", () => {
    const activeWarnings = [warning({ areaCode: SANDA, warningType: "暴風警報" })];
    const snapshot = [...activeWarnings];
    evaluateSchoolRule({ school, rule, activeWarnings });
    expect(activeWarnings).toEqual(snapshot);
    expect(activeWarnings).toHaveLength(1);
  });

  // ── WARNING_CLEARED（詳細エディタ: 警報解除 → 午後登校 等）──
  const clearedRule = (afterClosureOnly = true): SchoolRule => ({
    id: "rule-c",
    schoolId: school.id,
    checkTime: "10:00",
    condition: { type: "WARNING_CLEARED", afterClosureOnly },
    result: "PM_START",
  });

  it("C1: 解除・afterClosureOnly かつ午前が休み(AM_OFF) → 成立(PM_START)・matchedWarnings空", () => {
    const result = evaluateSchoolRule({
      school,
      rule: clearedRule(true),
      activeWarnings: [],
      dayContext: { priorResult: "AM_OFF" },
    });
    expect(result.matched).toBe(true);
    expect(result.result).toBe("PM_START");
    expect(result.matchedWarnings).toEqual([]);
  });

  it("C2: 解除・afterClosureOnly だが午前が通常(prior無し) → 非成立(NORMAL)", () => {
    const result = evaluateSchoolRule({
      school,
      rule: clearedRule(true),
      activeWarnings: [],
      dayContext: {},
    });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
  });

  it("C3: 解除・afterClosureOnly=false → 午前状態に依らず成立", () => {
    const result = evaluateSchoolRule({
      school,
      rule: clearedRule(false),
      activeWarnings: [],
      dayContext: {},
    });
    expect(result.matched).toBe(true);
    expect(result.result).toBe("PM_START");
  });

  it("C4: 解除条件だが対象警報が active → 非成立(NORMAL)", () => {
    const result = evaluateSchoolRule({
      school,
      rule: clearedRule(true),
      activeWarnings: [warning({ areaCode: SANDA, warningType: "暴風警報" })],
      dayContext: { priorResult: "AM_OFF" },
    });
    expect(result.matched).toBe(false);
    expect(result.result).toBe("NORMAL");
  });

  it("C5: 午前が NORMAL 確定 → afterClosureOnly で非成立", () => {
    const result = evaluateSchoolRule({
      school,
      rule: clearedRule(true),
      activeWarnings: [],
      dayContext: { priorResult: "NORMAL" },
    });
    expect(result.matched).toBe(false);
  });
});
