import type { Warning } from "@yasumi/shared";

/** 警報取得の結果（部分失敗を表現できる / PRD §51）。 */
export interface WarningFetchResult {
  /** 取得できた都道府県における現在発表中（active）の警報。 */
  warnings: Warning[];
  /**
   * 取得に失敗した office（府県予報区）JSON コード（例 "280000" / 沖縄なら "471000" 等）。
   * リトライ後も取得できなかった office。この office に属する学校は UNKNOWN 扱いにする。
   * 取得できた office の学校は通常どおり判定を続行する（1件の瞬断で全校を巻き添えにしない）。
   */
  failedOfficeCodes: string[];
}

/**
 * 警報取得のポート（Domain / PRD §32）。
 * 具象（気象庁）は Infrastructure 層で実装する。Domain はこの契約だけを知る。
 */
export interface WarningProvider {
  /**
   * 指定地域コード群のうち、現在発表中（active）の警報を返す。
   * office(府県予報区)単位で取得し、一部が失敗しても例外にせず `failedOfficeCodes` で返す
   * （呼び出し側で該当地域の学校のみ UNKNOWN 扱い / PRD §51）。
   */
  getActiveWarnings(areaCodes: string[]): Promise<WarningFetchResult>;
}
