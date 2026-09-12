import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from "@mui/material";
import { type FlowStep, describeFlowStep } from "@yasumi/shared";
import { useState } from "react";
import { type AdminMessageTemplate, api } from "../api/client.ts";
import { FlowStepsEditor, flowStepsValid } from "./FlowStepsEditor.tsx";
import { useToast } from "./Toast.tsx";

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
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [running, setRunning] = useState(false);

  const valid = flowStepsValid(steps);

  async function run() {
    const lines = [`対象: ${audienceIds.length} 名`, "", ...steps.map((st, i) => `${i + 1}. ${describeFlowStep(st)}`)];
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
        <Stack spacing={1}>
          <FlowStepsEditor steps={steps} onChange={setSteps} templates={templates} flagNames={flagNames} />
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
