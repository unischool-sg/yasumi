import type { MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import type { Db } from "../../infrastructure/db/client.ts";
import type { TeacherRole } from "../../infrastructure/db/repositories/teachers.ts";
import { findTeacherByEmail, findTeacherById } from "../../infrastructure/db/repositories/teachers.ts";

/**
 * 教員（学校職員）認証。社内 admin / LINE ユーザーとは別系統の JWT。
 * トークンに schoolId を封入し、以降 c.get("teacher").schoolId を「唯一のテナント境界」として使う
 * （リクエストの schoolId は信用しない）。
 */
export interface TeacherPrincipal {
  id: string;
  schoolId: string;
  role: TeacherRole;
  email: string;
  name: string;
}

export type SchoolEnv = {
  Variables: { teacher: TeacherPrincipal };
};

const TOKEN_TTL_SEC = 12 * 60 * 60; // 12h

export async function teacherLogin(
  db: Db,
  secret: string,
  email: string,
  password: string,
): Promise<{ token: string; teacher: TeacherPrincipal } | null> {
  const row = await findTeacherByEmail(db, email);
  if (!row || row.disabled) return null;
  const ok = await Bun.password.verify(password, row.passwordHash);
  if (!ok) return null;

  const teacher: TeacherPrincipal = {
    id: row.id,
    schoolId: row.schoolId,
    role: row.role as TeacherRole,
    email: row.email,
    name: row.name,
  };
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: teacher.id, schoolId: teacher.schoolId, role: teacher.role, email: teacher.email, name: teacher.name, exp: now + TOKEN_TTL_SEC },
    secret,
    "HS256",
  );
  return { token, teacher };
}

/**
 * Bearer JWT を検証し c.get("teacher") をセット。schoolId はトークン由来で固定。
 * さらに毎リクエストで teachers 行を再取得し、削除/無効化を即時反映（PII 保護・オフボード対応）。
 * schoolId/role も DB の最新値で上書きする（トークン発行後の変更に追随）。
 */
export function teacherAuthMiddleware(secret: string, db: Db): MiddlewareHandler<SchoolEnv> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    if (!token) return c.json({ error: "unauthorized" }, 401);
    let sub: string;
    try {
      const payload = await verify(token, secret, "HS256");
      sub = String(payload.sub);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    // 署名が正しくても、無効化/削除された教員は即座に拒否する。
    const row = await findTeacherById(db, sub);
    if (!row || row.disabled) return c.json({ error: "unauthorized" }, 401);
    c.set("teacher", {
      id: row.id,
      schoolId: row.schoolId,
      role: row.role as TeacherRole,
      email: row.email,
      name: row.name,
    });
    await next();
  };
}

/** owner のみ許可（教員アカウント管理など将来用）。 */
export const requireOwner: MiddlewareHandler<SchoolEnv> = async (c, next) => {
  if (c.get("teacher").role !== "owner") return c.json({ error: "forbidden" }, 403);
  await next();
};
