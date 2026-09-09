import { Hono } from "hono";

/**
 * Hono アプリ本体。ルーティングをここに集約する。
 * `app.fetch` を通じて HTTP サーバー・テスト・cron（M7）から同一経路で叩ける。
 */
export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

export type App = typeof app;
