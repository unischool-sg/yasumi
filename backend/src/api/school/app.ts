import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../infrastructure/db/client.ts";
import type { NotificationProvider } from "../../domain/notification/provider.ts";
import { notifyUser } from "../../domain/notification/dispatch.ts";
import * as msgRepo from "../../infrastructure/db/repositories/school-messages.ts";
import * as schoolsRepo from "../../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../../infrastructure/db/repositories/subscriptions.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { type SchoolEnv, teacherAuthMiddleware, teacherLogin } from "./auth.ts";

export interface SchoolAppDeps {
  db: Db;
  schoolJwtSecret: string;
  now?: () => Date;
  /** 公式メッセージ送信用（LINE / FCM 送り分け）。 */
  notificationProvider?: NotificationProvider;
  pushProvider?: NotificationProvider;
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

  // --- 以降は認証必須（テナント＝トークンの schoolId 固定）---
  app.use("*", teacherAuthMiddleware(deps.schoolJwtSecret));

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

  // 公式メッセージの一斉送信（自校購読者へ）。category: emergency(無制限) / announcement(将来計上)
  app.post(
    "/broadcast",
    zValidator("json", z.object({
      text: z.string().min(1).max(1000),
      category: z.enum(["emergency", "announcement"]),
    })),
    async (c) => {
      const { schoolId, id: teacherId } = c.get("teacher");
      const { text, category } = c.req.valid("json");
      const subs = await subsRepo.listSubscribersBySchool(db, schoolId);
      const notifyDeps = {
        db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
      };
      let sent = 0;
      for (const s of subs) {
        if (await notifyUser(notifyDeps, s.userId, text)) sent++;
      }
      const total = subs.length;
      const row = await msgRepo.createMessage(db, {
        schoolId,
        teacherId,
        category,
        text,
        total,
        sent,
        failed: total - sent,
      });
      return c.json({ id: row.id, total, sent, failed: total - sent });
    },
  );

  // 送信履歴（到達状況の可視化）
  app.get("/messages", async (c) =>
    c.json(await msgRepo.listBySchool(db, c.get("teacher").schoolId)),
  );

  return app;
}
