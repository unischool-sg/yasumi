import { createApp } from "./api/app.ts";
import { createLineIdTokenVerifier } from "./api/auth.ts";
import { startCron } from "./cron.ts";
import { getDb } from "./infrastructure/db/client.ts";
import { FcmNotificationProvider } from "./infrastructure/fcm/fcm-notification-provider.ts";
import { JmaWarningProvider } from "./infrastructure/jma/jma-warning-provider.ts";
import { LineNotificationProvider } from "./infrastructure/line/line-notification-provider.ts";

const port = Number(process.env.PORT ?? 3000);
const channelId = process.env.LIFF_CHANNEL_ID ?? "";
const internalCronToken = process.env.INTERNAL_CRON_TOKEN ?? "";
// ADMIN_JWT_SECRET が設定されていれば管理画面 API を有効化
if (!process.env.ADMIN_JWT_SECRET) {
  console.warn("[yasumi] ADMIN_JWT_SECRET 未設定のため管理画面 API(/api/admin) は無効");
}
const adminLineUserIds = (process.env.ADMIN_LINE_USER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// FCM(無料プッシュ)。サービスアカウント3点が揃っている時だけ有効化。
// 未設定ならデバイストークン登録済みでも LINE プッシュにフォールバックする。
const fcmProjectId = process.env.FCM_PROJECT_ID ?? "";
const fcmClientEmail = process.env.FCM_CLIENT_EMAIL ?? "";
const fcmPrivateKey = process.env.FCM_PRIVATE_KEY ?? "";
const pushProvider =
  fcmProjectId && fcmClientEmail && fcmPrivateKey
    ? new FcmNotificationProvider({
        credentials: { projectId: fcmProjectId, clientEmail: fcmClientEmail, privateKey: fcmPrivateKey },
      })
    : undefined;
if (!pushProvider) {
  console.warn("[yasumi] FCM_* 未設定のため FCM プッシュは無効（LINE プッシュのみ）");
}

const app = createApp({
  db: getDb(),
  verifyIdToken: createLineIdTokenVerifier(channelId),
  adminLineUserIds,
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  internalCronToken,
  ...(process.env.ADMIN_JWT_SECRET ? { adminJwtSecret: process.env.ADMIN_JWT_SECRET } : {}),
  // ネイティブ LINE ログイン（LIFF と同じチャネル）。secret 未設定なら /api/auth/line/token は 503。
  lineLoginChannelId: channelId,
  lineLoginChannelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET ?? "",
  warningProvider: new JmaWarningProvider(),
  notificationProvider: new LineNotificationProvider({
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  }),
  ...(pushProvider ? { pushProvider } : {}),
});

// 同一プロセス cron を起動（30分ごと・app.fetch 駆動 / backend/CRON.md）。
if (internalCronToken) {
  const stopCron = startCron(app, { internalCronToken });
  const shutdown = () => {
    stopCron();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} else {
  console.warn("[yasumi] INTERNAL_CRON_TOKEN 未設定のため cron を起動しません");
}

console.log(`[yasumi] api listening on :${port}`);

// Bun.serve 準拠のデフォルトエクスポート（`bun run src/server.ts` で起動）。
export default {
  port,
  fetch: app.fetch,
};
