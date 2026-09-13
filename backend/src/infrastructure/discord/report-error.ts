import { postDiscordMessage } from "./notify.ts";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** エラー内容を1行に整形（cause も残す）。 */
function formatError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const base = `${err.name}: ${err.message}`;
    if (cause instanceof Error) return `${base} <- ${cause.name}: ${cause.message}`;
    return base;
  }
  return String(err);
}

/** context と error を受け取り、console.error＋（設定時）Discord へ送るレポーター。 */
export type ErrorReporter = (context: string, err: unknown) => void;

/**
 * 握りつぶすエラーの通知口を作る。
 * 必ず console.error にも出し、webhookUrl 設定時は Discord にも送る（best-effort）。
 */
export function makeErrorReporter(webhookUrl?: string, fetchFn?: FetchFn): ErrorReporter {
  return (context, err) => {
    console.error(`[error] ${context}`, err);
    if (!webhookUrl) return;
    const msg = `🛑 **エラー** ${context}\n\`${formatError(err)}\``;
    void postDiscordMessage(webhookUrl, msg, fetchFn ? { fetchFn } : {}).catch((e) =>
      console.error("[report-error] discord post failed", e),
    );
  };
}
