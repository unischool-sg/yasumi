import type { MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import type { Db } from "../../infrastructure/db/client.ts";
import type { AdminRole } from "../../infrastructure/db/repositories/admins.ts";
import { findAdminByUsername } from "../../infrastructure/db/repositories/admins.ts";

export interface AdminPrincipal {
  id: string;
  username: string;
  role: AdminRole;
}

export type AdminEnv = {
  Variables: { admin: AdminPrincipal };
};

const TOKEN_TTL_SEC = 12 * 60 * 60; // 12h

/** ログイン: username/password を検証し JWT を発行。失敗時 null。 */
export async function login(
  db: Db,
  secret: string,
  username: string,
  password: string,
): Promise<{ token: string; admin: AdminPrincipal } | null> {
  const row = await findAdminByUsername(db, username);
  if (!row || row.disabled) return null;
  const ok = await Bun.password.verify(password, row.passwordHash);
  if (!ok) return null;

  const admin: AdminPrincipal = { id: row.id, username: row.username, role: row.role as AdminRole };
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ sub: admin.id, username: admin.username, role: admin.role, exp: now + TOKEN_TTL_SEC }, secret, "HS256");
  return { token, admin };
}

/** Bearer JWT を検証し c.get("admin") をセット。失効/不正は 401。 */
export function adminAuthMiddleware(secret: string): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    if (!token) return c.json({ error: "unauthorized" }, 401);
    try {
      const payload = await verify(token, secret, "HS256");
      c.set("admin", {
        id: String(payload.sub),
        username: String(payload.username),
        role: payload.role as AdminRole,
      });
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

/** superadmin のみ許可（管理者アカウント管理）。 */
export const requireSuperadmin: MiddlewareHandler<AdminEnv> = async (c, next) => {
  if (c.get("admin").role !== "superadmin") return c.json({ error: "forbidden" }, 403);
  await next();
};
