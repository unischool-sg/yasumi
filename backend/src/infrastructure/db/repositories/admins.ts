import { asc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { admins } from "../schema.ts";

export type AdminRow = typeof admins.$inferSelect;
export type AdminRole = "superadmin" | "admin";

/** 秘密情報を除いた公開表現。 */
export type AdminPublic = Pick<AdminRow, "id" | "username" | "role" | "disabled" | "createdAt">;

export function toPublic(row: AdminRow): AdminPublic {
  const { passwordHash: _omit, ...rest } = row;
  return rest;
}

export async function findAdminByUsername(db: Db, username: string): Promise<AdminRow | undefined> {
  const rows = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
  return rows[0];
}

export async function findAdminById(db: Db, id: string): Promise<AdminRow | undefined> {
  const rows = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
  return rows[0];
}

export async function listAdmins(db: Db): Promise<AdminPublic[]> {
  const rows = await db.select().from(admins).orderBy(asc(admins.createdAt));
  return rows.map(toPublic);
}

export async function countAdmins(db: Db): Promise<number> {
  const rows = await db.select({ id: admins.id }).from(admins);
  return rows.length;
}

export async function createAdmin(
  db: Db,
  input: { username: string; passwordHash: string; role: AdminRole },
): Promise<AdminPublic> {
  const rows = await db.insert(admins).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("failed to create admin");
  return toPublic(row);
}

export async function updateAdmin(
  db: Db,
  id: string,
  patch: { role?: AdminRole; disabled?: boolean; passwordHash?: string },
): Promise<AdminPublic | undefined> {
  const rows = await db.update(admins).set(patch).where(eq(admins.id, id)).returning();
  return rows[0] ? toPublic(rows[0]) : undefined;
}
