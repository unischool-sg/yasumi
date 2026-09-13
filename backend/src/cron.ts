// 同一プロセス cron（backend/CRON.md）。30分ごと(毎時 :00 / :30)に発火し、
// app.fetch で内部判定エンドポイントを叩く。多重発火は in-flight guard で防ぐ。

interface FetchApp {
  fetch: (req: Request) => Response | Promise<Response>;
}

export interface StartCronOptions {
  internalCronToken: string;
  intervalMinutes?: number; // 既定 30
  /**
   * 境界(:00/:30)からの発火オフセット秒。既定 60。
   * JMA はデータを毎時更新するため、境界ちょうどは CDN が一瞬 5xx を返しうる。
   * 判定の論理時刻(triggeredAt)は境界のままにし、実行だけ数十秒遅らせて取りこぼしを避ける。
   */
  offsetSeconds?: number;
}

/**
 * cron を開始する。戻り値の関数で停止（graceful shutdown / テスト）。
 */
export function startCron(app: FetchApp, opts: StartCronOptions): () => void {
  const intervalMs = (opts.intervalMinutes ?? 30) * 60_000;
  const offsetMs = (opts.offsetSeconds ?? 60) * 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;

  async function callInternal(path: string, triggeredAt: string): Promise<void> {
    try {
      const res = await app.fetch(
        new Request(`http://internal${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": opts.internalCronToken,
          },
          body: JSON.stringify({ triggeredAt }),
        }),
      );
      const summary = await res.json().catch(() => ({}));
      console.log(`[cron] ${path} status=${res.status}`, summary);
    } catch (e) {
      console.error(`[cron] ${path} error`, e);
    }
  }

  async function tick(boundary: Date): Promise<void> {
    if (running) return; // 前回実行中なら重複させない
    running = true;
    try {
      // 論理時刻は境界(:00/:30)。checkTime のスロット一致と判定確定性のため、
      // 実際の発火が数十秒遅れても triggeredAt は境界のまま渡す。
      const triggeredAt = boundary.toISOString();
      // 警報判定パイプライン。
      await callInternal("/api/internal/run-check", triggeredAt);
      // フロー定期実行（既存 cron を再利用）。
      await callInternal("/api/internal/run-flows", triggeredAt);
    } finally {
      running = false;
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    // 次の :00 / :30 境界（epoch 基準の 30分境界は JST の :00/:30 に一致）＋オフセットまで待つ。
    const now = Date.now();
    const nextBoundary = now - (now % intervalMs) + intervalMs;
    const wait = nextBoundary + offsetMs - now;
    timer = setTimeout(async () => {
      await tick(new Date(nextBoundary));
      scheduleNext();
    }, wait);
  }

  scheduleNext();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
