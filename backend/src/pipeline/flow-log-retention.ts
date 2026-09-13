import type { Db } from "../infrastructure/db/client.ts";
import {
  deleteFlowRunLogsByIds,
  listFlowRunLogsBefore,
} from "../infrastructure/db/repositories/flow-run-logs.ts";
import type { Storage } from "../infrastructure/storage/s3.ts";

export interface FlowLogRetentionDeps {
  db: Db;
  /** S3互換ストレージ。未設定なら退避できないため削除もしない（データ保全）。 */
  storage?: Storage;
  now?: () => Date;
  /** 保持日数。既定 30 日。 */
  retentionDays?: number;
}

export interface FlowLogRetentionResult {
  archived: number;
  deleted: number;
  /** 実行しなかった理由（あれば）。 */
  skipped?: string;
  /** 退避先の S3 キー（退避した場合）。 */
  archiveKey?: string;
}

/**
 * フロー実行ログの保持期間（既定30日）を超えた分を S3 に JSON 退避してから削除する。
 * cron tick（JST 03:00）から /api/internal/flow-logs-retention 経由で呼ばれる。
 * storage 未設定時は「退避できない＝削除もしない」で安全側に倒す（ドーマント）。
 */
export async function runFlowLogRetention(deps: FlowLogRetentionDeps): Promise<FlowLogRetentionResult> {
  const now = deps.now?.() ?? new Date();
  const days = deps.retentionDays ?? 30;
  const cutoff = new Date(now.getTime() - days * 86_400_000);

  if (!deps.storage) {
    console.warn("[flow-log-retention] storage 未設定のためスキップ（退避できないので削除もしない）");
    return { archived: 0, deleted: 0, skipped: "no-storage" };
  }

  const expired = await listFlowRunLogsBefore(deps.db, cutoff);
  if (expired.length === 0) return { archived: 0, deleted: 0 };

  // S3 に JSON でまとめて退避（1回の retention 実行につき1オブジェクト）。
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const archiveKey = `flow-logs/expired-${stamp}.json`;
  const body = JSON.stringify(
    { exportedAt: now.toISOString(), cutoff: cutoff.toISOString(), count: expired.length, logs: expired },
    null,
    2,
  );
  await deps.storage.put(archiveKey, new TextEncoder().encode(body), "application/json");

  // 退避成功後にのみ削除（退避で例外なら削除は行われない）。
  await deleteFlowRunLogsByIds(
    deps.db,
    expired.map((r) => r.id),
  );

  console.log(`[flow-log-retention] archived ${expired.length} logs to ${archiveKey} and deleted`);
  return { archived: expired.length, deleted: expired.length, archiveKey };
}
