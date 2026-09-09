import type { Warning } from "@yasumi/shared";

/**
 * 警報取得のポート（Domain / PRD §32）。
 * 具象（気象庁）は Infrastructure 層で実装する。Domain はこの契約だけを知る。
 */
export interface WarningProvider {
  /**
   * 指定地域コード群のうち、現在発表中（active）の警報を返す。
   * 取得失敗時は例外を投げる（呼び出し側で UNKNOWN 扱い / PRD §51）。
   */
  getActiveWarnings(areaCodes: string[]): Promise<Warning[]>;
}
