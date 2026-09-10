import {
  Box, Button, Card, CardContent, Divider, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type MessageCategory, api } from "../api/client.ts";
import { PlanChip } from "../components/Layout.tsx";
import { useToast } from "../components/Toast.tsx";

const CAT_LABEL: Record<MessageCategory, string> = { emergency: "休校・緊急", announcement: "お知らせ" };

export function Dashboard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { data: subscribers = [] } = useQuery({ queryKey: ["subscribers"], queryFn: api.getSubscribers });
  const { data: messages = [] } = useQuery({ queryKey: ["messages"], queryFn: api.getMessages });

  const [text, setText] = useState("");
  const [category, setCategory] = useState<MessageCategory>("emergency");

  const send = useMutation({
    mutationFn: () => api.broadcast(text, category),
    onSuccess: (r) => {
      setText("");
      qc.invalidateQueries({ queryKey: ["messages"] });
      toast.success(`送信しました（到達 ${r.sent}/${r.total} 件）`);
    },
    onError: (e) => toast.error(`送信に失敗しました: ${(e as Error).message}`),
  });

  const doSend = () => {
    if (!window.confirm(`購読者 ${subscribers.length} 名に「${CAT_LABEL[category]}」として送信します。よろしいですか？`)) return;
    send.mutate();
  };

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{me?.school?.name ?? "—"}</Typography>
        <PlanChip plan={me?.school?.plan ?? null} expiresAt={me?.school?.planExpiresAt ?? null} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">購読者 <b>{subscribers.length}</b> 名</Typography>
      </Stack>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>公式メッセージを一斉送信</Typography>
          <Stack spacing={1.5}>
            <TextField select size="small" label="種別" value={category} onChange={(e) => setCategory(e.target.value as MessageCategory)} sx={{ width: 220 }}>
              <MenuItem value="emergency">休校・緊急（無制限）</MenuItem>
              <MenuItem value="announcement">お知らせ</MenuItem>
            </TextField>
            <TextField
              fullWidth multiline minRows={3}
              placeholder="例）本日は暴風警報発表のため休校とします。登校の必要はありません。"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Box>
              <Button variant="contained" disabled={!text.trim() || subscribers.length === 0 || send.isPending} onClick={doSend}>
                購読者へ送信
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>送信履歴・到達状況</Typography>
          <Divider sx={{ mb: 1 }} />
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>日時</TableCell>
                <TableCell>種別</TableCell>
                <TableCell>本文</TableCell>
                <TableCell align="right">到達</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {messages.map((m) => (
                <TableRow key={m.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(m.createdAt).toLocaleString("ja-JP")}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{CAT_LABEL[m.category]}</TableCell>
                  <TableCell sx={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.text}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <b>{m.sent}</b> / {m.total}
                    {m.failed > 0 && <Typography component="span" variant="caption" color="error"> （失敗{m.failed}）</Typography>}
                  </TableCell>
                </TableRow>
              ))}
              {messages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                      まだ送信していません
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
