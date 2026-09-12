import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography } from "@mui/material";
import type { FlowStep, FlowStepType } from "@yasumi/shared";
import { useState } from "react";
import type { AdminMessageTemplate } from "../api/client.ts";

export const STEP_LABEL: Record<FlowStepType, string> = { send: "メッセージ送信", addFlag: "フラグ付与", removeFlag: "フラグ解除" };
export const genStepId = () => (crypto.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.random()}`);

export function flowStepsValid(steps: FlowStep[]): boolean {
  return steps.length > 0 && steps.every((st) => (st.type === "send" ? !!st.text?.trim() : !!st.flag));
}

/** ステップ（送信 / フラグ付与 / フラグ解除）の編集 UI。フロー実行・テンプレート編集で共用。 */
export function FlowStepsEditor({
  steps,
  onChange,
  templates,
  flagNames,
}: {
  steps: FlowStep[];
  onChange: (steps: FlowStep[]) => void;
  templates: AdminMessageTemplate[];
  flagNames: string[];
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const add = (type: FlowStepType) => onChange([...steps, { id: genStepId(), type, text: "", flag: flagNames[0] ?? "" }]);
  const update = (id: string, patch: Partial<FlowStep>) => onChange(steps.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => onChange(steps.filter((x) => x.id !== id));
  const move = (i: number, d: -1 | 1) => {
    const n = [...steps];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j]!, n[i]!];
    onChange(n);
  };

  return (
    <>
      <Stack spacing={1} sx={{ mb: 1 }}>
        {steps.map((st, i) => (
          <Box key={st.id} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", bgcolor: "#fef7e0", borderRadius: 2, px: 1.5, py: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 96 }}>{i + 1}. {STEP_LABEL[st.type]}</Typography>
            {st.type === "send" ? (
              <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 200, alignItems: "center" }}>
                <Typography variant="body2" color={st.text?.trim() ? "text.primary" : "text.secondary"} sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {st.text?.trim() ? st.text : "本文未設定"}
                </Typography>
                <Button size="small" onClick={() => { setEditId(st.id); setDraft(st.text ?? ""); }}>本文を編集</Button>
              </Stack>
            ) : (
              <TextField select size="small" variant="standard" label="フラグ" value={st.flag ?? ""} onChange={(e) => update(st.id, { flag: e.target.value })} sx={{ minWidth: 140 }}>
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

      {/* 本文編集モーダル */}
      <Dialog open={editId !== null} onClose={() => setEditId(null)} fullWidth maxWidth="sm">
        <DialogTitle>本文を編集</DialogTitle>
        <DialogContent dividers>
          <TextField select size="small" fullWidth label="定型文から挿入" value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setDraft(t.body); }} sx={{ mb: 2 }}>
            {templates.length === 0 && <MenuItem value="" disabled>（定型文がありません）</MenuItem>}
            {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.title}</MenuItem>)}
          </TextField>
          <TextField fullWidth multiline minRows={5} placeholder="メッセージ本文" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditId(null)}>キャンセル</Button>
          <Button variant="contained" disabled={!draft.trim()} onClick={() => { if (editId) update(editId, { text: draft }); setEditId(null); }}>OK</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
