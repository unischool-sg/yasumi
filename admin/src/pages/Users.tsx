import { Box, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type UserRow, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";
import { useToast } from "../components/Toast.tsx";

export function Users() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data = [] } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });

  const [text, setText] = useState("");
  const broadcast = useMutation({
    mutationFn: () => api.broadcast(text, { type: "all" }),
    onSuccess: (r) => { setText(""); toast.success(`一斉送信しました（${r.sent}/${r.total} 件）`); },
    onError: (e) => toast.error(`送信に失敗しました: ${(e as Error).message}`),
  });

  const send = () => {
    if (!window.confirm(`全ユーザー（${data.length}名）にメッセージを送信します。よろしいですか？`)) return;
    broadcast.mutate();
  };

  const columns: ColumnDef<UserRow, unknown>[] = [
    { header: "内部ID", accessorKey: "id", cell: (c) => <code style={{ fontSize: 12 }}>{(c.getValue() as string).slice(0, 8)}…</code> },
    { header: "LINE ユーザーID", accessorKey: "lineUserId", cell: (c) => <code style={{ fontSize: 12 }}>{c.getValue() as string}</code> },
    { header: "登録日", accessorKey: "createdAt", cell: (c) => new Date(c.getValue() as string).toLocaleString("ja-JP") },
    {
      header: "",
      id: "actions",
      cell: (c) => (
        <Button size="small" onClick={() => navigate({ to: "/users/$id", params: { id: c.row.original.id } })}>
          詳細・管理
        </Button>
      ),
    },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>ユーザー（{data.length}）</Typography>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>全ユーザーに一斉送信</Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              placeholder="全ユーザーへ送るメッセージ（デバイス登録があればアプリ通知、無ければLINE）"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button variant="contained" color="warning" disabled={!text.trim() || broadcast.isPending} onClick={send} sx={{ flexShrink: 0, mt: 0.5 }}>
              一斉送信
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <DataTable columns={columns} data={data} empty="ユーザーがいません" />
    </Box>
  );
}
