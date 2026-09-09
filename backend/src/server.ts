import { createApp } from "./api/app.ts";
import { createLineIdTokenVerifier } from "./api/auth.ts";
import { getDb } from "./infrastructure/db/client.ts";

const port = Number(process.env.PORT ?? 3000);
const channelId = process.env.LIFF_CHANNEL_ID ?? "";
const adminLineUserIds = (process.env.ADMIN_LINE_USER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = createApp({
  db: getDb(),
  verifyIdToken: createLineIdTokenVerifier(channelId),
  adminLineUserIds,
});

// M7: ここで startCron(app) を呼び、30分ごとに app.fetch("/api/internal/run-check")
// を叩く同一プロセス cron を起動する（backend/CRON.md 参照）。
// const stopCron = startCron(app);

console.log(`[yasumi] api listening on :${port}`);

// Bun.serve 準拠のデフォルトエクスポート（`bun run src/server.ts` で起動）。
export default {
  port,
  fetch: app.fetch,
};
