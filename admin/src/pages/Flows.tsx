import { Box, Button, Card, CardContent, Checkbox, Chip, Divider, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client.ts";
import { useToast } from "../components/Toast.tsx";
import { EMPTY_QUERY, type UserQuery, UserQueryEditor, compareUsers, matchesQuery, querySummary } from "../components/UserQueryEditor.tsx";
import { UserFlowRunner } from "../components/UserFlowRunner.tsx";

export function Flows() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const { data: templates = [] } = useQuery({ queryKey: ["admin-templates"], queryFn: api.getMessageTemplates });
  const { data: flagDefs = [] } = useQuery({ queryKey: ["flag-defs"], queryFn: api.getFlagDefs });
  const flagNames = flagDefs.map((f) => f.name);

  const [query, setQuery] = useState<UserQuery>(EMPTY_QUERY);
  const [editorOpen, setEditorOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [allUsers, setAllUsers] = useState(false);
  const [newTpl, setNewTpl] = useState({ title: "", body: "" });
  const [newFlag, setNewFlag] = useState("");

  const shown = allUsers ? users : users.filter((u) => matchesQuery(u, query)).sort((a, b) => compareUsers(a, b, query.sorts));
  const audienceIds = shown.map((u) => u.id);

  const onErr = (e: unknown) => toast.error(`失敗しました: ${(e as Error).message}`);
  const addTpl = useMutation({ mutationFn: () => api.createMessageTemplate(newTpl), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-templates"] }); setNewTpl({ title: "", body: "" }); toast.success("定型文を保存しました"); }, onError: onErr });
  const delTpl = useMutation({ mutationFn: (id: string) => api.deleteMessageTemplate(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-templates"] }); toast.success("削除しました"); }, onError: onErr });
  const addFlagDef = useMutation({ mutationFn: () => api.createFlagDef({ name: newFlag.trim() }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["flag-defs"] }); setNewFlag(""); toast.success("フラグを作成しました"); }, onError: onErr });
  const delFlagDef = useMutation({ mutationFn: (name: string) => api.deleteFlagDef(name), onSuccess: () => { qc.invalidateQueries({ queryKey: ["flag-defs"] }); qc.invalidateQueries({ queryKey: ["users"] }); toast.success("フラグを削除しました"); }, onError: onErr });

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>フロー（一括施策）</Typography>

      {/* 対象 */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>1. 対象を決める</Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <FormControlLabel control={<Checkbox size="small" checked={allUsers} onChange={(e) => setAllUsers(e.target.checked)} />} label="全ユーザーを対象" />
            <Button variant="outlined" size="small" disabled={allUsers} onClick={() => setEditorOpen(true)}>条件エディターを開く</Button>
            <Box sx={{ flex: 1 }} />
            <Typography variant="body2" color="text.secondary">対象: <b>{audienceIds.length}</b> / {users.length} 名</Typography>
          </Stack>
          {!allUsers && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>現在の条件：{querySummary(query)}</Typography>
          )}
        </CardContent>
      </Card>

      {/* フロー */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="subtitle2">2. フローを組んで実行</Typography>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" disabled={audienceIds.length === 0} onClick={() => setFlowOpen(true)}>フローを実行</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            対象 → ステップ（メッセージ送信 / フラグ付与 / フラグ解除）を順に実行。実行前に件数を確認します。
          </Typography>
        </CardContent>
      </Card>

      {/* 定型文 */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>定型文の管理</Typography>
          <Stack spacing={0.5} sx={{ mb: 1.5 }}>
            {templates.map((t) => (
              <Stack key={t.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 140 }}>{t.title}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.body}</Typography>
                <Button size="small" color="error" onClick={() => delTpl.mutate(t.id)}>削除</Button>
              </Stack>
            ))}
            {templates.length === 0 && <Typography variant="caption" color="text.secondary">定型文がありません</Typography>}
          </Stack>
          <Divider sx={{ mb: 1.5 }} />
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <TextField size="small" label="タイトル" value={newTpl.title} onChange={(e) => setNewTpl({ ...newTpl, title: e.target.value })} sx={{ width: 160 }} />
            <TextField size="small" label="本文" value={newTpl.body} onChange={(e) => setNewTpl({ ...newTpl, body: e.target.value })} sx={{ flex: 1, minWidth: 220 }} multiline />
            <Button variant="outlined" disabled={!newTpl.title.trim() || !newTpl.body.trim() || addTpl.isPending} onClick={() => addTpl.mutate()}>保存</Button>
          </Stack>
        </CardContent>
      </Card>

      {/* フラグ */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>フラグの管理</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mb: 1.5 }}>
            {flagDefs.map((f) => <Chip key={f.name} label={f.name} onDelete={() => delFlagDef.mutate(f.name)} variant="outlined" />)}
            {flagDefs.length === 0 && <Typography variant="caption" color="text.secondary">フラグがありません</Typography>}
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="フラグ名" value={newFlag} onChange={(e) => setNewFlag(e.target.value)} sx={{ width: 200 }} />
            <Button variant="outlined" disabled={!newFlag.trim() || addFlagDef.isPending} onClick={() => addFlagDef.mutate()}>作成</Button>
          </Stack>
        </CardContent>
      </Card>

      <UserQueryEditor open={editorOpen} onClose={() => setEditorOpen(false)} query={query} onChange={setQuery} flagNames={flagNames} />
      <UserFlowRunner open={flowOpen} onClose={() => setFlowOpen(false)} audienceIds={audienceIds} templates={templates} flagNames={flagNames} onRan={() => qc.invalidateQueries({ queryKey: ["users"] })} />
    </Box>
  );
}
