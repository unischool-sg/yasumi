import {
  Avatar,
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { CHECK_RESULT_LABEL, type CheckResult } from "@yasumi/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { type NotificationRow, type WarningCheck, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";

/** 学校名を該当学校の管理ページへのリンクで表示（名前が無ければIDを短縮表示）。 */
function SchoolLink({ schoolId, schoolName }: { schoolId: string; schoolName: string | null }) {
  const navigate = useNavigate();
  return (
    <MuiLink
      component="button"
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // 行クリック（詳細モーダル）を発火させない
        navigate({ to: "/schools/$id", params: { id: schoolId } });
      }}
      sx={{ fontWeight: 600, cursor: "pointer" }}
    >
      {schoolName ?? <code style={{ fontSize: 12 }}>{schoolId.slice(0, 8)}…</code>}
    </MuiLink>
  );
}

/** CheckResult の日本語ラベル（未知の値はそのまま表示）。 */
function resultLabel(status: string): string {
  return CHECK_RESULT_LABEL[status as CheckResult] ?? status;
}

/** 通知1件の送信結果を要約した表示（成功 / 配信不能 / 未送信）。 */
function SentStatusChip({ row }: { row: Pick<NotificationRow, "sentAt" | "error"> }) {
  if (row.sentAt) return <Chip size="small" color="success" label="送信成功" />;
  if (row.error) return <Chip size="small" color="error" label="送信失敗" />;
  return <Chip size="small" color="default" label="未送信" />;
}

/** 通知の詳細モーダル（送信本文 / 宛先プロフィール / 成否・エラーログ）。 */
function NotificationDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: ["notif-detail", id],
    queryFn: () => api.getNotification(id as string),
    enabled: !!id,
  });
  const d = detail.data;

  return (
    <Dialog open={!!id} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>通知の詳細</DialogTitle>
      <DialogContent>
        {detail.isLoading && <Typography variant="body2">読み込み中…</Typography>}
        {detail.isError && <Typography color="error">詳細の取得に失敗しました。</Typography>}
        {d && (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {/* 送信結果 */}
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <SentStatusChip row={d} />
              <Chip size="small" variant="outlined" label={`判定: ${resultLabel(d.status)}`} />
              {d.channel && <Chip size="small" variant="outlined" label={`経路: ${d.channel.toUpperCase()}`} />}
              <Chip size="small" variant="outlined" label={`対象日: ${d.targetDate}`} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {d.sentAt
                ? `送信時刻: ${new Date(d.sentAt).toLocaleString("ja-JP")}`
                : "この通知は配信が完了していません。"}
            </Typography>

            <Divider />

            {/* 宛先ユーザー */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>宛先ユーザー</Typography>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Avatar src={d.profile?.pictureUrl} sx={{ width: 48, height: 48 }}>
                  {d.profile?.displayName?.[0] ?? "?"}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {d.profile?.displayName ?? "（LINEプロフィール未取得）"}
                  </Typography>
                  <Stack direction="row" spacing={1.5}>
                    <MuiLink
                      component="button"
                      type="button"
                      onClick={() => navigate({ to: "/users/$id", params: { id: d.userId } })}
                      sx={{ fontSize: 13 }}
                    >
                      ユーザー詳細
                    </MuiLink>
                    <SchoolLink schoolId={d.schoolId} schoolName={d.schoolName} />
                  </Stack>
                  {d.lineUserId && (
                    <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                      LINE User ID: {d.lineUserId}
                    </Typography>
                  )}
                </Box>
              </Stack>
              {!d.profile && d.lineUserId && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  プロフィールを取得できません（未友だち / ブロック の可能性）。
                </Typography>
              )}
            </Box>

            <Divider />

            {/* 送信本文 */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>送信しようとした本文</Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  bgcolor: "#f8f9fa",
                  borderRadius: 1,
                  border: "1px solid #eceff1",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                {d.messageText ?? "（本文の記録がありません）"}
              </Box>
            </Box>

            {/* エラーログ（失敗時のみ） */}
            {d.error && (
              <Box>
                <Typography variant="subtitle2" color="error" sx={{ mb: 1 }}>エラーログ</Typography>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    bgcolor: "#fff5f5",
                    borderRadius: 1,
                    border: "1px solid #ffcdd2",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    color: "#b71c1c",
                  }}
                >
                  {d.error}
                </Box>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function History() {
  const [tab, setTab] = useState(0);
  const [date, setDate] = useState("");
  const [selectedNotif, setSelectedNotif] = useState<string | null>(null);

  const checks = useQuery({ queryKey: ["wc", date], queryFn: () => api.listWarningChecks(date || undefined) });
  const notifs = useQuery({ queryKey: ["notif", date], queryFn: () => api.listNotifications(date || undefined) });

  const checkCols: ColumnDef<WarningCheck, unknown>[] = [
    { header: "対象日", accessorKey: "targetDate" },
    { header: "時刻", accessorKey: "checkedAt", cell: (c) => new Date(c.getValue() as string).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) },
    { header: "学校", accessorKey: "schoolId", cell: (c) => <SchoolLink schoolId={c.getValue() as string} schoolName={c.row.original.schoolName} /> },
    { header: "結果", accessorKey: "result", cell: (c) => resultLabel(c.getValue() as string) },
    { header: "警報", accessorKey: "warningActive", cell: (c) => ((c.getValue() as boolean) ? "有" : "—") },
  ];
  const notifCols: ColumnDef<NotificationRow, unknown>[] = [
    { header: "対象日", accessorKey: "targetDate" },
    { header: "送信結果", accessorKey: "sentAt", cell: (c) => <SentStatusChip row={c.row.original} /> },
    { header: "送信時刻", accessorKey: "sentAt", id: "sentAtTime", cell: (c) => (c.getValue() ? new Date(c.getValue() as string).toLocaleString("ja-JP") : "—") },
    { header: "学校", accessorKey: "schoolId", cell: (c) => <SchoolLink schoolId={c.getValue() as string} schoolName={c.row.original.schoolName} /> },
    { header: "状態", accessorKey: "status", cell: (c) => resultLabel(c.getValue() as string) },
  ];

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flexGrow: 1 }}>判定・通知履歴</Typography>
        <TextField size="small" type="date" label="日付" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={`判定 (${checks.data?.length ?? 0})`} />
        <Tab label={`通知 (${notifs.data?.length ?? 0})`} />
      </Tabs>
      {tab === 0 ? (
        <DataTable columns={checkCols} data={checks.data ?? []} empty="判定履歴がありません" />
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            行をクリックすると送信本文・宛先・エラーログを確認できます。
          </Typography>
          <DataTable columns={notifCols} data={notifs.data ?? []} empty="通知履歴がありません" onRowClick={(r) => setSelectedNotif(r.id)} />
        </>
      )}
      <NotificationDetailDialog id={selectedNotif} onClose={() => setSelectedNotif(null)} />
    </Box>
  );
}
