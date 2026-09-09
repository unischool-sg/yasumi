import type { MiddlewareHandler } from "hono";
import type { Db } from "../infrastructure/db/client.ts";
import { findOrCreateByLineUserId } from "../infrastructure/db/repositories/users.ts";

/** LIFF ID トークンを検証し LINE ユーザーIDを返す（PRD §21）。失敗時は例外。 */
export type IdTokenVerifier = (idToken: string) => Promise<{ lineUserId: string }>;

/**
 * 本番用: LINE のトークン検証エンドポイントで id_token を検証する。
 * フロントの lineUserId を信用せず、サーバーがトークンから導出する（§21）。
 */
export function createLineIdTokenVerifier(channelId: string): IdTokenVerifier {
  return async (idToken) => {
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!res.ok) throw new Error("id token verify failed");
    const data = (await res.json()) as { sub?: string };
    if (!data.sub) throw new Error("id token has no sub");
    return { lineUserId: data.sub };
  };
}

export interface AuthDeps {
  db: Db;
  verifyIdToken: IdTokenVerifier;
}

export type AuthEnv = {
  Variables: {
    userId: string;
    lineUserId: string;
  };
};

/** Bearer トークンを検証し、内部ユーザーを解決/作成して context に載せる。 */
export function authMiddleware(deps: AuthDeps): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    if (!token) return c.json({ error: "unauthorized" }, 401);

    let lineUserId: string;
    try {
      ({ lineUserId } = await deps.verifyIdToken(token));
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }

    const { userId } = await findOrCreateByLineUserId(deps.db, lineUserId);
    c.set("userId", userId);
    c.set("lineUserId", lineUserId);
    await next();
  };
}
