import { createApp } from "./api/app.ts";
import { createLineIdTokenVerifier } from "./api/auth.ts";
import { startCron } from "./cron.ts";
import { getDb } from "./infrastructure/db/client.ts";
import { FcmNotificationProvider } from "./infrastructure/fcm/fcm-notification-provider.ts";
import { JmaWarningProvider } from "./infrastructure/jma/jma-warning-provider.ts";
import { LineNotificationProvider } from "./infrastructure/line/line-notification-provider.ts";
import { createGoogleAdsConversionProvider } from "./infrastructure/google-ads/conversion.ts";
import { createS3Storage } from "./infrastructure/storage/s3.ts";

const port = Number(process.env.PORT ?? 3000);
const channelId = process.env.LIFF_CHANNEL_ID ?? "";
const internalCronToken = process.env.INTERNAL_CRON_TOKEN ?? "";
// ADMIN_JWT_SECRET が設定されていれば管理画面 API を有効化
if (!process.env.ADMIN_JWT_SECRET) {
  console.warn("[yasumi] ADMIN_JWT_SECRET 未設定のため管理画面 API(/api/admin) は無効");
}
if (!process.env.SCHOOL_JWT_SECRET) {
  console.warn("[yasumi] SCHOOL_JWT_SECRET 未設定のため先生ダッシュボード API(/api/school) は無効");
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

// オブジェクトストレージ（RustFS/S3互換）。資格情報が揃っている時だけ有効化。
const storage = createS3Storage({
  endpoint: process.env.S3_ENDPOINT ?? "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  bucket: process.env.S3_BUCKET ?? "",
  region: process.env.S3_REGION ?? "us-east-1",
});
if (!storage) console.warn("[yasumi] S3_* 未設定のためロゴ機能は無効");

// Google Ads コンバージョン送信。資格情報が揃っている時だけ有効化。
const adsConversionProvider = createGoogleAdsConversionProvider({
  developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
  clientId: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
  refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
  customerId: process.env.GOOGLE_ADS_CUSTOMER_ID ?? "",
  loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "",
  conversionAction: process.env.GOOGLE_ADS_CONVERSION_ACTION ?? "",
});
if (!adsConversionProvider) console.warn("[yasumi] GOOGLE_ADS_* 未設定のためコンバージョン送信は無効（gclidは保存のみ）");

const app = createApp({
  db: getDb(),
  ...(storage ? { storage } : {}),
  ...(adsConversionProvider ? { adsConversionProvider } : {}),
  verifyIdToken: createLineIdTokenVerifier(channelId),
  adminLineUserIds,
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  internalCronToken,
  ...(process.env.ADMIN_JWT_SECRET ? { adminJwtSecret: process.env.ADMIN_JWT_SECRET } : {}),
  ...(process.env.SCHOOL_JWT_SECRET ? { schoolJwtSecret: process.env.SCHOOL_JWT_SECRET } : {}),
  // 確認リンク（/c/:token）の絶対URL生成用。既定は本番APIドメイン。
  apiBaseUrl: process.env.API_PUBLIC_BASE_URL || "https://yasumi-api.unischool.jp",
  // LIFF ID（VITE_LIFF_ID / PUBLIC_LIFF_ID と同じ値）。設定時、判定通知に友達招待リンク
  // https://liff.line.me/<LIFF_ID> を添える（校内密度グロース）。未設定ならドーマント。
  ...(process.env.LIFF_ID ? { miniAppUrl: `https://liff.line.me/${process.env.LIFF_ID}` } : {}),
  // LINE 受信メッセージの Discord 転送（秘密・未設定なら転送しない）。
  ...(process.env.DISCORD_WEBHOOK_URL ? { discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL } : {}),
  ...(process.env.DISCORD_EVENTS_WEBHOOK_URL ? { discordEventsWebhookUrl: process.env.DISCORD_EVENTS_WEBHOOK_URL } : {}),
  ...(process.env.DISCORD_FLOW_WEBHOOK_URL ? { discordFlowWebhookUrl: process.env.DISCORD_FLOW_WEBHOOK_URL } : {}),
  // 運用アラート（JMA 取得失敗等）の Discord 送信先（秘密・未設定なら送らない）。
  ...(process.env.DISCORD_ALERT_WEBHOOK_URL ? { discordAlertWebhookUrl: process.env.DISCORD_ALERT_WEBHOOK_URL } : {}),
  // 握りつぶすエラーの Discord 送信先（秘密・未設定なら console.error のみ）。
  ...(process.env.DISCORD_ERROR_WEBHOOK_URL ? { discordErrorWebhookUrl: process.env.DISCORD_ERROR_WEBHOOK_URL } : {}),
  adminBaseUrl: process.env.ADMIN_PUBLIC_BASE_URL || "https://yasumi-admin.unischool.jp",
  // ネイティブ LINE ログイン（LIFF と同じチャネル）。secret 未設定なら /api/auth/line/token は 503。
  lineLoginChannelId: channelId,
  lineLoginChannelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET ?? "",
  warningProvider: new JmaWarningProvider(),
  notificationProvider: new LineNotificationProvider({
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  }),
  ...(pushProvider ? { pushProvider } : {}),
  // 管理画面のプロフィール取得・メッセージ送信用
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
});

// 同一プロセス cron を起動（30分ごと・app.fetch 駆動 / backend/CRON.md）。
// 境界(:00/:30)ちょうどは JMA 更新境界の一時的 5xx を踏みやすいため、既定 60 秒ずらす。
if (internalCronToken) {
  const offsetSeconds = process.env.CRON_OFFSET_SECONDS
    ? Number(process.env.CRON_OFFSET_SECONDS)
    : undefined;
  const stopCron = startCron(app, {
    internalCronToken,
    ...(offsetSeconds !== undefined && Number.isFinite(offsetSeconds) ? { offsetSeconds } : {}),
  });
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
