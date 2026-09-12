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

// ── フロー（一括施策）: 対象条件・ステップ（admin/backend 共有・単一情報源）──
// 対象条件は client/server 双方で同じ評価をするため、純関数として shared に置く。

export type FlowQueryField = "subscriptionCount" | "createdAt" | "lineUserId" | "id" | "flag" | "school";
export type FlowFieldType = "number" | "date" | "string" | "flag" | "school";
export type FlowCombinator = "and" | "or";

/** 各フィールドの評価型（UI の見た目とは独立した意味論の単一情報源）。 */
export const FLOW_FIELD_TYPE: Record<FlowQueryField, FlowFieldType> = {
  subscriptionCount: "number",
  createdAt: "date",
  lineUserId: "string",
  id: "string",
  flag: "flag",
  school: "school",
};

export interface FlowFilterBlock {
  id: string;
  field: FlowQueryField;
  op: string;
  value: string;
  /** 表示用ラベル（例: 学校名）。評価には使わない。 */
  label?: string;
}
export interface FlowSortBlock {
  id: string;
  field: FlowQueryField;
  dir: "asc" | "desc";
}
export interface FlowAudienceQuery {
  combinator: FlowCombinator;
  filters: FlowFilterBlock[];
  sorts: FlowSortBlock[];
}

export type FlowStepType = "send" | "addFlag" | "removeFlag";
export interface FlowStep {
  id: string;
  type: FlowStepType;
  /** send のとき本文 */
  text?: string;
  /** addFlag / removeFlag のときフラグ名 */
  flag?: string;
}

/** 対象条件の評価に必要なユーザーの最小表現（/users 応答と互換）。 */
export interface AudienceUser {
  id: string;
  lineUserId: string | null;
  createdAt: string; // ISO 文字列
  subscriptionCount: number;
  flags: string[];
  subscribedSchools: { id: string; name: string }[];
}

/** 1 ブロックの評価（nowMs は登録日相対条件の基準時刻）。 */
function evalFlowBlock(u: AudienceUser, b: FlowFilterBlock, nowMs: number): boolean {
  const type = FLOW_FIELD_TYPE[b.field];
  if (type === "flag") {
    const has = (u.flags ?? []).includes(b.value);
    return b.op === "hasFlag" ? has : !has;
  }
  if (type === "school") {
    const has = (u.subscribedSchools ?? []).some((s) => s.id === b.value);
    return b.op === "subscribes" ? has : !has;
  }
  if (type === "number") {
    const n = u.subscriptionCount;
    const v = Number(b.value);
    switch (b.op) {
      case "gte": return n >= v;
      case "lte": return n <= v;
      case "gt": return n > v;
      case "lt": return n < v;
      case "eq": return n === v;
      case "ne": return n !== v;
    }
  }
  if (type === "date") {
    const t = new Date(u.createdAt).getTime();
    if (b.op === "olderThanDays" || b.op === "withinDays") {
      const ageMs = nowMs - t;
      const th = (Number(b.value) || 0) * 86400000;
      return b.op === "olderThanDays" ? ageMs >= th : ageMs <= th;
    }
    const d = new Date(b.value).getTime();
    if (Number.isNaN(d)) return true;
    return b.op === "after" ? t > d : t < d;
  }
  // string
  const s = (b.field === "lineUserId" ? u.lineUserId : u.id) ?? "";
  switch (b.op) {
    case "contains": return s.toLowerCase().includes(b.value.toLowerCase());
    case "equals": return s === b.value;
    case "empty": return s === "";
    case "notEmpty": return s !== "";
  }
  return true;
}

/** 対象条件にユーザーが合致するか（filters を combinator で結合）。 */
export function matchesAudienceQuery(u: AudienceUser, q: FlowAudienceQuery, nowMs: number): boolean {
  if (q.filters.length === 0) return true;
  return q.combinator === "and"
    ? q.filters.every((b) => evalFlowBlock(u, b, nowMs))
    : q.filters.some((b) => evalFlowBlock(u, b, nowMs));
}

/** ステップ内容を人間可読な1行に文字起こし（Discord ログ等で使用）。 */
export function describeFlowStep(st: FlowStep): string {
  if (st.type === "send") return `メッセージ送信: 「${(st.text ?? "").replace(/\n/g, " ")}」`;
  if (st.type === "addFlag") return `フラグ付与: 「${st.flag ?? ""}」`;
  return `フラグ解除: 「${st.flag ?? ""}」`;
}
