import { createApp } from "./api/app.ts";
import { createLineIdTokenVerifier } from "./api/auth.ts";
import { startCron } from "./cron.ts";
import { getDb } from "./infrastructure/db/client.ts";
import { JmaWarningProvider } from "./infrastructure/jma/jma-warning-provider.ts";
import { LineNotificationProvider } from "./infrastructure/line/line-notification-provider.ts";

const port = Number(process.env.PORT ?? 3000);
const channelId = process.env.LIFF_CHANNEL_ID ?? "";
const internalCronToken = process.env.INTERNAL_CRON_TOKEN ?? "";
const adminLineUserIds = (process.env.ADMIN_LINE_USER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = createApp({
  db: getDb(),
  verifyIdToken: createLineIdTokenVerifier(channelId),
  adminLineUserIds,
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  internalCronToken,
  warningProvider: new JmaWarningProvider(),
  notificationProvider: new LineNotificationProvider({
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  }),
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
