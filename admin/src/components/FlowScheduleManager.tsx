import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type FlowTemplate, api } from "../api/client.ts";
import { useToast } from "./Toast.tsx";

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// 既存 cron は :00 / :30 の30分刻みで発火するため、それに整列した候補のみ。
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

const daysLabel = (days: number[]) => (days.length === 0 ? "毎日" : days.slice().sort().map((d) => DAY_LABELS[d]).join("・"));

export function FlowScheduleManager({ open, onClose, template }: { open: boolean; onClose: () => void; template: FlowTemplate | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const templateId = template?.id ?? "";
  const { data: schedules = [] } = useQuery({
    queryKey: ["flow-schedules", templateId],
    queryFn: () => api.getFlowSchedules(templateId),
    enabled: open && !!templateId,
  });

  const [time, setTime] = useState("07:00");
  const [days, setDays] = useState<number[]>([]);

  const onErr = (e: unknown) => toast.error(`失敗しました: ${(e as Error).message}`);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["flow-schedules", templateId] });

  const addSched = useMutation({
    mutationFn: () => api.createFlowSchedule({ templateId, time, daysOfWeek: days }),
    onSuccess: () => { invalidate(); setDays([]); toast.success("スケジュールを追加しました"); },
    onError: onErr,
  });
  const toggleSched = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.updateFlowSchedule(v.id, { enabled: v.enabled }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const delSched = useMutation({
    mutationFn: (id: string) => api.deleteFlowSchedule(id),
    onSuccess: () => { invalidate(); toast.success("削除しました"); },
    onError: onErr,
  });

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>定期実行スケジュール{template ? `：${template.name}` : ""}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          指定時刻（JST・30分刻み）に、このテンプレートの対象条件を毎回評価して実行します。実行内容は Discord に記録されます。
        </Typography>

        <Stack spacing={1} sx={{ mb: 2 }}>
          {schedules.map((s) => (
            <Box key={s.id} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", bgcolor: "#e8f0fe", borderRadius: 2, px: 1.5, py: 1 }}>
              <Chip label={s.time} color="primary" size="small" />
              <Typography variant="body2">{daysLabel(s.daysOfWeek)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {s.lastRunAt ? `前回: ${new Date(s.lastRunAt).toLocaleString("ja-JP")}` : "未実行"}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Switch size="small" checked={s.enabled} onChange={(e) => toggleSched.mutate({ id: s.id, enabled: e.target.checked })} />
              <Button size="small" color="error" onClick={() => delSched.mutate(s.id)}>削除</Button>
            </Box>
          ))}
          {schedules.length === 0 && <Typography variant="caption" color="text.secondary">スケジュールがありません。</Typography>}
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>スケジュールを追加</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
          <TextField select size="small" label="時刻(JST)" value={time} onChange={(e) => setTime(e.target.value)} sx={{ width: 130 }}>
            {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">曜日（未選択で毎日）</Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ mb: 2, flexWrap: "wrap", gap: 0.5 }}>
          {DAY_LABELS.map((label, d) => (
            <Chip key={d} label={label} size="small" color={days.includes(d) ? "primary" : "default"} variant={days.includes(d) ? "filled" : "outlined"} onClick={() => toggleDay(d)} />
          ))}
        </Stack>
        <Button variant="outlined" size="small" disabled={!templateId || addSched.isPending} onClick={() => addSched.mutate()}>＋ 追加</Button>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
