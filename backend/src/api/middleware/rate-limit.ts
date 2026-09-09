import type { MiddlewareHandler } from "hono";

/**
 * 最小限のメモリ内レートリミット（PRD §54）。固定ウィンドウ方式。
 * 分散環境では別途 Redis 等が必要だが MVP はプロセス内で十分。
 */
export function rateLimit(options: { windowMs?: number; max?: number; now?: () => number } = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 300;
  const now = options.now ?? (() => Date.now());
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const key =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";
    const t = now();
    const entry = hits.get(key);
    if (!entry || t >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: t + windowMs });
    } else {
      entry.count++;
      if (entry.count > max) {
        return c.json({ error: "too many requests" }, 429);
      }
    }
    await next();
  };
}
