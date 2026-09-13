import { renderMessageTemplate, templateReferencesVariable } from "@yasumi/shared";
import type { Db } from "../../infrastructure/db/client.ts";
import { getLineProfile } from "../../infrastructure/line/line-api.ts";
import * as subsRepo from "../../infrastructure/db/repositories/subscriptions.ts";
import * as usersRepo from "../../infrastructure/db/repositories/users.ts";
import { jstDateString, jstWeekday } from "../../shared/jst.ts";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

export interface RenderDeps {
  db: Db;
  /** LINE Messaging API アクセストークン（{{name}} 解決用）。未設定なら name は既定語。 */
  lineAccessToken?: string;
  fetchFn?: FetchFn;
  now?: () => Date;
}

export interface RenderContext {
  /** 対象校名（イベント/購読者フロー等）。指定時は {{school}} に優先採用。 */
  schoolName?: string;
}

/** 受信者ごとにメッセージ本文の変数を置換する関数。1回の送信ループで使い回す（名前をキャッシュ）。 */
export type MessageRenderer = (userId: string, text: string) => Promise<string>;

/**
 * 変数置換レンダラを作る。日付/曜日は送信時点で一度だけ算出、名前は参照時のみ LINE から取得しキャッシュ。
 * {{name}}→LINE表示名 / {{school}}→対象校 or 購読中の学校 / {{today}} / {{weekday}}。
 * 解決できない場合は shared の既定語（{{name}}→みなさん 等）に置換。
 */
export function makeMessageRenderer(deps: RenderDeps, ctx: RenderContext = {}): MessageRenderer {
  const now = deps.now?.() ?? new Date();
  const today = jstDateString(now);
  const weekday = WEEKDAY_JP[jstWeekday(now)] ?? "";
  const nameCache = new Map<string, string | undefined>();
  const schoolCache = new Map<string, string | undefined>();

  async function resolveName(userId: string): Promise<string | undefined> {
    if (nameCache.has(userId)) return nameCache.get(userId);
    let name: string | undefined;
    try {
      const lineUserId = await usersRepo.getLineUserId(deps.db, userId);
      if (lineUserId && deps.lineAccessToken) {
        const p = await getLineProfile(deps.lineAccessToken, lineUserId, deps.fetchFn ? { fetchFn: deps.fetchFn } : {});
        name = p?.displayName;
      }
    } catch {
      // 取得失敗は既定語に倒す
    }
    nameCache.set(userId, name);
    return name;
  }

  async function resolveSchool(userId: string): Promise<string | undefined> {
    if (ctx.schoolName) return ctx.schoolName;
    if (schoolCache.has(userId)) return schoolCache.get(userId);
    let name: string | undefined;
    try {
      const subs = await subsRepo.listSubscriptionsWithSchoolByUser(deps.db, userId);
      name = subs[0]?.schoolName;
    } catch {
      // noop
    }
    schoolCache.set(userId, name);
    return name;
  }

  return async (userId, text) => {
    if (!text.includes("{{")) return text; // 変数が無ければ即返す
    const values: Record<string, string | undefined> = { today, weekday };
    if (templateReferencesVariable(text, "school")) values.school = await resolveSchool(userId);
    if (templateReferencesVariable(text, "name")) values.name = await resolveName(userId);
    return renderMessageTemplate(text, values);
  };
}
