import {
  Alert, Box, Button, Card, CardContent, Checkbox, Divider, FormControlLabel, MenuItem,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type MessageCategory, api } from "../api/client.ts";
import { PlanChip } from "../components/Layout.tsx";
import { useToast } from "../components/Toast.tsx";

const CAT_LABEL: Record<MessageCategory, string> = { emergency: "休校・緊急", announcement: "お知らせ" };

// 組み込みプリセット（DB保存の学校テンプレに加えて常に選べる）。
const PRESETS: { title: string; category: MessageCategory; body: string }[] = [
  { title: "暴風警報で休校", category: "emergency", body: "本日は暴風警報が発表されているため、全日休校とします。登校の必要はありません。" },
  { title: "午前休", category: "emergency", body: "本日は気象警報のため、午前は自宅待機としてください。以降の対応は追ってご連絡します。" },
  { title: "行事のお知らせ", category: "announcement", body: "" },
];

export function Dashboard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { data: subscribers = [] } = useQuery({ queryKey: ["subscribers"], queryFn: api.getSubscribers });
  const { data: messages = [] } = useQuery({ queryKey: ["messages"], queryFn: api.getMessages });
  const { data: quota } = useQuery({ queryKey: ["quota"], queryFn: api.getQuota });
  const { data: drafts = [] } = useQuery({ queryKey: ["drafts"], queryFn: api.getDrafts });
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: api.getTemplates });

  const [text, setText] = useState("");
  const [category, setCategory] = useState<MessageCategory>("emergency");
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [newTpl, setNewTpl] = useState<{ title: string; category: MessageCategory; body: string }>({ title: "", category: "emergency", body: "" });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["messages"] });
    qc.invalidateQueries({ queryKey: ["quota"] });
  };

  const send = useMutation({
    mutationFn: () => api.broadcast(text, category, requireConfirmation),
    onSuccess: (r) => { setText(""); invalidateAll(); toast.success(`送信しました（到達 ${r.sent}/${r.total} 件）`); },
    onError: (e) => toast.error(`送信に失敗しました: ${(e as Error).message}`),
  });
  const sendDraft = useMutation({
    mutationFn: (d: { id: string; text: string }) => api.sendDraft(d.id, d.text),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["drafts"] }); invalidateAll(); toast.success(`公式送信しました（到達 ${r.sent}/${r.total} 件）`); },
    onError: (e) => toast.error(`送信に失敗しました: ${(e as Error).message}`),
  });
  const dismissDraft = useMutation({
    mutationFn: (id: string) => api.dismissDraft(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["drafts"] }); toast.success("下書きを却下しました"); },
    onError: (e) => toast.error(`失敗しました: ${(e as Error).message}`),
  });
  const addTemplate = useMutation({
    mutationFn: () => api.createTemplate(newTpl),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); setNewTpl({ title: "", category: "emergency", body: "" }); toast.success("テンプレートを保存しました"); },
    onError: (e) => toast.error(`失敗しました: ${(e as Error).message}`),
  });
  const delTemplate = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); toast.success("削除しました"); },
    onError: (e) => toast.error(`失敗しました: ${(e as Error).message}`),
  });

  const annLimit = quota?.announcement.limit ?? null;
  const annUsed = quota?.announcement.used ?? 0;
  const annExhausted = category === "announcement" && annLimit !== null && annUsed >= annLimit;

  const doSend = () => {
    if (!window.confirm(`購読者 ${subscribers.length} 名に「${CAT_LABEL[category]}」として送信します。よろしいですか？`)) return;
    send.mutate();
  };

  const allTemplates = [...PRESETS.map((p, i) => ({ id: `preset-${i}`, ...p })), ...templates];

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{me?.school?.name ?? "—"}</Typography>
        <PlanChip plan={me?.school?.plan ?? null} expiresAt={me?.school?.planExpiresAt ?? null} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">購読者 <b>{subscribers.length}</b> 名</Typography>
      </Stack>

      {/* 警報連動の休校ドラフト（自動生成） */}
      {drafts.map((d) => <DraftBanner key={d.id} draft={d} onSend={(t) => sendDraft.mutate({ id: d.id, text: t })} onDismiss={() => dismissDraft.mutate(d.id)} pending={sendDraft.isPending || dismissDraft.isPending} />)}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>公式メッセージを一斉送信</Typography>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <TextField select size="small" label="種別" value={category} onChange={(e) => setCategory(e.target.value as MessageCategory)} sx={{ width: 200 }}>
                <MenuItem value="emergency">休校・緊急（無制限）</MenuItem>
                <MenuItem value="announcement">お知らせ</MenuItem>
              </TextField>
              <TextField select size="small" label="テンプレから挿入" value="" onChange={(e) => {
                const t = allTemplates.find((x) => x.id === e.target.value);
                if (t) { setText(t.body); setCategory(t.category); }
              }} sx={{ width: 220 }}>
                {allTemplates.map((t) => <MenuItem key={t.id} value={t.id}>{t.title}</MenuItem>)}
              </TextField>
              {category === "announcement" && (
                <Typography variant="caption" color={annExhausted ? "error" : "text.secondary"}>
                  今月のお知らせ：{annUsed}{annLimit === null ? "（無制限）" : ` / ${annLimit} 通`}
                </Typography>
              )}
            </Stack>
            <TextField fullWidth multiline minRows={3} placeholder="例）本日は暴風警報発表のため休校とします。登校の必要はありません。" value={text} onChange={(e) => setText(e.target.value)} />
            <FormControlLabel
              control={<Checkbox size="small" checked={requireConfirmation} onChange={(e) => setRequireConfirmation(e.target.checked)} />}
              label={<Typography variant="body2">「確認しました」ボタンを付ける（保護者の確認状況を集計）</Typography>}
            />
            <Box>
              <Button variant="contained" disabled={!text.trim() || subscribers.length === 0 || annExhausted || send.isPending} onClick={doSend}>
                購読者へ送信
              </Button>
              {annExhausted && (
                <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
                  今月のお知らせ送信が上限に達しました。緊急連絡は引き続き無制限で送信できます。
                </Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* テンプレート管理 */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>テンプレート管理</Typography>
          <Stack spacing={0.5} sx={{ mb: 1.5 }}>
            {templates.map((t) => (
              <Stack key={t.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 140 }}>{t.title}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.body}</Typography>
                <Button size="small" color="error" onClick={() => delTemplate.mutate(t.id)}>削除</Button>
              </Stack>
            ))}
            {templates.length === 0 && <Typography variant="caption" color="text.secondary">保存済みテンプレートはありません（上の挿入には組み込みプリセットも使えます）</Typography>}
          </Stack>
          <Divider sx={{ mb: 1.5 }} />
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <TextField size="small" label="タイトル" value={newTpl.title} onChange={(e) => setNewTpl({ ...newTpl, title: e.target.value })} sx={{ width: 160 }} />
            <TextField size="small" select label="種別" value={newTpl.category} onChange={(e) => setNewTpl({ ...newTpl, category: e.target.value as MessageCategory })} sx={{ width: 120 }}>
              <MenuItem value="emergency">緊急</MenuItem>
              <MenuItem value="announcement">お知らせ</MenuItem>
            </TextField>
            <TextField size="small" label="本文" value={newTpl.body} onChange={(e) => setNewTpl({ ...newTpl, body: e.target.value })} sx={{ flex: 1, minWidth: 220 }} multiline />
            <Button variant="outlined" disabled={!newTpl.title.trim() || !newTpl.body.trim() || addTemplate.isPending} onClick={() => addTemplate.mutate()}>保存</Button>
          </Stack>
        </CardContent>
      </Card>

      {/* 送信履歴 */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>送信履歴・到達/確認状況</Typography>
          <Divider sx={{ mb: 1 }} />
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>日時</TableCell>
                <TableCell>種別</TableCell>
                <TableCell>本文</TableCell>
                <TableCell align="right">到達</TableCell>
                <TableCell align="right">確認</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {messages.map((m) => (
                <TableRow key={m.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(m.createdAt).toLocaleString("ja-JP")}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{CAT_LABEL[m.category]}</TableCell>
                  <TableCell sx={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.text}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <b>{m.sent}</b> / {m.total}{m.failed > 0 && <Typography component="span" variant="caption" color="error"> （失敗{m.failed}）</Typography>}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {m.requireConfirmation ? `${m.confirmedCount} / ${m.total}` : <Typography component="span" variant="caption" color="text.secondary">—</Typography>}
                  </TableCell>
                </TableRow>
              ))}
              {messages.length === 0 && (
                <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>まだ送信していません</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}

function DraftBanner({ draft, onSend, onDismiss, pending }: { draft: { id: string; text: string; targetDate: string }; onSend: (text: string) => void; onDismiss: () => void; pending: boolean }) {
  const [text, setText] = useState(draft.text);
  return (
    <Alert severity="warning" sx={{ mb: 2, "& .MuiAlert-message": { width: "100%" } }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        警報を検知しました（{draft.targetDate}）。休校連絡の下書きです。内容を確認して送信してください。
      </Typography>
      <TextField fullWidth multiline minRows={3} size="small" value={text} onChange={(e) => setText(e.target.value)} sx={{ my: 1, bgcolor: "#fff" }} />
      <Stack direction="row" spacing={1}>
        <Button variant="contained" color="warning" disabled={pending || !text.trim()} onClick={() => { if (window.confirm("この内容で購読者へ公式送信します。よろしいですか？")) onSend(text); }}>
          公式送信する
        </Button>
        <Button color="inherit" disabled={pending} onClick={onDismiss}>却下</Button>
      </Stack>
    </Alert>
  );
}
