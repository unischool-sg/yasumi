import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { type AuthDeps, type AuthEnv, authMiddleware } from "./auth.ts";
import { checkSchoolEditable } from "./authz.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import * as areasRepo from "../infrastructure/db/repositories/areas.ts";
import * as cfg from "../infrastructure/db/repositories/school-config.ts";
import * as rulesRepo from "../infrastructure/db/repositories/rules.ts";
import * as schoolsRepo from "../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../infrastructure/db/repositories/subscriptions.ts";

export interface AppDeps extends AuthDeps {
  /** 管理者の LINE ユーザーID（学校/ルール編集の許可 / PRD §23）。 */
  adminLineUserIds?: string[];
}

const checkResultSchema = z.enum(["NORMAL", "WAIT", "AM_OFF", "PM_START", "FULL_OFF", "UNKNOWN"]);
// check_time は 30分刻み（HH:00 / HH:30）のみ許可（PRD §13 Step4 / M5）。
const checkTimeSchema = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, "HH:00 または HH:30 のみ");

/**
 * Hono アプリの factory（backend/API.md §2）。依存注入でテスト可能にする。
 * `/health` は無認証、`/api/*` は認証必須。
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AuthEnv>();
  app.use("*", secureHeaders());
  app.use("*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  const api = new Hono<AuthEnv>();
  api.use("*", rateLimit());
  api.use("*", authMiddleware(deps));

  // --- User ---
  api.get("/me", (c) => c.json({ userId: c.get("userId") }));

  // --- Schools ---
  api.get(
    "/schools/search",
    zValidator("query", z.object({ q: z.string().min(1) })),
    async (c) => {
      const { q } = c.req.valid("query");
      return c.json(await schoolsRepo.searchSchools(deps.db, q));
    },
  );

  api.get("/schools/:id", async (c) => {
    const id = c.req.param("id");
    const school = await schoolsRepo.findSchoolById(deps.db, id);
    if (!school) return c.json({ error: "not found" }, 404);
    const [areaCodes, warningTypes, rules] = await Promise.all([
      cfg.getAreaCodes(deps.db, id),
      cfg.getWarningTypes(deps.db, id),
      rulesRepo.listRulesBySchool(deps.db, id),
    ]);
    return c.json({ ...school, areaCodes, warningTypes, rules: rules.map(rulesRepo.toSchoolRule) });
  });

  // 学校作成（PRD §13 / created_by = 自分）
  api.post(
    "/schools",
    zValidator(
      "json",
      z.object({
        name: z.string().min(1),
        prefecture: z.string().min(1),
        city: z.string().optional(),
        websiteUrl: z.string().url().optional(),
        rulesUrl: z.string().url().optional(),
        areaCodes: z.array(z.string()).optional(),
        warningTypes: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const school = await schoolsRepo.createSchool(deps.db, {
        name: body.name,
        prefecture: body.prefecture,
        city: body.city ?? null,
        websiteUrl: body.websiteUrl ?? null,
        rulesUrl: body.rulesUrl ?? null,
        createdBy: c.get("userId"),
      });
      if (body.areaCodes) await cfg.setAreaCodes(deps.db, school.id, body.areaCodes);
      if (body.warningTypes) await cfg.setWarningTypes(deps.db, school.id, body.warningTypes);
      return c.json(school, 201);
    },
  );

  // 学校更新（作成者/管理者のみ / PRD §23）
  api.patch(
    "/schools/:id",
    zValidator(
      "json",
      z.object({
        name: z.string().min(1).optional(),
        prefecture: z.string().min(1).optional(),
        city: z.string().nullable().optional(),
        websiteUrl: z.string().url().nullable().optional(),
        rulesUrl: z.string().url().nullable().optional(),
        areaCodes: z.array(z.string()).optional(),
        warningTypes: z.array(z.string()).optional(),
      }),
    ),
    async (c) => {
      const id = c.req.param("id");
      const perm = await checkSchoolEditable(deps.db, {
        schoolId: id,
        userId: c.get("userId"),
        lineUserId: c.get("lineUserId"),
        adminLineUserIds: deps.adminLineUserIds ?? [],
      });
      if (perm === "not_found") return c.json({ error: "not found" }, 404);
      if (perm === "forbidden") return c.json({ error: "forbidden" }, 403);

      const body = c.req.valid("json");
      const { areaCodes, warningTypes, ...patch } = body;
      if (Object.keys(patch).length > 0) await schoolsRepo.updateSchool(deps.db, id, patch);
      if (areaCodes) await cfg.setAreaCodes(deps.db, id, areaCodes);
      if (warningTypes) await cfg.setWarningTypes(deps.db, id, warningTypes);
      const updated = await schoolsRepo.findSchoolById(deps.db, id);
      return c.json(updated);
    },
  );

  // --- Rules（PRD §13 Step4 / §37）---
  api.get("/schools/:id/rules", async (c) => {
    const rows = await rulesRepo.listRulesBySchool(deps.db, c.req.param("id"));
    return c.json(rows.map(rulesRepo.toSchoolRule));
  });

  api.post(
    "/schools/:id/rules",
    zValidator("json", z.object({ checkTime: checkTimeSchema, result: checkResultSchema, message: z.string().optional() })),
    async (c) => {
      const schoolId = c.req.param("id");
      const perm = await checkSchoolEditable(deps.db, {
        schoolId,
        userId: c.get("userId"),
        lineUserId: c.get("lineUserId"),
        adminLineUserIds: deps.adminLineUserIds ?? [],
      });
      if (perm === "not_found") return c.json({ error: "not found" }, 404);
      if (perm === "forbidden") return c.json({ error: "forbidden" }, 403);

      const body = c.req.valid("json");
      const row = await rulesRepo.createRule(deps.db, {
        schoolId,
        checkTime: body.checkTime,
        result: body.result,
        message: body.message ?? null,
      });
      return c.json(rulesRepo.toSchoolRule(row), 201);
    },
  );

  api.patch(
    "/rules/:id",
    zValidator("json", z.object({ checkTime: checkTimeSchema.optional(), result: checkResultSchema.optional(), message: z.string().nullable().optional() })),
    async (c) => {
      const ruleId = c.req.param("id");
      const rule = await rulesRepo.findRuleById(deps.db, ruleId);
      if (!rule) return c.json({ error: "not found" }, 404);
      const perm = await checkSchoolEditable(deps.db, {
        schoolId: rule.schoolId,
        userId: c.get("userId"),
        lineUserId: c.get("lineUserId"),
        adminLineUserIds: deps.adminLineUserIds ?? [],
      });
      if (perm !== "ok") return c.json({ error: perm === "forbidden" ? "forbidden" : "not found" }, perm === "forbidden" ? 403 : 404);

      const updated = await rulesRepo.updateRule(deps.db, ruleId, c.req.valid("json"));
      return c.json(updated ? rulesRepo.toSchoolRule(updated) : null);
    },
  );

  api.delete("/rules/:id", async (c) => {
    const ruleId = c.req.param("id");
    const rule = await rulesRepo.findRuleById(deps.db, ruleId);
    if (!rule) return c.json({ error: "not found" }, 404);
    const perm = await checkSchoolEditable(deps.db, {
      schoolId: rule.schoolId,
      userId: c.get("userId"),
      lineUserId: c.get("lineUserId"),
      adminLineUserIds: deps.adminLineUserIds ?? [],
    });
    if (perm !== "ok") return c.json({ error: perm === "forbidden" ? "forbidden" : "not found" }, perm === "forbidden" ? 403 : 404);
    await rulesRepo.deleteRule(deps.db, ruleId);
    return c.body(null, 204);
  });

  // --- Areas ---
  api.get(
    "/areas",
    zValidator("query", z.object({ prefecture: z.string().optional() })),
    async (c) => {
      const { prefecture } = c.req.valid("query");
      const rows = prefecture
        ? await areasRepo.listAreasByPrefecture(deps.db, prefecture)
        : await areasRepo.listAreas(deps.db);
      return c.json(rows);
    },
  );

  // --- Subscriptions ---
  api.get("/me/subscriptions", async (c) => {
    return c.json(await subsRepo.listSubscriptionsByUser(deps.db, c.get("userId")));
  });

  api.post(
    "/me/subscriptions",
    zValidator("json", z.object({ schoolId: z.string().uuid(), notificationEnabled: z.boolean().optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const school = await schoolsRepo.findSchoolById(deps.db, body.schoolId);
      if (!school) return c.json({ error: "school not found" }, 404);
      const row = await subsRepo.upsertSubscription(deps.db, {
        userId: c.get("userId"),
        schoolId: body.schoolId,
        ...(body.notificationEnabled !== undefined ? { notificationEnabled: body.notificationEnabled } : {}),
      });
      return c.json(row, 201);
    },
  );

  api.delete("/me/subscriptions/:schoolId", async (c) => {
    await subsRepo.removeSubscription(deps.db, c.get("userId"), c.req.param("schoolId"));
    return c.body(null, 204);
  });

  app.route("/api", api);
  return app;
}

export type App = ReturnType<typeof createApp>;
