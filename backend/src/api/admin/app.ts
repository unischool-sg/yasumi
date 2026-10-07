import { zValidator } from "@hono/zod-validator";
import { ALL_WARNING_TYPES } from "@yasumi/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../infrastructure/db/client.ts";
import type { NotificationProvider } from "../../domain/notification/provider.ts";
import { notifyUser } from "../../domain/notification/dispatch.ts";
import { buildNotificationText } from "../../domain/notification/messages.ts";
import { deliverNotification } from "../../domain/notification/send.ts";
import { makeMessageRenderer } from "../../domain/notification/render.ts";
import { prepareLogo } from "../../domain/logo.ts";
import { postDiscordMessage } from "../../infrastructure/discord/notify.ts";
import { getLineProfile } from "../../infrastructure/line/line-api.ts";
import type { Storage } from "../../infrastructure/storage/s3.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { type AdminEnv, adminAuthMiddleware, login, requireSuperadmin } from "./auth.ts";
import * as adminsRepo from "../../infrastructure/db/repositories/admins.ts";
import * as adminTemplatesRepo from "../../infrastructure/db/repositories/admin-message-templates.ts";
import * as flagsRepo from "../../infrastructure/db/repositories/flags.ts";
import * as flowTemplatesRepo from "../../infrastructure/db/repositories/flow-templates.ts";
import * as flowSchedulesRepo from "../../infrastructure/db/repositories/flow-schedules.ts";
import * as flowTriggersRepo from "../../infrastructure/db/repositories/flow-event-triggers.ts";
import * as flowRunLogsRepo from "../../infrastructure/db/repositories/flow-run-logs.ts";
import { executeFlow } from "../../domain/flow/execute.ts";
import { toLogSteps } from "../../pipeline/run-flows.ts";
import * as areasRepo from "../../infrastructure/db/repositories/areas.ts";
import * as cfg from "../../infrastructure/db/repositories/school-config.ts";
import * as deviceTokensRepo from "../../infrastructure/db/repositories/device-tokens.ts";
import * as notificationsRepo from "../../infrastructure/db/repositories/notifications.ts";
import * as rulesRepo from "../../infrastructure/db/repositories/rules.ts";
import * as schoolsRepo from "../../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../../infrastructure/db/repositories/subscriptions.ts";
import * as teachersRepo from "../../infrastructure/db/repositories/teachers.ts";
import * as usersRepo from "../../infrastructure/db/repositories/users.ts";
import * as wcRepo from "../../infrastructure/db/repositories/warning-checks.ts";
import { jstDateString, jstHhmm } from "../../shared/jst.ts";

export interface AdminAppDeps {
  db: Db;
  adminJwtSecret: string;
  now?: () => Date;
  /** LINE Messaging API アクセストークン（プロフィール取得用）。 */
  lineAccessToken?: string;
  /** ユーザーへのメッセージ送信用（LINE / FCM 送り分け）。 */
  notificationProvider?: NotificationProvider;
  pushProvider?: NotificationProvider;
  /** ロゴ等のオブジェクトストレージ（RustFS/S3）。未設定ならロゴ機能は無効。 */
  storage?: Storage;
  /** 学校登録などの活動通知先 Discord Webhook URL（秘密・env 注入）。 */
  discordEventsWebhookUrl?: string;
  /** 管理画面の公開URL（活動通知のリンク用）。 */
  adminBaseUrl?: string;
}

const roleSchema = z.enum(["superadmin", "admin"]);
const checkResultSchema = z.enum(["NORMAL", "WAIT", "AM_OFF", "PM_START", "FULL_OFF", "UNKNOWN"]);
const checkTimeSchema = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, "HH:00 または HH:30 のみ");

// フロー（一括施策）テンプレート/スケジュールのバリデーション。
const flowFieldSchema = z.enum(["subscriptionCount", "createdAt", "lineUserId", "id", "flag", "school"]);
const flowFilterSchema = z.object({ id: z.string(), field: flowFieldSchema, op: z.string(), value: z.string(), label: z.string().optional() });
const flowSortSchema = z.object({ id: z.string(), field: flowFieldSchema, dir: z.enum(["asc", "desc"]) });
const flowQuerySchema = z.object({ combinator: z.enum(["and", "or"]), filters: z.array(flowFilterSchema), sorts: z.array(flowSortSchema) });
const flowStepSchema = z.object({ id: z.string(), type: z.enum(["send", "addFlag", "removeFlag"]), text: z.string().max(1000).optional(), flag: z.string().max(50).optional() });
const flowTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  allUsers: z.boolean(),
  query: flowQuerySchema,
  steps: z.array(flowStepSchema).min(1).max(20),
});
const flowScheduleTimeSchema = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, "HH:00 または HH:30 のみ");
const flowDaysSchema = z.array(z.number().int().min(0).max(6)).max(7);
const flowEventTypeSchema = z.enum([
  "user.follow",
  "school.subscribe",
  "school.register",
  "absence.report",
  "judgment.closure",
]);
const flowAudienceModeSchema = z.enum(["trigger_user", "school_subscribers", "query"]);

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
      // 管理画面は全7種（管理者限定含む）を設定可。未知種別のみ除外（防御）。
      if (b.warningTypes)
        await cfg.setWarningTypes(db, school.id, b.warningTypes.filter((t) => ALL_WARNING_TYPES.includes(t)));
      if (deps.discordEventsWebhookUrl) {
        const adminBase = deps.adminBaseUrl || "https://yasumi-admin.unischool.jp";
        await postDiscordMessage(
          deps.discordEventsWebhookUrl,
          `**学校が登録されました**（管理画面）\n学校: ${school.name}（${school.prefecture}）\n学校: ${adminBase}/schools/${school.id}`,
        );
      }
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
      plan: z.enum(["basic", "standard", "premium"]).nullable().optional(),
      planExpiresAt: z.string().datetime().nullable().optional(),
      areaCodes: z.array(z.string()).optional(),
      warningTypes: z.array(z.string()).optional(),
    })),
    async (c) => {
      const id = c.req.param("id");
      const school = await schoolsRepo.findSchoolById(db, id);
      if (!school) return c.json({ error: "not found" }, 404);
      const { areaCodes, warningTypes, planExpiresAt, ...rest } = c.req.valid("json");
      const patch = {
        ...rest,
        ...(planExpiresAt !== undefined ? { planExpiresAt: planExpiresAt ? new Date(planExpiresAt) : null } : {}),
      };
      if (Object.keys(patch).length > 0) await schoolsRepo.updateSchool(db, id, patch);
      if (areaCodes) await cfg.setAreaCodes(db, id, areaCodes);
      if (warningTypes)
        await cfg.setWarningTypes(db, id, warningTypes.filter((t) => ALL_WARNING_TYPES.includes(t)));
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

  // --- 教員アカウントのプロビジョニング（社内 admin が手で発行）---
  app.get("/schools/:id/teachers", async (c) =>
    c.json(await teachersRepo.listTeachersBySchool(db, c.req.param("id"))),
  );
  app.post(
    "/schools/:id/teachers",
    zValidator("json", z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      role: z.enum(["owner", "teacher"]).optional(),
    })),
    async (c) => {
      const schoolId = c.req.param("id");
      const school = await schoolsRepo.findSchoolById(db, schoolId);
      if (!school) return c.json({ error: "school not found" }, 404);
      const b = c.req.valid("json");
      // 社内 admin の発行はプラン席上限の対象外（開通時にプランと合わせて発行するため）。
      // 上限は school 側 owner の自己管理でのみ強制する（M18）。
      if (await teachersRepo.findTeacherByEmail(db, b.email)) return c.json({ error: "email taken" }, 409);
      const passwordHash = await Bun.password.hash(b.password);
      const row = await teachersRepo.createTeacher(db, {
        schoolId,
        email: b.email,
        passwordHash,
        name: b.name,
        ...(b.role ? { role: b.role } : {}),
      });
      const { passwordHash: _omit, ...safe } = row;
      return c.json(safe, 201);
    },
  );
  app.patch(
    "/teachers/:id",
    zValidator("json", z.object({
      role: z.enum(["owner", "teacher"]).optional(),
      disabled: z.boolean().optional(),
      password: z.string().min(8).optional(),
      name: z.string().min(1).optional(),
    })),
    async (c) => {
      const b = c.req.valid("json");
      const patch: { role?: "owner" | "teacher"; disabled?: boolean; passwordHash?: string; name?: string } = {};
      if (b.role !== undefined) patch.role = b.role;
      if (b.disabled !== undefined) patch.disabled = b.disabled;
      if (b.name !== undefined) patch.name = b.name;
      if (b.password !== undefined) patch.passwordHash = await Bun.password.hash(b.password);
      const updated = await teachersRepo.updateTeacher(db, c.req.param("id"), patch);
      if (!updated) return c.json({ error: "not found" }, 404);
      const { passwordHash: _omit, ...safe } = updated;
      return c.json(safe);
    },
  );
  app.delete("/teachers/:id", async (c) => {
    const t = await teachersRepo.findTeacherById(db, c.req.param("id"));
    if (t) await teachersRepo.deleteTeacherInSchool(db, t.schoolId, t.id);
    return c.body(null, 204);
  });

  // --- 学校ロゴ（RustFS）---
  app.post(
    "/schools/:id/logo",
    zValidator("json", z.object({ contentType: z.string().min(1), dataBase64: z.string().min(1) })),
    async (c) => {
      if (!deps.storage) return c.json({ error: "storage not configured" }, 503);
      const id = c.req.param("id");
      const school = await schoolsRepo.findSchoolById(db, id);
      if (!school) return c.json({ error: "not found" }, 404);
      const b = c.req.valid("json");
      const prepared = prepareLogo(id, b.contentType, b.dataBase64);
      if (!prepared.ok) return c.json({ error: prepared.error }, 400);
      await deps.storage.put(prepared.key, prepared.bytes, prepared.contentType);
      await schoolsRepo.updateSchool(db, id, { logoKey: prepared.key });
      return c.json({ logoKey: prepared.key });
    },
  );
  app.delete("/schools/:id/logo", async (c) => {
    const id = c.req.param("id");
    const school = await schoolsRepo.findSchoolById(db, id);
    if (school?.logoKey && deps.storage) await deps.storage.delete(school.logoKey).catch(() => {});
    if (school) await schoolsRepo.updateSchool(db, id, { logoKey: null });
    return c.body(null, 204);
  });

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
          z.object({ type: z.literal("users"), userIds: z.array(z.string().uuid()).min(1).max(500) }),
        ]),
      }),
    ),
    async (c) => {
      const { text, target } = c.req.valid("json");
      const userIds =
        target.type === "all"
          ? await usersRepo.listAllUserIds(db)
          : target.type === "school"
            ? (await subsRepo.listSubscribersBySchool(db, target.schoolId)).map((s) => s.userId)
            : target.userIds;
      const notifyDeps = {
        db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
      };
      const render = makeMessageRenderer({
        db,
        ...(deps.lineAccessToken ? { lineAccessToken: deps.lineAccessToken } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      });
      let sent = 0;
      for (const uid of userIds) {
        if (await notifyUser(notifyDeps, uid, await render(uid, text))) sent++;
      }
      return c.json({ total: userIds.length, sent, failed: userIds.length - sent });
    },
  );

  // --- メッセージ定型文（管理画面・ユーザー送信用）---
  app.get("/message-templates", async (c) => c.json(await adminTemplatesRepo.listTemplates(db)));
  app.post(
    "/message-templates",
    zValidator("json", z.object({ title: z.string().min(1).max(100), body: z.string().min(1).max(1000) })),
    async (c) => c.json(await adminTemplatesRepo.createTemplate(db, c.req.valid("json")), 201),
  );
  app.patch(
    "/message-templates/:id",
    zValidator("json", z.object({ title: z.string().min(1).max(100), body: z.string().min(1).max(1000) })),
    async (c) => c.json(await adminTemplatesRepo.updateTemplate(db, c.req.param("id"), c.req.valid("json"))),
  );
  app.delete("/message-templates/:id", async (c) => {
    await adminTemplatesRepo.deleteTemplate(db, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- フラグ（タグ）---
  app.get("/flag-defs", async (c) => c.json(await flagsRepo.listDefs(db)));
  app.post(
    "/flag-defs",
    zValidator("json", z.object({ name: z.string().min(1).max(50), color: z.string().max(20).optional() })),
    async (c) => c.json(await flagsRepo.createDef(db, c.req.valid("json")), 201),
  );
  app.delete("/flag-defs/:name", async (c) => {
    await flagsRepo.deleteDef(db, c.req.param("name"));
    return c.body(null, 204);
  });
  app.post(
    "/flags/assign",
    zValidator("json", z.object({ userIds: z.array(z.string().uuid()).min(1).max(1000), name: z.string().min(1).max(50) })),
    async (c) => {
      const { userIds, name } = c.req.valid("json");
      const assigned = await flagsRepo.assign(db, userIds, name);
      return c.json({ assigned, total: userIds.length });
    },
  );
  app.post(
    "/flags/unassign",
    zValidator("json", z.object({ userIds: z.array(z.string().uuid()).min(1).max(1000), name: z.string().min(1).max(50) })),
    async (c) => {
      const { userIds, name } = c.req.valid("json");
      await flagsRepo.unassign(db, userIds, name);
      return c.json({ ok: true, total: userIds.length });
    },
  );

  // --- フロー（一括施策）テンプレート ---
  app.get("/flow-templates", async (c) => c.json(await flowTemplatesRepo.listTemplates(db)));
  app.post("/flow-templates", zValidator("json", flowTemplateSchema), async (c) =>
    c.json(await flowTemplatesRepo.createTemplate(db, c.req.valid("json")), 201),
  );
  app.patch("/flow-templates/:id", zValidator("json", flowTemplateSchema), async (c) =>
    c.json(await flowTemplatesRepo.updateTemplate(db, c.req.param("id"), c.req.valid("json"))),
  );
  app.delete("/flow-templates/:id", async (c) => {
    await flowTemplatesRepo.deleteTemplate(db, c.req.param("id"));
    return c.body(null, 204);
  });
  // テンプレートを手動実行（cron と同じ executeFlow を使用）。実行結果はログに記録する。
  app.post("/flow-templates/:id/run", async (c) => {
    const t = await flowTemplatesRepo.getTemplate(db, c.req.param("id"));
    if (!t) return c.json({ error: "template not found" }, 404);
    try {
      const run = await executeFlow(
        {
          db,
          ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
          ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
          ...(deps.lineAccessToken ? { lineAccessToken: deps.lineAccessToken } : {}),
          ...(deps.now ? { now: deps.now } : {}),
        },
        { allUsers: t.allUsers, query: t.query, steps: t.steps },
      );
      await flowRunLogsRepo
        .recordFlowRun(db, {
          templateId: t.id,
          templateName: t.name,
          trigger: "manual",
          audienceCount: run.audienceIds.length,
          results: toLogSteps(run.results),
          status: "success",
        })
        .catch((e) => console.error("[admin] flow run log failed", e));
      return c.json({
        audienceCount: run.audienceIds.length,
        results: run.results.map((r) => ({ type: r.step.type, flag: r.step.flag, sent: r.sent, total: r.total })),
      });
    } catch (e) {
      await flowRunLogsRepo
        .recordFlowRun(db, {
          templateId: t.id,
          templateName: t.name,
          trigger: "manual",
          audienceCount: 0,
          results: [],
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        })
        .catch((err) => console.error("[admin] flow error-log failed", err));
      return c.json({ error: e instanceof Error ? e.message : "flow execution failed" }, 500);
    }
  });

  // フロー実行ログ一覧（新しい順・任意でテンプレ絞り込み）。
  app.get(
    "/flow-run-logs",
    zValidator("query", z.object({ templateId: z.string().optional() })),
    async (c) => {
      const { templateId } = c.req.valid("query");
      return c.json(await flowRunLogsRepo.listFlowRunLogs(db, templateId ? { templateId } : {}));
    },
  );

  // --- フロー定期実行スケジュール ---
  app.get(
    "/flow-schedules",
    zValidator("query", z.object({ templateId: z.string().uuid().optional() })),
    async (c) => c.json(await flowSchedulesRepo.listSchedules(db, c.req.valid("query").templateId)),
  );
  app.post(
    "/flow-schedules",
    zValidator("json", z.object({ templateId: z.string().uuid(), time: flowScheduleTimeSchema, daysOfWeek: flowDaysSchema, enabled: z.boolean().optional() })),
    async (c) => {
      const b = c.req.valid("json");
      const t = await flowTemplatesRepo.getTemplate(db, b.templateId);
      if (!t) return c.json({ error: "template not found" }, 404);
      return c.json(await flowSchedulesRepo.createSchedule(db, b), 201);
    },
  );
  app.patch(
    "/flow-schedules/:id",
    zValidator("json", z.object({ time: flowScheduleTimeSchema.optional(), daysOfWeek: flowDaysSchema.optional(), enabled: z.boolean().optional() })),
    async (c) => c.json(await flowSchedulesRepo.updateSchedule(db, c.req.param("id"), c.req.valid("json"))),
  );
  app.delete("/flow-schedules/:id", async (c) => {
    await flowSchedulesRepo.deleteSchedule(db, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- フローのイベント連動トリガー ---
  app.get(
    "/flow-triggers",
    zValidator("query", z.object({ templateId: z.string().uuid().optional() })),
    async (c) => c.json(await flowTriggersRepo.listTriggers(db, c.req.valid("query").templateId)),
  );
  app.post(
    "/flow-triggers",
    zValidator(
      "json",
      z.object({
        templateId: z.string().uuid(),
        eventType: flowEventTypeSchema,
        audienceMode: flowAudienceModeSchema,
        enabled: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const b = c.req.valid("json");
      const t = await flowTemplatesRepo.getTemplate(db, b.templateId);
      if (!t) return c.json({ error: "template not found" }, 404);
      return c.json(await flowTriggersRepo.createTrigger(db, b), 201);
    },
  );
  app.patch(
    "/flow-triggers/:id",
    zValidator(
      "json",
      z.object({
        eventType: flowEventTypeSchema.optional(),
        audienceMode: flowAudienceModeSchema.optional(),
        enabled: z.boolean().optional(),
      }),
    ),
    async (c) => c.json(await flowTriggersRepo.updateTrigger(db, c.req.param("id"), c.req.valid("json"))),
  );
  app.delete("/flow-triggers/:id", async (c) => {
    await flowTriggersRepo.deleteTrigger(db, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- ユーザー・購読 ---
  app.get("/users", async (c) => {
    const rows = await usersRepo.listUsers(db, { limit: 1000 });
    const ids = rows.map((r) => r.id);
    const [flags, subs] = await Promise.all([
      flagsRepo.listByUsers(db, ids),
      subsRepo.listSubscribedSchoolsByUsers(db, ids),
    ]);
    return c.json(rows.map((r) => ({ ...r, flags: flags.get(r.id) ?? [], subscribedSchools: subs.get(r.id) ?? [] })));
  });
  app.get("/subscriptions", async (c) => c.json(await subsRepo.listAllSubscriptions(db, { limit: 200 })));

  // ユーザー詳細（プロフィール / 購読 / デバイス数）
  app.get("/users/:id", async (c) => {
    const id = c.req.param("id");
    const lineUserId = await usersRepo.getLineUserId(db, id);
    const [subscriptions, deviceTokens, flagsMap] = await Promise.all([
      subsRepo.listSubscriptionsWithSchoolByUser(db, id),
      deviceTokensRepo.listTokensByUser(db, id),
      flagsRepo.listByUsers(db, [id]),
    ]);
    const profile = lineUserId && deps.lineAccessToken
      ? await getLineProfile(deps.lineAccessToken, lineUserId)
      : null;
    return c.json({
      id,
      lineUserId: lineUserId ?? null,
      deviceTokenCount: deviceTokens.length,
      subscriptions,
      flags: flagsMap.get(id) ?? [],
      profile,
    });
  });

  // ユーザーへ簡易メッセージ送信（デバイストークンあれば FCM / 無ければ LINE）
  app.post(
    "/users/:id/message",
    zValidator("json", z.object({ text: z.string().min(1).max(1000) })),
    async (c) => {
      const userId = c.req.param("id");
      const render = makeMessageRenderer({
        db,
        ...(deps.lineAccessToken ? { lineAccessToken: deps.lineAccessToken } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      });
      const ok = await notifyUser(
        { db, ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}), ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}) },
        userId,
        await render(userId, c.req.valid("json").text),
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
  // 通知詳細（送信本文 / 宛先プロフィール / 成否・エラーログ）。原因究明用モーダル。
  app.get("/notifications/:id", async (c) => {
    const row = await notificationsRepo.findNotificationById(db, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    const lineUserId = await usersRepo.getLineUserId(db, row.userId);
    const profile = lineUserId && deps.lineAccessToken ? await getLineProfile(deps.lineAccessToken, lineUserId) : null;
    return c.json({ ...row, lineUserId: lineUserId ?? null, profile });
  });

  // テスト送信（検証用）: 実際の cron と同じ送信・ログ経路で判定通知を手動送信する。
  // 本番の判定を待たずに「送られた時どうなるか」「ログ詳細」「トリガー経路」を確認できる。
  // 毎回ランダムな ruleId を使うため二重通知防止に当たらず、何度でも再送・履歴確認できる。
  app.post(
    "/schools/:id/test-notify",
    zValidator(
      "json",
      z.object({
        result: checkResultSchema,
        target: z.discriminatedUnion("type", [
          z.object({ type: z.literal("subscribers") }), // この学校の通知ONの購読者全員
          z.object({ type: z.literal("lineUser"), lineUserId: z.string().min(1).max(255) }), // 指定LINEユーザーのみ（自分宛で安全に検証）
        ]),
      }),
    ),
    async (c) => {
      if (!deps.notificationProvider) return c.json({ error: "notificationProvider が未設定です（LINE未配線）" }, 400);
      const schoolId = c.req.param("id");
      const { result, target } = c.req.valid("json");
      const school = await schoolsRepo.findSchoolById(db, schoolId);
      if (!school) return c.json({ error: "not found" }, 404);

      const now = deps.now ?? (() => new Date());
      const targetDate = jstDateString(now());
      const checkTime = jstHhmm(now());
      const text = buildNotificationText({ result, schoolName: school.name, checkTime, matchedWarnings: [] });
      const ruleId = crypto.randomUUID(); // テスト毎に一意 → 再送可能・履歴が重複しない

      const userIds =
        target.type === "subscribers"
          ? (await subsRepo.listEnabledSubscribersBySchool(db, schoolId)).map((s) => s.userId)
          : [(await usersRepo.findOrCreateByLineUserId(db, target.lineUserId)).userId];

      const deliverDeps = {
        db,
        notificationProvider: deps.notificationProvider,
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
        now,
      };
      const summary = { total: userIds.length, sent: 0, skippedUndeliverable: 0, errors: 0 };
      for (const userId of userIds) {
        const outcome = await deliverNotification(deliverDeps, { userId, schoolId, ruleId, targetDate, status: result, text });
        if (outcome === "sent") summary.sent++;
        else if (outcome === "undeliverable") summary.skippedUndeliverable++;
        else if (outcome === "error") summary.errors++;
      }
      return c.json({ ...summary, result, targetDate, text });
    },
  );

  return app;
}
