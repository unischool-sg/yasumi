import { zValidator } from "@hono/zod-validator";
import { ALL_WARNING_TYPES, type FlowEventType, isAdminOnlyWarningType } from "@yasumi/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { verify } from "hono/jwt";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { createAdminApp } from "./admin/app.ts";
import { createSchoolApp } from "./school/app.ts";
import { type AuthDeps, type AuthEnv, authMiddleware } from "./auth.ts";
import { checkSchoolEditable } from "./authz.ts";
import { absenceEnabled, isPlanActive } from "../domain/plan.ts";
import { postDiscordMessage } from "../infrastructure/discord/notify.ts";
import { makeErrorReporter } from "../infrastructure/discord/report-error.ts";
import type { AdsConversionProvider } from "../infrastructure/google-ads/conversion.ts";
import { getLineProfile } from "../infrastructure/line/line-api.ts";
import { type Storage, mimeFromKey } from "../infrastructure/storage/s3.ts";
import { exchangeLineCode } from "./line-login.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import type { NotificationProvider } from "../domain/notification/provider.ts";
import type { WarningProvider } from "../domain/warning/provider.ts";
import { verifySignature } from "../infrastructure/line/webhook.ts";
import * as absenceReportsRepo from "../infrastructure/db/repositories/absence-reports.ts";
import * as areasRepo from "../infrastructure/db/repositories/areas.ts";
import * as msgConfirmRepo from "../infrastructure/db/repositories/message-confirmations.ts";
import * as deviceTokensRepo from "../infrastructure/db/repositories/device-tokens.ts";
import * as studentProfilesRepo from "../infrastructure/db/repositories/student-profiles.ts";
import * as cfg from "../infrastructure/db/repositories/school-config.ts";
import * as rulesRepo from "../infrastructure/db/repositories/rules.ts";
import * as schoolsRepo from "../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../infrastructure/db/repositories/subscriptions.ts";
import * as usersRepo from "../infrastructure/db/repositories/users.ts";
import * as warningChecksRepo from "../infrastructure/db/repositories/warning-checks.ts";
import { runCheck } from "../pipeline/run-check.ts";
import { runFlowLogRetention } from "../pipeline/flow-log-retention.ts";
import { runEventFlows } from "../pipeline/run-event-flows.ts";
import { runFlows } from "../pipeline/run-flows.ts";
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
  /** 先生ダッシュボードの JWT 署名鍵（設定時のみ /api/school を有効化）。 */
  schoolJwtSecret?: string;
  /** API の公開URL（確認リンク生成用。例 https://yasumi-api.unischool.jp）。 */
  apiBaseUrl?: string;
  /** LINE 受信メッセージの転送先 Discord Webhook URL（秘密・env 注入）。未設定なら転送しない。 */
  discordWebhookUrl?: string;
  /** 友だち追加・学校購読・学校登録などの活動通知先 Discord Webhook URL（秘密・env 注入）。 */
  discordEventsWebhookUrl?: string;
  /** フロー定期実行のログ送信先 Discord Webhook URL（秘密・env 注入）。未設定なら送らない。 */
  discordFlowWebhookUrl?: string;
  /** 運用アラート（JMA 取得失敗等）の送信先 Discord Webhook URL（秘密・env 注入）。未設定なら送らない。 */
  discordAlertWebhookUrl?: string;
  /** 握りつぶすエラーの通知先 Discord Webhook URL（秘密・env 注入）。未設定なら console.error のみ。 */
  discordErrorWebhookUrl?: string;
  /** 管理画面の公開URL（Discord 転送に載せる連絡リンク用。例 https://yasumi-admin.unischool.jp）。 */
  adminBaseUrl?: string;
  /** ロゴ等のオブジェクトストレージ（RustFS/S3）。未設定ならロゴ機能はドーマント。 */
  storage?: Storage;
  /** Google Ads コンバージョン送信（未設定なら gclid は貯まるが送らない）。 */
  adsConversionProvider?: AdsConversionProvider;
  /** テスト用 fetch 注入（Discord/LINE プロフィール取得）。未指定なら global fetch。 */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** ネイティブ LINE ログインのトークン交換用（LIFF と同じ LINE Login チャネル）。 */
  lineLoginChannelId?: string;
  lineLoginChannelSecret?: string;
  /** LINE Messaging API アクセストークン（管理画面のプロフィール取得用）。 */
  lineChannelAccessToken?: string;
}

const checkResultSchema = z.enum(["NORMAL", "WAIT", "AM_OFF", "PM_START", "FULL_OFF", "UNKNOWN"]);
// check_time は 30分刻み（HH:00 / HH:30）のみ許可（PRD §13 Step4 / M5）。
const checkTimeSchema = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, "HH:00 または HH:30 のみ");
// ルール成立条件（詳細エディタ）。未指定は WARNING_ACTIVE 扱い。
const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("WARNING_ACTIVE") }),
  z.object({ type: z.literal("WARNING_CLEARED"), afterClosureOnly: z.boolean().optional() }),
]);

/** LINE Webhook イベント（必要な部分のみ）。 */
interface LineWebhookEvent {
  type: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

/** Discord 用にインラインコード化（markdown/メンション無効化）。 */
function inlineCode(s: string): string {
  return "`" + String(s ?? "").replace(/`/g, "'") + "`";
}

/** 活動通知（友だち追加・購読・学校登録）を events Webhook へ送る（設定時のみ・best-effort）。 */
async function notifyDiscordEvent(deps: AppDeps, text: string): Promise<void> {
  if (!deps.discordEventsWebhookUrl) return;
  await postDiscordMessage(deps.discordEventsWebhookUrl, text, deps.fetchFn ? { fetchFn: deps.fetchFn } : {});
}

/** 友だち追加(follow)を events Webhook に通知。 */
async function forwardFollowToDiscord(deps: AppDeps, ev: LineWebhookEvent): Promise<void> {
  const lineUserId = ev.source?.userId;
  if (!lineUserId) return;
  const { userId } = await usersRepo.findOrCreateByLineUserId(deps.db, lineUserId);
  const adminBase = deps.adminBaseUrl || "https://yasumi-admin.unischool.jp";
  const profile = deps.lineChannelAccessToken
    ? await getLineProfile(deps.lineChannelAccessToken, lineUserId, deps.fetchFn ? { fetchFn: deps.fetchFn } : {})
    : null;
  const name = profile?.displayName ?? "（不明）";
  await notifyDiscordEvent(
    deps,
    ["**新しい友だち追加**", `名前: ${inlineCode(name)}`, `UID: ${inlineCode(lineUserId)}`, `友だち: ${adminBase}/users/${userId}`].join("\n"),
  );
}

/** 受信 LINE メッセージ1件を Discord に転送（送信主名・LINE UID・admin 連絡リンク・内容）。 */
async function forwardLineMessageToDiscord(deps: AppDeps, ev: LineWebhookEvent): Promise<void> {
  const lineUserId = ev.source?.userId;
  if (!lineUserId || !deps.discordWebhookUrl) return;
  // 内部ユーザー（無ければ作成）→ admin の連絡リンク
  const { userId } = await usersRepo.findOrCreateByLineUserId(deps.db, lineUserId);
  const adminBase = deps.adminBaseUrl || "https://yasumi-admin.unischool.jp";
  const adminLink = `${adminBase}/users/${userId}`;
  // 表示名（bot 未友だち等で取れなければ不明）
  const profile = deps.lineChannelAccessToken
    ? await getLineProfile(deps.lineChannelAccessToken, lineUserId, deps.fetchFn ? { fetchFn: deps.fetchFn } : {})
    : null;
  const name = profile?.displayName ?? "（不明）";
  // 内容（テキスト以外は種別を表示）
  const m = ev.message;
  const content = m?.type === "text" ? (m.text ?? "") : m?.type ? `[${m.type}]` : "（メッセージなし）";
  // ユーザー入力はコードブロックで囲い、markdown/メンション(@everyone等)を無効化。
  // ``` の混入でブロックを抜けられないようゼロ幅で分断する。
  const safeName = name.replace(/`/g, "'");
  const safeContent = content.replace(/```/g, "`​`​`");
  const text = [
    "**LINEメッセージ受信**",
    `送信主: \`${safeName}\``,
    `LINE UID: \`${lineUserId}\``,
    `連絡: ${adminLink}`,
    "内容:",
    "```",
    safeContent,
    "```",
  ].join("\n");
  await postDiscordMessage(deps.discordWebhookUrl, text, deps.fetchFn ? { fetchFn: deps.fetchFn } : {});
}

/**
 * Hono アプリの factory（backend/API.md §2）。依存注入でテスト可能にする。
 * `/health` は無認証、`/api/*` は認証必須。
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AuthEnv>();

  // 握りつぶすエラーの通知口（console.error＋Discord）。
  const reportError = makeErrorReporter(deps.discordErrorWebhookUrl, deps.fetchFn);

  // イベント発火時に、内部エンドポイント経由でイベント連動フローを起動する（best-effort・応答をブロックしない）。
  const emitFlowEvent = (eventType: FlowEventType, ctx: { userId?: string; schoolId?: string } = {}): void => {
    if (!deps.internalCronToken) return; // 内部トークン未設定なら無効
    void Promise.resolve(
      app.fetch(
        new Request("http://internal/api/internal/run-event-flows", {
          method: "POST",
          headers: { "content-type": "application/json", "x-internal-token": deps.internalCronToken },
          body: JSON.stringify({ eventType, ...ctx }),
        }),
      ),
    ).catch((e) => reportError(`emitFlowEvent(${eventType})`, e));
  };

  // 学校ロゴ配信（認証不要・別オリジンの <img> 埋め込み用）。
  // secureHeaders より前に登録し、CORP(same-origin) を適用させない（クロスオリジン埋め込みを許可）。
  app.get("/public/school-logo/:id", async (c) => {
    if (!deps.storage) return c.notFound();
    const school = await schoolsRepo.findSchoolById(deps.db, c.req.param("id"));
    if (!school?.logoKey) return c.notFound();
    const bytes = await deps.storage.get(school.logoKey).catch(() => null);
    if (!bytes) return c.notFound();
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": mimeFromKey(school.logoKey),
        "cache-control": "public, max-age=3600",
        "cross-origin-resource-policy": "cross-origin",
        "access-control-allow-origin": "*",
        // SVG ロゴを直接開いた際のスクリプト実行を封じる（<img> 表示は影響なし）。
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });

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
    // 受信イベント処理: Discord 転送（設定時）＋ イベント連動フロー（友だち追加）。失敗しても 200 は返す。
    try {
      const body = JSON.parse(rawBody) as { events?: LineWebhookEvent[] };
      for (const ev of body.events ?? []) {
        if (!ev.source?.userId) continue;
        if (ev.type === "message" && deps.discordWebhookUrl) await forwardLineMessageToDiscord(deps, ev);
        else if (ev.type === "follow") {
          if (deps.discordEventsWebhookUrl) await forwardFollowToDiscord(deps, ev);
          // イベント連動フロー（友だち追加）。内部 userId を解決して発火。
          const { userId } = await usersRepo.findOrCreateByLineUserId(deps.db, ev.source.userId);
          emitFlowEvent("user.follow", { userId });
        }
      }
    } catch {
      // 受信処理の失敗は無視（LINE への 200 を優先）
    }
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
        ...(deps.discordAlertWebhookUrl
          ? {
              alert: (message: string) =>
                postDiscordMessage(
                  deps.discordAlertWebhookUrl!,
                  message,
                  deps.fetchFn ? { fetchFn: deps.fetchFn } : {},
                ).then(() => undefined),
            }
          : {}),
        emitEvent: ({ eventType, schoolId }) => emitFlowEvent(eventType, { schoolId }),
        ...(deps.now ? { now: deps.now } : {}),
      },
      { triggeredAt },
    );
    return c.json(summary);
  });

  // cron 内部エンドポイント: フロー定期実行（既存 cron の tick から呼ばれる）。
  app.post("/api/internal/run-flows", async (c) => {
    if (!deps.internalCronToken || c.req.header("x-internal-token") !== deps.internalCronToken) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { triggeredAt?: string };
    const triggeredAt = body.triggeredAt ? new Date(body.triggeredAt) : (deps.now?.() ?? new Date());
    const summary = await runFlows(
      {
        db: deps.db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
        ...(deps.discordFlowWebhookUrl ? { discordFlowWebhookUrl: deps.discordFlowWebhookUrl } : {}),
        ...(deps.adminBaseUrl ? { adminBaseUrl: deps.adminBaseUrl } : {}),
        ...(deps.lineChannelAccessToken ? { lineAccessToken: deps.lineChannelAccessToken } : {}),
        ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      },
      { triggeredAt },
    );
    return c.json(summary);
  });

  // 内部エンドポイント: イベント連動フロー実行（各イベント点から app.fetch で叩く）。
  app.post("/api/internal/run-event-flows", async (c) => {
    if (!deps.internalCronToken || c.req.header("x-internal-token") !== deps.internalCronToken) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      eventType?: FlowEventType;
      userId?: string;
      schoolId?: string;
    };
    if (!body.eventType) return c.json({ error: "eventType required" }, 400);
    const summary = await runEventFlows(
      {
        db: deps.db,
        reportError,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
        ...(deps.lineChannelAccessToken ? { lineAccessToken: deps.lineChannelAccessToken } : {}),
        ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      },
      {
        eventType: body.eventType,
        ...(body.userId ? { userId: body.userId } : {}),
        ...(body.schoolId ? { schoolId: body.schoolId } : {}),
      },
    );
    return c.json(summary);
  });

  // cron 内部エンドポイント: フロー実行ログの保持期間管理（30日超を S3 退避のうえ削除）。
  app.post("/api/internal/flow-logs-retention", async (c) => {
    if (!deps.internalCronToken || c.req.header("x-internal-token") !== deps.internalCronToken) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const result = await runFlowLogRetention({
      db: deps.db,
      ...(deps.storage ? { storage: deps.storage } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
    return c.json(result);
  });

  // 公開: 登録済み学校の一覧（landing の学校一覧ページ / 認証不要・PII なし）。
  app.get("/public/schools", async (c) => {
    const now = deps.now?.() ?? new Date();
    const base = deps.apiBaseUrl ?? "";
    const rows = await schoolsRepo.listPublicSchools(deps.db);
    return c.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        prefecture: s.prefecture,
        city: s.city,
        websiteUrl: s.websiteUrl,
        logoUrl: s.logoKey ? `${base}/public/school-logo/${s.id}` : null,
        verified: isPlanActive(s, now), // プラン有効校＝公式連携済みバッジ用
      })),
    );
  });

  // 公式メッセージの「確認しました」リンク（認証不要・署名トークンで本人特定 / M15）。
  app.get("/c/:token", async (c) => {
    const html = (msg: string) =>
      c.html(
        `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>やすみ？</title></head><body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1f1f1f;text-align:center"><div><div style="font-size:44px">✓</div><p style="font-size:18px;font-weight:700">${msg}</p><p style="color:#5f6368;font-size:14px">この画面は閉じて構いません。</p></div></body></html>`,
      );
    if (!deps.schoolJwtSecret) return html("受け付けました");
    try {
      const payload = await verify(c.req.param("token"), deps.schoolJwtSecret, "HS256");
      const messageId = String(payload.m);
      const userId = String(payload.u);
      if (messageId && userId) await msgConfirmRepo.addConfirmation(deps.db, messageId, userId);
      return html("確認を受け付けました");
    } catch {
      return html("リンクの有効期限が切れているか、無効です");
    }
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

  // 広告アトリビューション（gclid）を first-touch 保存（Google Ads コンバージョン計測用）。
  api.post(
    "/me/attribution",
    zValidator("json", z.object({ gclid: z.string().min(1).max(200) })),
    async (c) => {
      await usersRepo.setGclidIfAbsent(deps.db, c.get("userId"), c.req.valid("json").gclid, deps.now?.() ?? new Date());
      return c.json({ ok: true });
    },
  );

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
      if (body.warningTypes) {
        // 生徒/保護者の自己登録では管理者限定の警報は付与不可（既知種別のみ）。
        const allowed = body.warningTypes.filter(
          (t) => ALL_WARNING_TYPES.includes(t) && !isAdminOnlyWarningType(t),
        );
        await cfg.setWarningTypes(deps.db, school.id, allowed);
      }
      // 登録確認メッセージはイベント連動フロー（school.register / 対象:本人）に一本化したため、
      // ここでのハードコード送信は行わない。
      // 活動通知（Discord）
      {
        const adminBase = deps.adminBaseUrl || "https://yasumi-admin.unischool.jp";
        await notifyDiscordEvent(
          deps,
          [
            "**学校が登録されました**",
            `学校: ${school.name}（${school.prefecture}）`,
            `登録者: ${inlineCode(c.get("lineUserId") ?? "unknown")}`,
            `学校: ${adminBase}/schools/${school.id}`,
            `友だち: ${adminBase}/users/${c.get("userId")}`,
          ].join("\n"),
        );
      }
      // イベント連動フロー（学校を登録）。
      emitFlowEvent("school.register", { userId: c.get("userId"), schoolId: school.id });
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
      if (warningTypes) {
        // 生徒側の編集: 管理者限定の警報は生徒が付与/削除できない。
        // 既に管理者が有効化した分は payload に依らず保持する（setWarningTypes は全置換のため）。
        const existing = await cfg.getWarningTypes(deps.db, id);
        const keepAdminOnly = existing.filter((t) => isAdminOnlyWarningType(t));
        const fromUser = warningTypes.filter(
          (t) => ALL_WARNING_TYPES.includes(t) && !isAdminOnlyWarningType(t),
        );
        await cfg.setWarningTypes(deps.db, id, [...new Set([...fromUser, ...keepAdminOnly])]);
      }
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
    zValidator("json", z.object({ checkTime: checkTimeSchema, result: checkResultSchema, condition: conditionSchema.optional(), message: z.string().optional() })),
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
        ...(body.condition ? { condition: body.condition } : {}),
        message: body.message ?? null,
      });
      return c.json(rulesRepo.toSchoolRule(row), 201);
    },
  );

  api.patch(
    "/rules/:id",
    zValidator("json", z.object({ checkTime: checkTimeSchema.optional(), result: checkResultSchema.optional(), condition: conditionSchema.optional(), message: z.string().nullable().optional() })),
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
      // 新規購読か（再購読/トグルでは通知しない）
      const existing = await subsRepo.listSubscriptionsByUser(deps.db, c.get("userId"));
      const isNew = !existing.some((s) => s.schoolId === body.schoolId);
      const row = await subsRepo.upsertSubscription(deps.db, {
        userId: c.get("userId"),
        schoolId: body.schoolId,
        ...(body.notificationEnabled !== undefined ? { notificationEnabled: body.notificationEnabled } : {}),
      });
      if (isNew) {
        const lineUserId = c.get("lineUserId");
        const profile = lineUserId && deps.lineChannelAccessToken
          ? await getLineProfile(deps.lineChannelAccessToken, lineUserId, deps.fetchFn ? { fetchFn: deps.fetchFn } : {})
          : null;
        const who = inlineCode(profile?.displayName ?? lineUserId ?? "unknown");
        const adminBase = deps.adminBaseUrl || "https://yasumi-admin.unischool.jp";
        await notifyDiscordEvent(
          deps,
          [
            "**学校購読**",
            `学校: ${school.name}`,
            `購読者: ${who}`,
            `学校: ${adminBase}/schools/${school.id}`,
            `友だち: ${adminBase}/users/${c.get("userId")}`,
          ].join("\n"),
        );
        // Google Ads コンバージョン（gclid あり・未送信のみ・best-effort）
        if (deps.adsConversionProvider) {
          const attr = await usersRepo.getAttribution(deps.db, c.get("userId"));
          if (attr?.gclid && !attr.gclidConvertedAt) {
            const at = deps.now?.() ?? new Date();
            const ok = await deps.adsConversionProvider.upload({ gclid: attr.gclid, at }).catch(() => false);
            if (ok) await usersRepo.markGclidConverted(deps.db, c.get("userId"), at);
          }
        }
        // イベント連動フロー（学校を購読・初回のみ）。
        emitFlowEvent("school.subscribe", { userId: c.get("userId"), schoolId: body.schoolId });
      }
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

  // --- 生徒プロフィール / 欠席連絡（M13・premium 校のみ受付）---
  const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
  const absenceTypeSchema = z.enum(["欠席", "遅刻", "早退", "休校"]);

  api.get("/me/student-profiles", async (c) =>
    c.json(await studentProfilesRepo.listByOwner(deps.db, c.get("userId"))),
  );

  api.post(
    "/me/student-profiles",
    zValidator("json", z.object({
      schoolId: z.string().uuid(),
      studentName: z.string().min(1).max(100),
      grade: z.string().max(20).optional(),
      className: z.string().max(20).optional(),
    })),
    async (c) => {
      const b = c.req.valid("json");
      const school = await schoolsRepo.findSchoolById(deps.db, b.schoolId);
      if (!school) return c.json({ error: "school not found" }, 404);
      const row = await studentProfilesRepo.createProfile(deps.db, {
        schoolId: b.schoolId,
        ownerUserId: c.get("userId"),
        studentName: b.studentName,
        grade: b.grade ?? null,
        className: b.className ?? null,
      });
      return c.json(row, 201);
    },
  );

  // 自分の購読校のうち、欠席受付が使える（premium 有効）学校
  api.get("/me/absence-schools", async (c) => {
    const now = deps.now?.() ?? new Date();
    const subs = await subsRepo.listSubscriptionsByUser(deps.db, c.get("userId"));
    const out: { id: string; name: string }[] = [];
    for (const s of subs) {
      const school = await schoolsRepo.findSchoolById(deps.db, s.schoolId);
      if (school && absenceEnabled(school, now)) out.push({ id: school.id, name: school.name });
    }
    return c.json(out);
  });

  api.get("/me/absence-reports", async (c) =>
    c.json(await absenceReportsRepo.listByReporter(deps.db, c.get("userId"))),
  );

  api.post(
    "/me/absence-reports",
    zValidator("json", z.object({
      schoolId: z.string().uuid(),
      studentProfileId: z.string().uuid(),
      date: ymdSchema,
      type: absenceTypeSchema,
      reason: z.string().max(1000).optional(),
      note: z.string().max(1000).optional(),
    })),
    async (c) => {
      const b = c.req.valid("json");
      const userId = c.get("userId");
      // 所有権: 自分のプロフィールのみ
      const profile = await studentProfilesRepo.findByIdForOwner(deps.db, b.studentProfileId, userId);
      if (!profile) return c.json({ error: "profile not found" }, 404);
      if (profile.schoolId !== b.schoolId) return c.json({ error: "school mismatch" }, 400);
      const school = await schoolsRepo.findSchoolById(deps.db, b.schoolId);
      if (!school) return c.json({ error: "school not found" }, 404);
      if (!absenceEnabled(school, deps.now?.() ?? new Date())) {
        return c.json({ error: "この学校は欠席受付に対応していません" }, 403);
      }
      // 休校の正当性: その日その学校で警報が出ていたかを自動タグ
      const warningActive = await warningChecksRepo.hasActiveWarningOnDate(deps.db, b.schoolId, b.date);
      const row = await absenceReportsRepo.createReport(deps.db, {
        schoolId: b.schoolId,
        studentProfileId: b.studentProfileId,
        reportedByUserId: userId,
        date: b.date,
        type: b.type,
        reason: b.reason ?? null,
        note: b.note ?? null,
        warningActive,
      });
      // イベント連動フロー（欠席連絡）。
      emitFlowEvent("absence.report", { userId, schoolId: b.schoolId });
      return c.json(row, 201);
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
      createAdminApp({
        db: deps.db,
        adminJwtSecret: deps.adminJwtSecret,
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.lineChannelAccessToken ? { lineAccessToken: deps.lineChannelAccessToken } : {}),
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
        ...(deps.storage ? { storage: deps.storage } : {}),
        ...(deps.discordEventsWebhookUrl ? { discordEventsWebhookUrl: deps.discordEventsWebhookUrl } : {}),
        ...(deps.adminBaseUrl ? { adminBaseUrl: deps.adminBaseUrl } : {}),
      }),
    );
  }

  // 先生ダッシュボード API（教員アカウント認証・自校スコープ）。/api より先に登録する。
  if (deps.schoolJwtSecret) {
    app.route(
      "/api/school",
      createSchoolApp({
        db: deps.db,
        schoolJwtSecret: deps.schoolJwtSecret,
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
        ...(deps.apiBaseUrl ? { apiBaseUrl: deps.apiBaseUrl } : {}),
        ...(deps.storage ? { storage: deps.storage } : {}),
      }),
    );
  }

  app.route("/api", api);
  return app;
}

export type App = ReturnType<typeof createApp>;
