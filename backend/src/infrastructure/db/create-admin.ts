import { getDb } from "./client.ts";
import { countAdmins, createAdmin, findAdminByUsername } from "./repositories/admins.ts";

/**
 * 初期 superadmin を作成するブートストラップ（`make admin-create`）。
 * 使い方:
 *   bun run backend/src/infrastructure/db/create-admin.ts <username> <password> [role]
 * もしくは環境変数 ADMIN_BOOTSTRAP_USER / ADMIN_BOOTSTRAP_PASS。
 * 既に同名がいれば skip。role 既定は superadmin。
 */
const username = process.argv[2] ?? process.env.ADMIN_BOOTSTRAP_USER;
const password = process.argv[3] ?? process.env.ADMIN_BOOTSTRAP_PASS;
const role = (process.argv[4] as "superadmin" | "admin" | undefined) ?? "superadmin";

if (!username || !password) {
  console.error("usage: create-admin <username> <password> [role]  (or ADMIN_BOOTSTRAP_USER/PASS)");
  process.exit(1);
}
if (password.length < 8) {
  console.error("password must be >= 8 chars");
  process.exit(1);
}

const db = getDb();

const existing = await findAdminByUsername(db, username);
if (existing) {
  console.log(`[create-admin] '${username}' は既に存在します（skip）`);
  process.exit(0);
}

const passwordHash = await Bun.password.hash(password); // argon2id
const admin = await createAdmin(db, { username, passwordHash, role });
const total = await countAdmins(db);
console.log(`[create-admin] 作成: ${admin.username} (role=${admin.role}) / 総数=${total}`);
process.exit(0);
