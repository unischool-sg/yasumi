import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../infrastructure/db/client.ts";
import type { NotificationProvider } from "../../domain/notification/provider.ts";
import { notifyUser } from "../../domain/notification/dispatch.ts";
import { getLineProfile } from "../../infrastructure/line/line-api.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { type AdminEnv, adminAuthMiddleware, login, requireSuperadmin } from "./auth.ts";
import * as adminsRepo from "../../infrastructure/db/repositories/admins.ts";
import * as areasRepo from "../../infrastructure/db/repositories/areas.ts";
import * as cfg from "../../infrastructure/db/repositories/school-config.ts";
import * as deviceTokensRepo from "../../infrastructure/db/repositories/device-tokens.ts";
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
  /** LINE Messaging API アクセストークン（プロフィール取得用）。 */
  lineAccessToken?: string;
  /** ユーザーへのメッセージ送信用（LINE / FCM 送り分け）。 */
  notificationProvider?: NotificationProvider;
  pushProvider?: NotificationProvider;
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
  // 学校ごとの購読者数・浸透率（営業指標。校内密度の高い順）
  app.get("/schools/overview", async (c) => c.json(await schoolsRepo.listSchoolsWithStats(db)));
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
      studentCount: z.number().int().positive().optional(),
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
        studentCount: b.studentCount ?? null,
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
      studentCount: z.number().int().positive().nullable().optional(),
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

  // 学校を購読しているユーザー一覧
  app.get("/schools/:id/subscribers", async (c) =>
    c.json(await subsRepo.listSubscribersBySchool(db, c.req.param("id"))),
  );

  // 一斉メッセージ送信（全ユーザー / 特定学校の購読者）。デバイストークンあれば FCM / 無ければ LINE。
  app.post(
    "/broadcast",
    zValidator(
      "json",
      z.object({
        text: z.string().min(1).max(1000),
        target: z.discriminatedUnion("type", [
          z.object({ type: z.literal("all") }),
          z.object({ type: z.literal("school"), schoolId: z.string().uuid() }),
        ]),
      }),
    ),
    async (c) => {
      const { text, target } = c.req.valid("json");
      const userIds =
        target.type === "all"
          ? await usersRepo.listAllUserIds(db)
          : (await subsRepo.listSubscribersBySchool(db, target.schoolId)).map((s) => s.userId);
      const notifyDeps = {
        db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
      };
      let sent = 0;
      for (const uid of userIds) {
        if (await notifyUser(notifyDeps, uid, text)) sent++;
      }
      return c.json({ total: userIds.length, sent, failed: userIds.length - sent });
    },
  );

  // --- ユーザー・購読 ---
  app.get("/users", async (c) => c.json(await usersRepo.listUsers(db, { limit: 200 })));
  app.get("/subscriptions", async (c) => c.json(await subsRepo.listAllSubscriptions(db, { limit: 200 })));

  // ユーザー詳細（プロフィール / 購読 / デバイス数）
  app.get("/users/:id", async (c) => {
    const id = c.req.param("id");
    const lineUserId = await usersRepo.getLineUserId(db, id);
    const [subscriptions, deviceTokens] = await Promise.all([
      subsRepo.listSubscriptionsWithSchoolByUser(db, id),
      deviceTokensRepo.listTokensByUser(db, id),
    ]);
    const profile = lineUserId && deps.lineAccessToken
      ? await getLineProfile(deps.lineAccessToken, lineUserId)
      : null;
    return c.json({
      id,
      lineUserId: lineUserId ?? null,
      deviceTokenCount: deviceTokens.length,
      subscriptions,
      profile,
    });
  });

  // ユーザーへ簡易メッセージ送信（デバイストークンあれば FCM / 無ければ LINE）
  app.post(
    "/users/:id/message",
    zValidator("json", z.object({ text: z.string().min(1).max(1000) })),
    async (c) => {
      const ok = await notifyUser(
        { db, ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}), ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}) },
        c.req.param("id"),
        c.req.valid("json").text,
      );
      if (!ok) return c.json({ error: "送信できませんでした（通知先が無い/未設定）" }, 400);
      return c.json({ ok: true });
    },
  );

  // 購読の追加 / 通知ON-OFF / 削除
  app.post(
    "/users/:id/subscriptions",
    zValidator("json", z.object({ schoolId: z.string().uuid() })),
    async (c) => {
      const school = await schoolsRepo.findSchoolById(db, c.req.valid("json").schoolId);
      if (!school) return c.json({ error: "school not found" }, 404);
      const row = await subsRepo.upsertSubscription(db, { userId: c.req.param("id"), schoolId: school.id });
      return c.json(row, 201);
    },
  );
  app.patch(
    "/users/:id/subscriptions/:schoolId",
    zValidator("json", z.object({ notificationEnabled: z.boolean() })),
    async (c) => {
      const row = await subsRepo.upsertSubscription(db, {
        userId: c.req.param("id"),
        schoolId: c.req.param("schoolId"),
        notificationEnabled: c.req.valid("json").notificationEnabled,
      });
      return c.json(row);
    },
  );
  app.delete("/users/:id/subscriptions/:schoolId", async (c) => {
    await subsRepo.removeSubscription(db, c.req.param("id"), c.req.param("schoolId"));
    return c.body(null, 204);
  });

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
