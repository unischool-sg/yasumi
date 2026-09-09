/**
 * @yasumi/shared — backend / frontend で共有する型の単一情報源。
 * 仕様書（PRD §14 / §31）で確定した概念のみを置く。M1/M2 で拡張する。
 */

/**
 * 判定結果種別（PRD §14）。
 * ホーム画面の表示・通知条件・warning_checks / notifications の result に使う。
 */
export type CheckResult =
  | "NORMAL" // 通常登校
  | "WAIT" // 自宅待機
  | "AM_OFF" // 午前休
  | "PM_START" // 午後から登校
  | "FULL_OFF" // 全日休校
  | "UNKNOWN"; // 判定不能

/** 各 CheckResult の日本語ラベル（UI / 通知文面の共通表記）。 */
export const CHECK_RESULT_LABEL: Record<CheckResult, string> = {
  NORMAL: "通常登校",
  WAIT: "自宅待機",
  AM_OFF: "午前休",
  PM_START: "午後から登校",
  FULL_OFF: "本日は休校",
  UNKNOWN: "判定できませんでした",
};

/**
 * 気象庁固有形式を Infrastructure 層で吸収した後の内部警報表現（PRD §31）。
 * Domain / Frontend はこの形だけを知る。
 */
export interface Warning {
  /** 気象庁地域コード（名称ではなくコードで扱う / PRD §9） */
  areaCode: string;
  areaName: string;
  warningType: string;
  status: "active" | "cancelled";
  issuedAt: Date;
}

/**
 * ルール成立条件（PRD §25）。判別可能ユニオンで将来拡張（§30）に備える。
 * MVP は WARNING_ACTIVE のみ。詳細は backend/RULE_ENGINE.md。
 */
export type RuleCondition = { type: "WARNING_ACTIVE" };

/**
 * 判定に必要な学校情報の最小セット（PRD §9, §28）。
 * M3 で DB 由来の項目（prefecture / city / createdBy 等）を持つ完全な School へ拡張する。
 */
export interface School {
  id: string;
  /** 対象地域（気象庁地域コード。名称ではなくコード） */
  areaCodes: string[];
  /** 対象警報（例: "暴風警報", "大雨警報"） */
  warningTypes: string[];
  name: string;
}

/**
 * 学校ごとの判定ルール（PRD §25, §44 school_rules）。
 */
export interface SchoolRule {
  id: string;
  schoolId: string;
  /** "HH:MM"（30分刻み HH:00 / HH:30。制約は M5 UI/API 側） */
  checkTime: string;
  condition: RuleCondition;
  /** 成立時に採用する判定結果 */
  result: CheckResult;
}

/**
 * Rule Engine (evaluateSchoolRule) の判定結果（PRD §27〜§29 / backend/RULE_ENGINE.md）。
 */
export interface EvaluationResult {
  /** ルールが成立したか */
  matched: boolean;
  /** 成立時は rule.result、非成立時は "NORMAL" */
  result: CheckResult;
  /** 判定根拠（理由表示用 / PRD §16, §17, §64）。非成立時は [] */
  matchedWarnings: Warning[];
}
