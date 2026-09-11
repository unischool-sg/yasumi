import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { z } from "zod";
import type { Db } from "../../infrastructure/db/client.ts";
import type { NotificationProvider } from "../../domain/notification/provider.ts";
import { notifyUser } from "../../domain/notification/dispatch.ts";
import { announcementMonthlyLimit, jstMonthStart } from "../../domain/plan.ts";
import * as absenceReportsRepo from "../../infrastructure/db/repositories/absence-reports.ts";
import * as closureDraftsRepo from "../../infrastructure/db/repositories/closure-drafts.ts";
import * as msgRepo from "../../infrastructure/db/repositories/school-messages.ts";
import * as schoolsRepo from "../../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../../infrastructure/db/repositories/subscriptions.ts";
import * as templatesRepo from "../../infrastructure/db/repositories/message-templates.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { type SchoolEnv, teacherAuthMiddleware, teacherLogin } from "./auth.ts";

export interface SchoolAppDeps {
  db: Db;
  schoolJwtSecret: string;
  now?: () => Date;
  /** 公式メッセージ送信用（LINE / FCM 送り分け）。 */
  notificationProvider?: NotificationProvider;
  pushProvider?: NotificationProvider;
  /** 確認リンクの生成に使う API 公開URL（例 https://yasumi-api.unischool.jp）。未設定なら確認リンクを付けない。 */
  apiBaseUrl?: string;
}

/**
 * 先生ダッシュボード API（`/api/school` にマウント）。教員アカウント認証・自校スコープ。
 * Phase 0 はログインと /me のみ。送信/購読者/欠席などの業務EPは M12/M13 で追加。
 */
export function createSchoolApp(deps: SchoolAppDeps) {
  const { db } = deps;
  const app = new Hono<SchoolEnv>();

  // --- 公開: ログイン ---
  app.use("/auth/login", rateLimit({ max: 20, windowMs: 60_000 }));
  app.post(
    "/auth/login",
    zValidator("json", z.object({ email: z.string().email(), password: z.string().min(1) })),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const result = await teacherLogin(db, deps.schoolJwtSecret, email, password);
      if (!result) return c.json({ error: "invalid credentials" }, 401);
      return c.json(result);
    },
  );

  // --- 以降は認証必須（テナント＝トークンの schoolId 固定・毎回 DB 再検証）---
  app.use("*", teacherAuthMiddleware(deps.schoolJwtSecret, db));

  app.get("/me", async (c) => {
    const teacher = c.get("teacher");
    const school = await schoolsRepo.findSchoolById(db, teacher.schoolId);
    return c.json({
      teacher,
      school: school
        ? {
            id: school.id,
            name: school.name,
            prefecture: school.prefecture,
            plan: school.plan,
            planExpiresAt: school.planExpiresAt,
          }
        : null,
    });
  });

  // 自校の購読者一覧（テナントスコープ）
  app.get("/subscribers", async (c) =>
    c.json(await subsRepo.listSubscribersBySchool(db, c.get("teacher").schoolId)),
  );

  // 公式メッセージの一斉送信（自校購読者へ）。category: emergency(無制限) / announcement(通数計上)
  app.post(
    "/broadcast",
    zValidator("json", z.object({
      text: z.string().min(1).max(1000),
      category: z.enum(["emergency", "announcement"]),
      requireConfirmation: z.boolean().optional(),
    })),
    async (c) => {
      const { schoolId, id: teacherId } = c.get("teacher");
      const { text, category, requireConfirmation } = c.req.valid("json");
      // お知らせ（任意送信）は月間通数の上限を超えたら 403。緊急/休校は無制限。
      if (category === "announcement") {
        const school = await schoolsRepo.findSchoolById(db, schoolId);
        const now = deps.now?.() ?? new Date();
        const limit = announcementMonthlyLimit(school ?? { plan: null, planExpiresAt: null }, now);
        if (limit !== null) {
          const used = await msgRepo.countAnnouncementsSince(db, schoolId, jstMonthStart(now));
          if (used >= limit) {
            return c.json({ error: "quota exceeded", used, limit }, 403);
          }
        }
      }
      const subs = await subsRepo.listSubscribersBySchool(db, schoolId);
      const total = subs.length;
      const withConfirm = !!requireConfirmation && !!deps.apiBaseUrl;
      // 確認リンクは受信者ごとに token を埋めるため、先に message 行を作って id を確定する。
      const row = await msgRepo.createMessage(db, {
        schoolId, teacherId, category, text, total, sent: 0, failed: total,
        requireConfirmation: withConfirm,
      });
      const notifyDeps = {
        db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
      };
      let sent = 0;
      for (const s of subs) {
        let body = text;
        if (withConfirm) {
          const token = await sign({ m: row.id, u: s.userId }, deps.schoolJwtSecret, "HS256");
          body = `${text}\n\n▼受け取ったら確認をお願いします\n${deps.apiBaseUrl}/c/${token}`;
        }
        if (await notifyUser(notifyDeps, s.userId, body)) sent++;
      }
      await msgRepo.updateCounts(db, row.id, sent, total - sent);
      return c.json({ id: row.id, total, sent, failed: total - sent });
    },
  );

  // 送信履歴（到達状況＋確認数）
  app.get("/messages", async (c) =>
    c.json(await msgRepo.listBySchool(db, c.get("teacher").schoolId)),
  );

  // --- テンプレート（定型文・自校スコープ）---
  app.get("/templates", async (c) => c.json(await templatesRepo.listBySchool(db, c.get("teacher").schoolId)));
  app.post(
    "/templates",
    zValidator("json", z.object({
      title: z.string().min(1).max(100),
      category: z.enum(["emergency", "announcement"]),
      body: z.string().min(1).max(1000),
    })),
    async (c) => {
      const b = c.req.valid("json");
      const row = await templatesRepo.createTemplate(db, { schoolId: c.get("teacher").schoolId, ...b });
      return c.json(row, 201);
    },
  );
  app.delete("/templates/:id", async (c) => {
    await templatesRepo.deleteInSchool(db, c.get("teacher").schoolId, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- 警報連動の休校ドラフト（自動生成→ワンタップ送信 / M16）---
  app.get("/drafts", async (c) => c.json(await closureDraftsRepo.listPendingBySchool(db, c.get("teacher").schoolId)));
  app.post(
    "/drafts/:id/send",
    zValidator("json", z.object({ text: z.string().min(1).max(1000).optional() })),
    async (c) => {
      const { schoolId, id: teacherId } = c.get("teacher");
      const draft = await closureDraftsRepo.findInSchool(db, schoolId, c.req.param("id"));
      if (!draft || draft.status !== "pending") return c.json({ error: "not found" }, 404);
      const text = c.req.valid("json").text ?? draft.text;
      const subs = await subsRepo.listSubscribersBySchool(db, schoolId);
      const notifyDeps = {
        db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
      };
      let sent = 0;
      for (const s of subs) if (await notifyUser(notifyDeps, s.userId, text)) sent++;
      await msgRepo.createMessage(db, {
        schoolId, teacherId, category: "emergency", text, total: subs.length, sent, failed: subs.length - sent,
      });
      await closureDraftsRepo.setStatusInSchool(db, schoolId, draft.id, "sent");
      return c.json({ total: subs.length, sent, failed: subs.length - sent });
    },
  );
  app.post("/drafts/:id/dismiss", async (c) => {
    const updated = await closureDraftsRepo.setStatusInSchool(db, c.get("teacher").schoolId, c.req.param("id"), "dismissed");
    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json(updated);
  });

  // 今月の任意送信（お知らせ）の残数
  app.get("/quota", async (c) => {
    const schoolId = c.get("teacher").schoolId;
    const school = await schoolsRepo.findSchoolById(db, schoolId);
    const now = deps.now?.() ?? new Date();
    const limit = announcementMonthlyLimit(school ?? { plan: null, planExpiresAt: null }, now);
    const used = await msgRepo.countAnnouncementsSince(db, schoolId, jstMonthStart(now));
    return c.json({ plan: school?.plan ?? null, announcement: { used, limit } });
  });

  // --- 欠席受付の受信箱（M13・自校スコープ）---
  app.get(
    "/absences",
    zValidator("query", z.object({ status: z.enum(["unread", "confirmed"]).optional() })),
    async (c) => {
      const { status } = c.req.valid("query");
      const rows = await absenceReportsRepo.listBySchool(db, c.get("teacher").schoolId, {
        ...(status ? { status } : {}),
      });
      return c.json(rows);
    },
  );

  app.patch(
    "/absences/:id",
    zValidator("json", z.object({ status: z.enum(["unread", "confirmed"]) })),
    async (c) => {
      // schoolId スコープで更新（他校の欠席は 404）
      const updated = await absenceReportsRepo.setStatusInSchool(
        db,
        c.get("teacher").schoolId,
        c.req.param("id"),
        c.req.valid("json").status,
      );
      if (!updated) return c.json({ error: "not found" }, 404);
      return c.json(updated);
    },
  );

  return app;
}
