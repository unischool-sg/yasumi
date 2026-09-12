import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import type { FlowStep } from "@yasumi/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type AdminMessageTemplate, type FlowTemplate, api } from "../api/client.ts";
import { flowStepsValid } from "./FlowStepsEditor.tsx";
import { FlowStepsEditor } from "./FlowStepsEditor.tsx";
import { EMPTY_QUERY, type UserQuery, UserQueryEditor, querySummary } from "./UserQueryEditor.tsx";
import { useToast } from "./Toast.tsx";

export function FlowTemplateEditor({
  open,
  onClose,
  initial,
  templates,
  flagNames,
  schoolOptions,
}: {
  open: boolean;
  onClose: () => void;
  initial: FlowTemplate | null;
  templates: AdminMessageTemplate[];
  flagNames: string[];
  schoolOptions: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [allUsers, setAllUsers] = useState(false);
  const [query, setQuery] = useState<UserQuery>(EMPTY_QUERY);
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);

  // モーダルを開くたびに初期値を反映。
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setAllUsers(initial?.allUsers ?? false);
    setQuery(initial?.query ?? EMPTY_QUERY);
    setSteps(initial?.steps ?? []);
  }, [open, initial]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), allUsers, query, steps };
      return initial ? api.updateFlowTemplate(initial.id, body) : api.createFlowTemplate(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flow-templates"] });
      toast.success("テンプレートを保存しました");
      onClose();
    },
    onError: (e) => toast.error(`保存に失敗しました: ${(e as Error).message}`),
  });

  const valid = name.trim().length > 0 && flowStepsValid(steps);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? "テンプレートを編集" : "テンプレートを作成"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField label="テンプレート名" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>対象</Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <FormControlLabel control={<Checkbox size="small" checked={allUsers} onChange={(e) => setAllUsers(e.target.checked)} />} label="全ユーザーを対象" />
              <Button variant="outlined" size="small" disabled={allUsers} onClick={() => setEditorOpen(true)}>条件エディターを開く</Button>
            </Stack>
            {!allUsers && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>条件：{querySummary(query)}</Typography>
            )}
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>フロー（ステップ）</Typography>
            <FlowStepsEditor steps={steps} onChange={setSteps} templates={templates} flagNames={flagNames} />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!valid || save.isPending} onClick={() => save.mutate()}>保存</Button>
      </DialogActions>

      <UserQueryEditor open={editorOpen} onClose={() => setEditorOpen(false)} query={query} onChange={setQuery} flagNames={flagNames} schoolOptions={schoolOptions} />
    </Dialog>
  );
}
