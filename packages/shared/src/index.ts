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
