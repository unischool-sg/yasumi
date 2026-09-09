import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../infrastructure/db/client.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { type AdminEnv, adminAuthMiddleware, login, requireSuperadmin } from "./auth.ts";
import * as adminsRepo from "../../infrastructure/db/repositories/admins.ts";
import * as areasRepo from "../../infrastructure/db/repositories/areas.ts";
import * as cfg from "../../infrastructure/db/repositories/school-config.ts";
import * as notificationsRepo from "../../infrastructure/db/repositories/notifications.ts";
import * as rulesRepo from "../../infrastructure/db/repositories/rules.ts";
import * as schoolsRepo from "../../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../../infrastructure/db/repositories/subscriptions.ts";
import * as usersRepo from "../../infrastructure/db/repositories/users.ts";
import * as wcRepo from "../../infrastructure/db/repositories/warning-checks.ts";
import { jstDateString } from "../../shared/jst.ts";

export interface AdminAppDeps {
  db: Db;
  adminJwtSecret: string;
  now?: () => Date;
}

const roleSchema = z.enum(["superadmin", "admin"]);
const checkResultSchema = z.enum(["NORMAL", "WAIT", "AM_OFF", "PM_START", "FULL_OFF", "UNKNOWN"]);
const checkTimeSchema = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, "HH:00 または HH:30 のみ");

/** 管理画面 API（`/api/admin` にマウント）。独自 JWT 認証・LIFF とは別系統。 */
export function createAdminApp(deps: AdminAppDeps) {
  const { db } = deps;
  const app = new Hono<AdminEnv>();

  // --- 公開: ログイン ---
  app.use("/auth/login", rateLimit({ max: 20, windowMs: 60_000 }));
  app.post(
    "/auth/login",
    zValidator("json", z.object({ username: z.string().min(1), password: z.string().min(1) })),
    async (c) => {
      const { username, password } = c.req.valid("json");
      const result = await login(db, deps.adminJwtSecret, username, password);
      if (!result) return c.json({ error: "invalid credentials" }, 401);
      return c.json(result);
    },
  );

  // --- 以降は認証必須 ---
  app.use("*", adminAuthMiddleware(deps.adminJwtSecret));

  app.get("/me", (c) => c.json({ admin: c.get("admin") }));

  app.get("/stats", async (c) => {
    const today = jstDateString(deps.now?.() ?? new Date());
    const [schools, users, subs, checks, notifs] = await Promise.all([
      schoolsRepo.countSchools(db),
      usersRepo.countUsers(db),
      subsRepo.countSubscriptions(db),
      wcRepo.countWarningChecksByDate(db, today),
      notificationsRepo.countNotificationsByDate(db, today),
    ]);
    return c.json({ date: today, schools, users, subscriptions: subs, checksToday: checks, notificationsToday: notifs });
  });

  // --- 管理者アカウント（superadmin のみ）---
  app.get("/admins", requireSuperadmin, async (c) => c.json(await adminsRepo.listAdmins(db)));
  app.post(
    "/admins",
    requireSuperadmin,
    zValidator("json", z.object({ username: z.string().min(1), password: z.string().min(8), role: roleSchema })),
    async (c) => {
      const { username, password, role } = c.req.valid("json");
      if (await adminsRepo.findAdminByUsername(db, username)) return c.json({ error: "username taken" }, 409);
      const passwordHash = await Bun.password.hash(password);
      return c.json(await adminsRepo.createAdmin(db, { username, passwordHash, role }), 201);
    },
  );
  app.patch(
    "/admins/:id",
    requireSuperadmin,
    zValidator("json", z.object({ role: roleSchema.optional(), disabled: z.boolean().optional(), password: z.string().min(8).optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const patch: { role?: "superadmin" | "admin"; disabled?: boolean; passwordHash?: string } = {};
      if (body.role !== undefined) patch.role = body.role;
      if (body.disabled !== undefined) patch.disabled = body.disabled;
      if (body.password !== undefined) patch.passwordHash = await Bun.password.hash(body.password);
      const updated = await adminsRepo.updateAdmin(db, c.req.param("id"), patch);
      if (!updated) return c.json({ error: "not found" }, 404);
      return c.json(updated);
    },
  );

  // --- 学校・ルール（管理者は任意編集可）---
  app.get("/schools", zValidator("query", z.object({ q: z.string().optional() })), async (c) => {
    const { q } = c.req.valid("query");
    return c.json(q ? await schoolsRepo.searchSchools(db, q, 200) : await schoolsRepo.listSchools(db, { limit: 200 }));
  });
  app.get("/schools/:id", async (c) => {
    const id = c.req.param("id");
    const school = await schoolsRepo.findSchoolById(db, id);
    if (!school) return c.json({ error: "not found" }, 404);
    const [areaCodes, warningTypes, rules] = await Promise.all([
      cfg.getAreaCodes(db, id),
      cfg.getWarningTypes(db, id),
      rulesRepo.listRulesBySchool(db, id),
    ]);
    return c.json({ ...school, areaCodes, warningTypes, rules: rules.map(rulesRepo.toSchoolRule) });
  });
  app.post(
    "/schools",
    zValidator("json", z.object({
      name: z.string().min(1),
      prefecture: z.string().min(1),
      city: z.string().optional(),
      websiteUrl: z.string().url().optional(),
      areaCodes: z.array(z.string()).optional(),
      warningTypes: z.array(z.string()).optional(),
    })),
    async (c) => {
      const b = c.req.valid("json");
      const school = await schoolsRepo.createSchool(db, {
        name: b.name,
        prefecture: b.prefecture,
        city: b.city ?? null,
        websiteUrl: b.websiteUrl ?? null,
        createdBy: null,
      });
      if (b.areaCodes) await cfg.setAreaCodes(db, school.id, b.areaCodes);
      if (b.warningTypes) await cfg.setWarningTypes(db, school.id, b.warningTypes);
      return c.json(school, 201);
    },
  );
  app.patch(
    "/schools/:id",
    zValidator("json", z.object({
      name: z.string().min(1).optional(),
      prefecture: z.string().min(1).optional(),
      city: z.string().nullable().optional(),
      websiteUrl: z.string().url().nullable().optional(),
      areaCodes: z.array(z.string()).optional(),
      warningTypes: z.array(z.string()).optional(),
    })),
    async (c) => {
      const id = c.req.param("id");
      const school = await schoolsRepo.findSchoolById(db, id);
      if (!school) return c.json({ error: "not found" }, 404);
      const { areaCodes, warningTypes, ...patch } = c.req.valid("json");
      if (Object.keys(patch).length > 0) await schoolsRepo.updateSchool(db, id, patch);
      if (areaCodes) await cfg.setAreaCodes(db, id, areaCodes);
      if (warningTypes) await cfg.setWarningTypes(db, id, warningTypes);
      return c.json(await schoolsRepo.findSchoolById(db, id));
    },
  );
  app.delete("/schools/:id", async (c) => {
    await schoolsRepo.deleteSchool(db, c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/schools/:id/rules", async (c) => {
    const rows = await rulesRepo.listRulesBySchool(db, c.req.param("id"));
    return c.json(rows.map(rulesRepo.toSchoolRule));
  });
  app.post(
    "/schools/:id/rules",
    zValidator("json", z.object({ checkTime: checkTimeSchema, result: checkResultSchema, message: z.string().optional() })),
    async (c) => {
      const b = c.req.valid("json");
      const row = await rulesRepo.createRule(db, { schoolId: c.req.param("id"), checkTime: b.checkTime, result: b.result, message: b.message ?? null });
      return c.json(rulesRepo.toSchoolRule(row), 201);
    },
  );
  app.patch(
    "/rules/:id",
    zValidator("json", z.object({ checkTime: checkTimeSchema.optional(), result: checkResultSchema.optional(), message: z.string().nullable().optional() })),
    async (c) => {
      const updated = await rulesRepo.updateRule(db, c.req.param("id"), c.req.valid("json"));
      if (!updated) return c.json({ error: "not found" }, 404);
      return c.json(rulesRepo.toSchoolRule(updated));
    },
  );
  app.delete("/rules/:id", async (c) => {
    await rulesRepo.deleteRule(db, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- 地域(areas)マスタ ---
  app.get("/areas", zValidator("query", z.object({ prefecture: z.string().optional() })), async (c) => {
    const { prefecture } = c.req.valid("query");
    return c.json(prefecture ? await areasRepo.listAreasByPrefecture(db, prefecture) : await areasRepo.listAreas(db));
  });
  app.post(
    "/areas",
    zValidator("json", z.object({ code: z.string().min(1), name: z.string().min(1), prefecture: z.string().min(1) })),
    async (c) => c.json(await areasRepo.upsertArea(db, c.req.valid("json")), 201),
  );
  app.patch(
    "/areas/:code",
    zValidator("json", z.object({ name: z.string().min(1), prefecture: z.string().min(1) })),
    async (c) => {
      const b = c.req.valid("json");
      return c.json(await areasRepo.upsertArea(db, { code: c.req.param("code"), name: b.name, prefecture: b.prefecture }));
    },
  );
  app.delete("/areas/:code", async (c) => {
    await areasRepo.deleteArea(db, c.req.param("code"));
    return c.body(null, 204);
  });

  // --- ユーザー・購読（閲覧）---
  app.get("/users", async (c) => c.json(await usersRepo.listUsers(db, { limit: 200 })));
  app.get("/subscriptions", async (c) => c.json(await subsRepo.listAllSubscriptions(db, { limit: 200 })));

  // --- 履歴（閲覧）---
  app.get("/warning-checks", zValidator("query", z.object({ schoolId: z.string().optional(), date: z.string().optional() })), async (c) => {
    const { schoolId, date } = c.req.valid("query");
    return c.json(await wcRepo.listWarningChecks(db, { ...(schoolId ? { schoolId } : {}), ...(date ? { targetDate: date } : {}) }));
  });
  app.get("/notifications", zValidator("query", z.object({ schoolId: z.string().optional(), date: z.string().optional() })), async (c) => {
    const { schoolId, date } = c.req.valid("query");
    return c.json(await notificationsRepo.listNotifications(db, { ...(schoolId ? { schoolId } : {}), ...(date ? { targetDate: date } : {}) }));
  });

  return app;
}
