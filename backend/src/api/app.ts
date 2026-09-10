import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { createAdminApp } from "./admin/app.ts";
import { type AuthDeps, type AuthEnv, authMiddleware } from "./auth.ts";
import { checkSchoolEditable } from "./authz.ts";
import { notifyUser } from "../domain/notification/dispatch.ts";
import { exchangeLineCode } from "./line-login.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import type { NotificationProvider } from "../domain/notification/provider.ts";
import type { WarningProvider } from "../domain/warning/provider.ts";
import { verifySignature } from "../infrastructure/line/webhook.ts";
import * as areasRepo from "../infrastructure/db/repositories/areas.ts";
import * as deviceTokensRepo from "../infrastructure/db/repositories/device-tokens.ts";
import * as cfg from "../infrastructure/db/repositories/school-config.ts";
import * as rulesRepo from "../infrastructure/db/repositories/rules.ts";
import * as schoolsRepo from "../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../infrastructure/db/repositories/subscriptions.ts";
import * as warningChecksRepo from "../infrastructure/db/repositories/warning-checks.ts";
import { runCheck } from "../pipeline/run-check.ts";
import { jstDateString } from "../shared/jst.ts";

export interface AppDeps extends AuthDeps {
  /** 管理者の LINE ユーザーID（学校/ルール編集の許可 / PRD §23）。 */
  adminLineUserIds?: string[];
  /** LINE Webhook 署名検証用のチャネルシークレット（PRD §54）。 */
  lineChannelSecret?: string;
  /** cron 内部エンドポイントの認可トークン（backend/CRON.md §5）。 */
  internalCronToken?: string;
  /** 判定パイプライン用（M7）。未設定なら run-check は 503。 */
  warningProvider?: WarningProvider;
  notificationProvider?: NotificationProvider;
  /** FCM プッシュ（無料通知）。設定時はデバイストークン登録済みユーザーへ優先送信。 */
  pushProvider?: NotificationProvider;
  /** テスト用の現在時刻。 */
  now?: () => Date;
  /** 管理画面の JWT 署名鍵（設定時のみ /api/admin を有効化）。 */
  adminJwtSecret?: string;
  /** ネイティブ LINE ログインのトークン交換用（LIFF と同じ LINE Login チャネル）。 */
  lineLoginChannelId?: string;
  lineLoginChannelSecret?: string;
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

  // LINE Webhook（認証不要・署名必須 / PRD §37, §54）。auth より前に登録する。
  app.post("/api/webhooks/line", async (c) => {
    const secret = deps.lineChannelSecret;
    if (!secret) return c.json({ error: "webhook not configured" }, 503);
    const rawBody = await c.req.text();
    const signature = c.req.header("x-line-signature");
    if (!verifySignature(rawBody, signature, secret)) {
      return c.json({ error: "invalid signature" }, 401);
    }
    // MVP: イベントは最小処理（200 応答）。友だち追加/リッチメニューは将来（§20）。
    return c.json({ ok: true });
  });

  // cron 内部エンドポイント（内部トークン認可 / backend/CRON.md §5, §6）。
  app.post("/api/internal/run-check", async (c) => {
    if (!deps.internalCronToken || c.req.header("x-internal-token") !== deps.internalCronToken) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!deps.warningProvider || !deps.notificationProvider) {
      return c.json({ error: "pipeline not configured" }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as { triggeredAt?: string };
    const triggeredAt = body.triggeredAt ? new Date(body.triggeredAt) : (deps.now?.() ?? new Date());
    const summary = await runCheck(
      {
        db: deps.db,
        warningProvider: deps.warningProvider,
        notificationProvider: deps.notificationProvider,
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      },
      { triggeredAt },
    );
    return c.json(summary);
  });

  // 公開: 登録済み学校の一覧（landing の学校一覧ページ / 認証不要・PII なし）。
  app.get("/public/schools", async (c) => {
    return c.json(await schoolsRepo.listPublicSchools(deps.db));
  });

  // ネイティブアプリの LINE ログイン: 認可コード → ID トークン交換（channel secret はサーバー保持）。
  // 認証不要（ログイン前）。返す idToken を以降 Authorization: Bearer に使う。
  app.post(
    "/api/auth/line/token",
    zValidator(
      "json",
      z.object({ code: z.string().min(1), codeVerifier: z.string().min(1), redirectUri: z.string().min(1) }),
    ),
    async (c) => {
      if (!deps.lineLoginChannelId || !deps.lineLoginChannelSecret) {
        return c.json({ error: "line login not configured" }, 503);
      }
      const b = c.req.valid("json");
      try {
        const { idToken } = await exchangeLineCode({
          code: b.code,
          codeVerifier: b.codeVerifier,
          redirectUri: b.redirectUri,
          channelId: deps.lineLoginChannelId,
          channelSecret: deps.lineLoginChannelSecret,
        });
        return c.json({ idToken });
      } catch {
        return c.json({ error: "exchange failed" }, 400);
      }
    },
  );

  const api = new Hono<AuthEnv>();
  api.use("*", rateLimit());
  api.use("*", authMiddleware(deps));

  // --- User ---
  api.get("/me", (c) => c.json({ userId: c.get("userId") }));

  // 自分が作成した学校の一覧（LIFF「編集」タブ / PRD §23）
  api.get("/me/schools", async (c) => {
    return c.json(await schoolsRepo.listSchoolsByCreator(deps.db, c.get("userId")));
  });

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
      // 作成者へ確認通知（デバイストークンがあれば FCM、無ければ LINE。失敗しても 201 は返す）
      await notifyUser(
        deps,
        c.get("userId"),
        `「${school.name}」を登録しました！\n同じ学校のみんなで共有されます。\n\n朝の判定時刻に自動でチェックして、休校などをお知らせします。`,
      );
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

  // --- Device tokens（ネイティブアプリ/PWA の FCM プッシュ通知先 / 無料通知）---
  api.post(
    "/me/device-tokens",
    zValidator("json", z.object({ token: z.string().min(1), platform: z.enum(["ios", "android", "web"]) })),
    async (c) => {
      const body = c.req.valid("json");
      const row = await deviceTokensRepo.upsertDeviceToken(deps.db, {
        userId: c.get("userId"),
        platform: body.platform,
        token: body.token,
        ...(deps.now ? { now: deps.now() } : {}),
      });
      return c.json(row, 201);
    },
  );

  api.delete(
    "/me/device-tokens",
    zValidator("query", z.object({ token: z.string().min(1) })),
    async (c) => {
      await deviceTokensRepo.removeDeviceToken(deps.db, c.get("userId"), c.req.valid("query").token);
      return c.body(null, 204);
    },
  );

  // --- Status / History（PRD §15〜§17, §37 / ホーム画面）---
  api.get("/schools/:id/status", async (c) => {
    const id = c.req.param("id");
    const school = await schoolsRepo.findSchoolById(deps.db, id);
    if (!school) return c.json({ error: "not found" }, 404);
    const today = jstDateString(deps.now?.() ?? new Date());
    const checks = await warningChecksRepo.listWarningChecksBySchoolAndDate(deps.db, id, today);
    const latest = checks[0];
    return c.json({
      schoolId: id,
      schoolName: school.name,
      date: today,
      latest: latest
        ? { result: latest.result, checkedAt: latest.checkedAt, warnings: latest.rawData ?? [] }
        : null,
      checks,
    });
  });

  api.get("/schools/:id/history", async (c) => {
    const rows = await warningChecksRepo.listWarningChecksBySchool(deps.db, c.req.param("id"));
    return c.json(rows);
  });

  // 管理画面 API（LIFF とは別系統・独自 JWT）。/api より先に登録する。
  if (deps.adminJwtSecret) {
    app.route(
      "/api/admin",
      createAdminApp({ db: deps.db, adminJwtSecret: deps.adminJwtSecret, ...(deps.now ? { now: deps.now } : {}) }),
    );
  }

  app.route("/api", api);
  return app;
}

export type App = ReturnType<typeof createApp>;
