import { app } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);

// M7: ここで startCron(app) を呼び、30分ごとに app.fetch("/api/internal/run-check")
// を叩く同一プロセス cron を起動する（backend/CRON.md 参照）。
// const stopCron = startCron(app);

console.log(`[yasumi] api listening on :${port}`);

// Bun.serve 準拠のデフォルトエクスポート（`bun run src/server.ts` で起動）。
export default {
  port,
  fetch: app.fetch,
};
