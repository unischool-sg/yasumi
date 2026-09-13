import { Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeFlowStep } from "@yasumi/shared";
import { type FlowTemplate, api } from "../api/client.ts";
import { useToast } from "../components/Toast.tsx";
import { EMPTY_QUERY, type UserQuery, UserQueryEditor, compareUsers, matchesQuery, querySummary, schoolOptionsFromUsers } from "../components/UserQueryEditor.tsx";
import { UserFlowRunner } from "../components/UserFlowRunner.tsx";
import { FlowTemplateEditor } from "../components/FlowTemplateEditor.tsx";
import { FlowScheduleManager } from "../components/FlowScheduleManager.tsx";
import { FlowRunLogs } from "../components/FlowRunLogs.tsx";

export function Flows() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const { data: templates = [] } = useQuery({ queryKey: ["admin-templates"], queryFn: api.getMessageTemplates });
  const { data: flagDefs = [] } = useQuery({ queryKey: ["flag-defs"], queryFn: api.getFlagDefs });
  const { data: flowTemplates = [] } = useQuery({ queryKey: ["flow-templates"], queryFn: api.getFlowTemplates });
  const flagNames = flagDefs.map((f) => f.name);
  const schoolOptions = schoolOptionsFromUsers(users);

  const [query, setQuery] = useState<UserQuery>(EMPTY_QUERY);
  const [editorOpen, setEditorOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [allUsers, setAllUsers] = useState(false);
  const [tplForm, setTplForm] = useState<{ id: string | null; title: string; body: string }>({ id: null, title: "", body: "" });
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [newFlag, setNewFlag] = useState("");
  const [flowTplEditor, setFlowTplEditor] = useState<{ open: boolean; initial: FlowTemplate | null }>({ open: false, initial: null });
  const [scheduleFor, setScheduleFor] = useState<FlowTemplate | null>(null);
  const [tab, setTab] = useState(0);

  // テンプレートの対象人数をクライアント側の users から見積り（実行前確認用）。
  const templateCount = (t: FlowTemplate) => (t.allUsers ? users.length : users.filter((u) => matchesQuery(u, t.query)).length);

  const shown = allUsers ? users : users.filter((u) => matchesQuery(u, query)).sort((a, b) => compareUsers(a, b, query.sorts));
  const audienceIds = shown.map((u) => u.id);

  const onErr = (e: unknown) => toast.error(`失敗しました: ${(e as Error).message}`);
  const saveTpl = useMutation({
    mutationFn: () => {
      const b = { title: tplForm.title, body: tplForm.body };
      return tplForm.id ? api.updateMessageTemplate(tplForm.id, b) : api.createMessageTemplate(b);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-templates"] }); setTplForm({ id: null, title: "", body: "" }); setTplModalOpen(false); toast.success("定型文を保存しました"); },
    onError: onErr,
  });
  const delTpl = useMutation({ mutationFn: (id: string) => api.deleteMessageTemplate(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-templates"] }); toast.success("削除しました"); }, onError: onErr });
  const addFlagDef = useMutation({ mutationFn: () => api.createFlagDef({ name: newFlag.trim() }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["flag-defs"] }); setNewFlag(""); toast.success("フラグを作成しました"); }, onError: onErr });
  const delFlagDef = useMutation({ mutationFn: (name: string) => api.deleteFlagDef(name), onSuccess: () => { qc.invalidateQueries({ queryKey: ["flag-defs"] }); qc.invalidateQueries({ queryKey: ["users"] }); toast.success("フラグを削除しました"); }, onError: onErr });

  const runFlowTpl = useMutation({
    mutationFn: (id: string) => api.runFlowTemplate(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      const sends = r.results.filter((x) => x.type === "send").map((x) => `送信 ${x.sent}/${x.total}`);
      toast.success(`実行完了：対象 ${r.audienceCount} 名${sends.length ? ` / ${sends.join(" / ")}` : ""}`);
    },
    onError: onErr,
  });
  const delFlowTpl = useMutation({ mutationFn: (id: string) => api.deleteFlowTemplate(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["flow-templates"] }); toast.success("テンプレートを削除しました"); }, onError: onErr });

  const runTemplate = (t: FlowTemplate) => {
    const lines = t.steps.map((st, i) => `${i + 1}. ${describeFlowStep(st)}`);
    if (!window.confirm(`「${t.name}」を今すぐ実行します。\n\n対象: 約 ${templateCount(t)} 名\n\n${lines.join("\n")}\n\nよろしいですか？`)) return;
    runFlowTpl.mutate(t.id);
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>フロー（一括施策）</Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="設定・実行" />
        <Tab label="実行ログ" />
      </Tabs>

      {tab === 1 && <FlowRunLogs />}

      {tab === 0 && (
      <>
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

      {/* フローテンプレート・定期実行 */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="subtitle2">テンプレート・定期実行</Typography>
            <Box sx={{ flex: 1 }} />
            <Button variant="outlined" size="small" onClick={() => setFlowTplEditor({ open: true, initial: null })}>＋ テンプレートを作成</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            対象条件＋ステップを保存して、手動実行や定期実行（cron・JST）に使えます。定期実行の内容は Discord に記録されます。
          </Typography>
          <Stack spacing={1}>
            {flowTemplates.map((t) => (
              <Box key={t.id} sx={{ border: "1px solid #e0e0e0", borderRadius: 2, px: 1.5, py: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{t.name}</Typography>
                  <Chip size="small" variant="outlined" label={t.allUsers ? "全ユーザー" : "条件あり"} />
                  <Chip size="small" variant="outlined" label={`ステップ ${t.steps.length}`} />
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" variant="contained" disabled={runFlowTpl.isPending} onClick={() => runTemplate(t)}>今すぐ実行</Button>
                  <Button size="small" onClick={() => setScheduleFor(t)}>スケジュール</Button>
                  <Button size="small" onClick={() => setFlowTplEditor({ open: true, initial: t })}>編集</Button>
                  <Button size="small" color="error" onClick={() => { if (window.confirm(`「${t.name}」を削除しますか？（スケジュールも削除されます）`)) delFlowTpl.mutate(t.id); }}>削除</Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  {t.allUsers ? "全ユーザー" : querySummary(t.query)}　/　{t.steps.map((st) => describeFlowStep(st)).join(" → ")}
                </Typography>
              </Box>
            ))}
            {flowTemplates.length === 0 && <Typography variant="caption" color="text.secondary">テンプレートがありません。</Typography>}
          </Stack>
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
                <Button size="small" onClick={() => { setTplForm({ id: t.id, title: t.title, body: t.body }); setTplModalOpen(true); }}>編集</Button>
                <Button size="small" color="error" onClick={() => delTpl.mutate(t.id)}>削除</Button>
              </Stack>
            ))}
            {templates.length === 0 && <Typography variant="caption" color="text.secondary">定型文がありません</Typography>}
          </Stack>
          <Divider sx={{ mb: 1.5 }} />
          <Button variant="outlined" size="small" onClick={() => { setTplForm({ id: null, title: "", body: "" }); setTplModalOpen(true); }}>＋ 定型文を追加</Button>
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
      </>
      )}

      <Dialog open={tplModalOpen} onClose={() => setTplModalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{tplForm.id ? "定型文を編集" : "定型文を追加"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="タイトル" value={tplForm.title} onChange={(e) => setTplForm({ ...tplForm, title: e.target.value })} fullWidth />
            <TextField label="本文" value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} fullWidth multiline minRows={5} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setTplModalOpen(false)}>キャンセル</Button>
          <Button variant="contained" disabled={!tplForm.title.trim() || !tplForm.body.trim() || saveTpl.isPending} onClick={() => saveTpl.mutate()}>保存</Button>
        </DialogActions>
      </Dialog>

      <UserQueryEditor open={editorOpen} onClose={() => setEditorOpen(false)} query={query} onChange={setQuery} flagNames={flagNames} schoolOptions={schoolOptions} />
      <UserFlowRunner open={flowOpen} onClose={() => setFlowOpen(false)} audienceIds={audienceIds} templates={templates} flagNames={flagNames} onRan={() => qc.invalidateQueries({ queryKey: ["users"] })} />
      <FlowTemplateEditor open={flowTplEditor.open} onClose={() => setFlowTplEditor({ open: false, initial: null })} initial={flowTplEditor.initial} templates={templates} flagNames={flagNames} schoolOptions={schoolOptions} />
      <FlowScheduleManager open={scheduleFor !== null} onClose={() => setScheduleFor(null)} template={scheduleFor} />
    </Box>
  );
}
