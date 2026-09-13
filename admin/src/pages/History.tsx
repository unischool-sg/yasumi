import { Box, Link as MuiLink, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
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
      onClick={() => navigate({ to: "/schools/$id", params: { id: schoolId } })}
      sx={{ fontWeight: 600, cursor: "pointer" }}
    >
      {schoolName ?? <code style={{ fontSize: 12 }}>{schoolId.slice(0, 8)}…</code>}
    </MuiLink>
  );
}

export function History() {
  const [tab, setTab] = useState(0);
  const [date, setDate] = useState("");

  const checks = useQuery({ queryKey: ["wc", date], queryFn: () => api.listWarningChecks(date || undefined) });
  const notifs = useQuery({ queryKey: ["notif", date], queryFn: () => api.listNotifications(date || undefined) });

  const checkCols: ColumnDef<WarningCheck, unknown>[] = [
    { header: "対象日", accessorKey: "targetDate" },
    { header: "時刻", accessorKey: "checkedAt", cell: (c) => new Date(c.getValue() as string).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) },
    { header: "学校", accessorKey: "schoolId", cell: (c) => <SchoolLink schoolId={c.getValue() as string} schoolName={c.row.original.schoolName} /> },
    { header: "結果", accessorKey: "result" },
    { header: "警報", accessorKey: "warningActive", cell: (c) => ((c.getValue() as boolean) ? "有" : "—") },
  ];
  const notifCols: ColumnDef<NotificationRow, unknown>[] = [
    { header: "対象日", accessorKey: "targetDate" },
    { header: "送信", accessorKey: "sentAt", cell: (c) => (c.getValue() ? new Date(c.getValue() as string).toLocaleString("ja-JP") : "未送信") },
    { header: "学校", accessorKey: "schoolId", cell: (c) => <SchoolLink schoolId={c.getValue() as string} schoolName={c.row.original.schoolName} /> },
    { header: "状態", accessorKey: "status" },
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
        <DataTable columns={notifCols} data={notifs.data ?? []} empty="通知履歴がありません" />
      )}
    </Box>
  );
}
