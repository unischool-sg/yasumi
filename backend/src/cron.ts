// 同一プロセス cron（backend/CRON.md）。30分ごと(毎時 :00 / :30)に発火し、
// app.fetch で内部判定エンドポイントを叩く。多重発火は in-flight guard で防ぐ。

interface FetchApp {
  fetch: (req: Request) => Response | Promise<Response>;
}

export interface StartCronOptions {
  internalCronToken: string;
  intervalMinutes?: number; // 既定 30
}

/**
 * cron を開始する。戻り値の関数で停止（graceful shutdown / テスト）。
 */
export function startCron(app: FetchApp, opts: StartCronOptions): () => void {
  const intervalMs = (opts.intervalMinutes ?? 30) * 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;

  async function tick(): Promise<void> {
    if (running) return; // 前回実行中なら重複させない
    running = true;
    try {
      const res = await app.fetch(
        new Request("http://internal/api/internal/run-check", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": opts.internalCronToken,
          },
          body: JSON.stringify({ triggeredAt: new Date().toISOString() }),
        }),
      );
      const summary = await res.json().catch(() => ({}));
      console.log(`[cron] run-check status=${res.status}`, summary);
    } catch (e) {
      console.error("[cron] run-check error", e);
    } finally {
      running = false;
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    // 次の :00 / :30 境界まで待つ（epoch 基準の 30分境界は JST の :00/:30 に一致）
    const wait = intervalMs - (Date.now() % intervalMs);
    timer = setTimeout(async () => {
      await tick();
      scheduleNext();
    }, wait);
  }

  scheduleNext();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
