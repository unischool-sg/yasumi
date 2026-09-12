import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import { useState } from "react";
import { type AdminMessageTemplate, api } from "../api/client.ts";
import { useToast } from "./Toast.tsx";

type StepType = "send" | "addFlag" | "removeFlag";
interface Step { id: string; type: StepType; text?: string; flag?: string }
const genId = () => (crypto.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.random()}`);
const STEP_LABEL: Record<StepType, string> = { send: "メッセージ送信", addFlag: "フラグ付与", removeFlag: "フラグ解除" };

export function UserFlowRunner({
  open, onClose, audienceIds, templates, flagNames, onRan,
}: {
  open: boolean;
  onClose: () => void;
  audienceIds: string[];
  templates: AdminMessageTemplate[];
  flagNames: string[];
  onRan: () => void;
}) {
  const toast = useToast();
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);

  const add = (type: StepType) => setSteps((s) => [...s, { id: genId(), type, text: "", flag: flagNames[0] ?? "" }]);
  const update = (id: string, patch: Partial<Step>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => setSteps((s) => s.filter((x) => x.id !== id));
  const move = (i: number, d: -1 | 1) => setSteps((s) => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });

  const summary = (st: Step) =>
    st.type === "send" ? `送信: ${(st.text || "（空）").slice(0, 30)}` : `${STEP_LABEL[st.type]}: ${st.flag || "（未選択）"}`;
  const valid = steps.length > 0 && steps.every((st) => (st.type === "send" ? !!st.text?.trim() : !!st.flag));

  async function run() {
    const lines = [`対象: ${audienceIds.length} 名`, "", ...steps.map((st, i) => `${i + 1}. ${summary(st)}`)];
    if (!window.confirm(`次の内容で実行します。よろしいですか？\n\n${lines.join("\n")}`)) return;
    setRunning(true);
    try {
      const results: string[] = [];
      for (const st of steps) {
        if (st.type === "send") {
          const r = await api.broadcast(st.text ?? "", { type: "users", userIds: audienceIds });
          results.push(`送信 ${r.sent}/${r.total}`);
        } else if (st.type === "addFlag") {
          const r = await api.assignFlag(audienceIds, st.flag!);
          results.push(`フラグ付与「${st.flag}」 ${r.assigned}/${r.total}`);
        } else {
          await api.unassignFlag(audienceIds, st.flag!);
          results.push(`フラグ解除「${st.flag}」 ${audienceIds.length}`);
        }
      }
      toast.success(`フロー実行完了：${results.join(" / ")}`);
      onRan();
      onClose();
    } catch (e) {
      toast.error(`実行に失敗しました: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>フローを実行</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          対象は現在の絞り込み結果 <b>{audienceIds.length}</b> 名（実行開始時に固定）。ステップを上から順に実行します。
        </Alert>
        <Stack spacing={1} sx={{ mb: 1 }}>
          {steps.map((st, i) => (
            <Box key={st.id} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", bgcolor: "#fef7e0", borderRadius: 2, px: 1.5, py: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 96 }}>{i + 1}. {STEP_LABEL[st.type]}</Typography>
              {st.type === "send" ? (
                <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 200, alignItems: "center" }}>
                  <TextField select size="small" variant="standard" label="定型文" value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) update(st.id, { text: t.body }); }} sx={{ width: 120 }}>
                    {templates.length === 0 && <MenuItem value="" disabled>なし</MenuItem>}
                    {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.title}</MenuItem>)}
                  </TextField>
                  <TextField size="small" variant="standard" placeholder="本文" value={st.text} onChange={(e) => update(st.id, { text: e.target.value })} sx={{ flex: 1 }} multiline />
                </Stack>
              ) : (
                <TextField select size="small" variant="standard" label="フラグ" value={st.flag} onChange={(e) => update(st.id, { flag: e.target.value })} sx={{ minWidth: 140 }}>
                  {flagNames.length === 0 && <MenuItem value="" disabled>（フラグ未定義）</MenuItem>}
                  {flagNames.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                </TextField>
              )}
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}>↑</IconButton>
              <IconButton size="small" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</IconButton>
              <IconButton size="small" onClick={() => remove(st.id)}>✕</IconButton>
            </Box>
          ))}
          {steps.length === 0 && <Typography variant="caption" color="text.secondary">ステップがありません。下のボタンで追加。</Typography>}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => add("send")}>＋ 送信</Button>
          <Button size="small" onClick={() => add("addFlag")}>＋ フラグ付与</Button>
          <Button size="small" onClick={() => add("removeFlag")}>＋ フラグ解除</Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>閉じる</Button>
        <Button variant="contained" disabled={!valid || audienceIds.length === 0 || running} onClick={run}>
          実行（確認あり）
        </Button>
      </DialogActions>
    </Dialog>
  );
}
