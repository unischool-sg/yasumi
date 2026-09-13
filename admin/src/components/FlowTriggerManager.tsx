import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FLOW_EVENT_LABEL,
  FLOW_EVENT_TYPES,
  FLOW_TRIGGER_AUDIENCE_LABEL,
  type FlowEventType,
  type FlowTriggerAudienceMode,
  availableAudienceModes,
} from "@yasumi/shared";
import { useState } from "react";
import { type FlowTemplate, api } from "../api/client.ts";
import { useToast } from "./Toast.tsx";

export function FlowTriggerManager({ open, onClose, template }: { open: boolean; onClose: () => void; template: FlowTemplate | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const templateId = template?.id ?? "";
  const { data: triggers = [] } = useQuery({
    queryKey: ["flow-triggers", templateId],
    queryFn: () => api.getFlowTriggers(templateId),
    enabled: open && !!templateId,
  });

  const [eventType, setEventType] = useState<FlowEventType>("user.follow");
  const modeOptions = availableAudienceModes(eventType);
  const [audienceMode, setAudienceMode] = useState<FlowTriggerAudienceMode>("trigger_user");
  // イベントを変えたら、そのイベントで有効な最初のモードに寄せる。
  const ensureMode = (ev: FlowEventType) => {
    const modes = availableAudienceModes(ev);
    if (!modes.includes(audienceMode)) setAudienceMode(modes[0]!);
  };

  const onErr = (e: unknown) => toast.error(`失敗しました: ${(e as Error).message}`);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["flow-triggers", templateId] });

  const addTrigger = useMutation({
    mutationFn: () => api.createFlowTrigger({ templateId, eventType, audienceMode }),
    onSuccess: () => { invalidate(); toast.success("トリガーを追加しました"); },
    onError: onErr,
  });
  const toggleTrigger = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.updateFlowTrigger(v.id, { enabled: v.enabled }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const delTrigger = useMutation({
    mutationFn: (id: string) => api.deleteFlowTrigger(id),
    onSuccess: () => { invalidate(); toast.success("削除しました"); },
    onError: onErr,
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>イベント連動{template ? `：${template.name}` : ""}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          指定したイベントが発生したときに、このテンプレートを自動実行します。対象は「本人」「対象校の購読者」「対象条件（他の人）」から選べます。
        </Typography>

        <Stack spacing={1} sx={{ mb: 2 }}>
          {triggers.map((t) => (
            <Box key={t.id} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", bgcolor: "#e8f0fe", borderRadius: 2, px: 1.5, py: 1 }}>
              <Chip label={FLOW_EVENT_LABEL[t.eventType]} color="primary" size="small" />
              <Typography variant="body2">→ {FLOW_TRIGGER_AUDIENCE_LABEL[t.audienceMode]}</Typography>
              <Box sx={{ flex: 1 }} />
              <Switch size="small" checked={t.enabled} onChange={(e) => toggleTrigger.mutate({ id: t.id, enabled: e.target.checked })} />
              <Button size="small" color="error" onClick={() => delTrigger.mutate(t.id)}>削除</Button>
            </Box>
          ))}
          {triggers.length === 0 && <Typography variant="caption" color="text.secondary">トリガーがありません。</Typography>}
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>トリガーを追加</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
          <TextField
            select
            size="small"
            label="イベント"
            value={eventType}
            onChange={(e) => { const ev = e.target.value as FlowEventType; setEventType(ev); ensureMode(ev); }}
            sx={{ minWidth: 160 }}
          >
            {FLOW_EVENT_TYPES.map((ev) => <MenuItem key={ev} value={ev}>{FLOW_EVENT_LABEL[ev]}</MenuItem>)}
          </TextField>
          <TextField
            select
            size="small"
            label="対象"
            value={audienceMode}
            onChange={(e) => setAudienceMode(e.target.value as FlowTriggerAudienceMode)}
            sx={{ minWidth: 180 }}
          >
            {modeOptions.map((m) => <MenuItem key={m} value={m}>{FLOW_TRIGGER_AUDIENCE_LABEL[m]}</MenuItem>)}
          </TextField>
          <Button variant="outlined" size="small" disabled={!templateId || addTrigger.isPending} onClick={() => addTrigger.mutate()}>＋ 追加</Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
