import { Box, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { type NotificationRow, type WarningCheck, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";

export function History() {
  const [tab, setTab] = useState(0);
  const [date, setDate] = useState("");

  const checks = useQuery({ queryKey: ["wc", date], queryFn: () => api.listWarningChecks(date || undefined) });
  const notifs = useQuery({ queryKey: ["notif", date], queryFn: () => api.listNotifications(date || undefined) });

  const checkCols: ColumnDef<WarningCheck, unknown>[] = [
    { header: "対象日", accessorKey: "targetDate" },
    { header: "時刻", accessorKey: "checkedAt", cell: (c) => new Date(c.getValue() as string).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) },
    { header: "学校", accessorKey: "schoolId", cell: (c) => <code style={{ fontSize: 12 }}>{(c.getValue() as string).slice(0, 8)}…</code> },
    { header: "結果", accessorKey: "result" },
    { header: "警報", accessorKey: "warningActive", cell: (c) => ((c.getValue() as boolean) ? "有" : "—") },
  ];
  const notifCols: ColumnDef<NotificationRow, unknown>[] = [
    { header: "対象日", accessorKey: "targetDate" },
    { header: "送信", accessorKey: "sentAt", cell: (c) => (c.getValue() ? new Date(c.getValue() as string).toLocaleString("ja-JP") : "未送信") },
    { header: "学校", accessorKey: "schoolId", cell: (c) => <code style={{ fontSize: 12 }}>{(c.getValue() as string).slice(0, 8)}…</code> },
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
