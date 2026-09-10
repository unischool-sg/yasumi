import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../infrastructure/db/client.ts";
import * as schoolsRepo from "../../infrastructure/db/repositories/schools.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { type SchoolEnv, teacherAuthMiddleware, teacherLogin } from "./auth.ts";

export interface SchoolAppDeps {
  db: Db;
  schoolJwtSecret: string;
  now?: () => Date;
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

  return app;
}
