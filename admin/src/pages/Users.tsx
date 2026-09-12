import { Box, Button, Card, CardContent, Checkbox, Chip, Divider, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type UserRow, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";
import { EMPTY_QUERY, type UserQuery, UserQueryEditor, compareUsers, matchesQuery, querySummary } from "../components/UserQueryEditor.tsx";
import { useToast } from "../components/Toast.tsx";

export function Users() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const { data: templates = [] } = useQuery({ queryKey: ["admin-templates"], queryFn: api.getMessageTemplates });

  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newTpl, setNewTpl] = useState({ title: "", body: "" });

  // 条件（Scratch風エディターで編集）
  const [query, setQuery] = useState<UserQuery>(EMPTY_QUERY);
  const [editorOpen, setEditorOpen] = useState(false);

  const shown = data.filter((u) => matchesQuery(u, query)).sort((a, b) => compareUsers(a, b, query.sorts));
  const filterActive = query.filters.length > 0 || query.sorts.length > 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allSelected = shown.length > 0 && shown.every((u) => selected.has(u.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelected) shown.forEach((u) => n.delete(u.id));
      else shown.forEach((u) => n.add(u.id));
      return n;
    });
  };
  const selectMatching = () => setSelected(new Set(shown.map((u) => u.id)));

  const broadcastAll = useMutation({
    mutationFn: () => api.broadcast(text, { type: "all" }),
    onSuccess: (r) => { setText(""); toast.success(`一斉送信しました（${r.sent}/${r.total} 件）`); },
    onError: (e) => toast.error(`送信に失敗しました: ${(e as Error).message}`),
  });
  const sendSelected = useMutation({
    mutationFn: () => api.broadcast(text, { type: "users", userIds: [...selected] }),
    onSuccess: (r) => { setText(""); setSelected(new Set()); toast.success(`選択ユーザーへ送信しました（${r.sent}/${r.total} 件）`); },
    onError: (e) => toast.error(`送信に失敗しました: ${(e as Error).message}`),
  });
  const addTpl = useMutation({
    mutationFn: () => api.createMessageTemplate(newTpl),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-templates"] }); setNewTpl({ title: "", body: "" }); toast.success("定型文を保存しました"); },
    onError: (e) => toast.error(`失敗しました: ${(e as Error).message}`),
  });
  const delTpl = useMutation({
    mutationFn: (id: string) => api.deleteMessageTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-templates"] }); toast.success("削除しました"); },
    onError: (e) => toast.error(`失敗しました: ${(e as Error).message}`),
  });

  const sendAll = () => {
    if (!window.confirm(`全ユーザー（${data.length}名）に送信します。よろしいですか？`)) return;
    broadcastAll.mutate();
  };
  const sendToSelected = () => {
    if (!window.confirm(`選択した ${selected.size} 名に送信します。よろしいですか？`)) return;
    sendSelected.mutate();
  };

  const columns: ColumnDef<UserRow, unknown>[] = [
    {
      id: "select",
      header: () => <Checkbox size="small" checked={allSelected} indeterminate={selected.size > 0 && !allSelected} onChange={toggleAll} />,
      cell: (c) => <Checkbox size="small" checked={selected.has(c.row.original.id)} onChange={() => toggle(c.row.original.id)} />,
    },
    { header: "内部ID", accessorKey: "id", cell: (c) => <code style={{ fontSize: 12 }}>{(c.getValue() as string).slice(0, 8)}…</code> },
    { header: "LINE ユーザーID", accessorKey: "lineUserId", cell: (c) => <code style={{ fontSize: 12 }}>{c.getValue() as string}</code> },
    {
      header: "購読",
      accessorKey: "subscriptionCount",
      cell: (c) => {
        const n = c.getValue() as number;
        return n > 0 ? <Chip size="small" color="primary" variant="outlined" label={`${n}校`} /> : <Typography variant="caption" color="text.secondary">なし</Typography>;
      },
    },
    { header: "登録日", accessorKey: "createdAt", cell: (c) => new Date(c.getValue() as string).toLocaleString("ja-JP") },
    {
      header: "",
      id: "actions",
      cell: (c) => (
        <Button size="small" onClick={() => navigate({ to: "/users/$id", params: { id: c.row.original.id } })}>
          詳細・管理
        </Button>
      ),
    },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>ユーザー（{data.length}）</Typography>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>メッセージ送信</Typography>
          <Stack direction="row" spacing={1.5} sx={{ mb: 1, alignItems: "center" }}>
            <TextField select size="small" label="定型文から挿入" value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setText(t.body); }} sx={{ width: 240 }}>
              {templates.length === 0 && <MenuItem value="" disabled>（定型文がありません）</MenuItem>}
              {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.title}</MenuItem>)}
            </TextField>
            <Typography variant="caption" color="text.secondary">選択中: <b>{selected.size}</b> 名</Typography>
          </Stack>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <TextField
              size="small" fullWidth multiline minRows={2}
              placeholder="メッセージ（デバイス登録があればアプリ通知、無ければLINE）"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Stack spacing={1} sx={{ flexShrink: 0 }}>
              <Button variant="contained" disabled={!text.trim() || selected.size === 0 || sendSelected.isPending} onClick={sendToSelected}>
                選択{selected.size > 0 ? `（${selected.size}）` : ""}名に送信
              </Button>
              <Button variant="outlined" color="warning" disabled={!text.trim() || broadcastAll.isPending} onClick={sendAll}>
                全ユーザーに送信
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

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

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="subtitle2">条件で絞り込み・並び替え・一括選択</Typography>
            <Button variant="outlined" size="small" onClick={() => setEditorOpen(true)}>条件エディターを開く</Button>
            <Box sx={{ flex: 1 }} />
            <Typography variant="body2" color="text.secondary">一致: <b>{shown.length}</b> / {data.length} 名</Typography>
            <Button variant="contained" size="small" disabled={shown.length === 0} onClick={selectMatching}>一致{shown.length > 0 ? `（${shown.length}）` : ""}名を選択</Button>
            <Button size="small" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>選択解除</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            現在の条件：{querySummary(query)}
          </Typography>
        </CardContent>
      </Card>

      {filterActive && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          絞り込み/並び替え中：{shown.length} 名を表示（全 {data.length} 名）
        </Typography>
      )}
      <DataTable columns={columns} data={shown} empty="条件に一致するユーザーがいません" />

      <UserQueryEditor open={editorOpen} onClose={() => setEditorOpen(false)} query={query} onChange={setQuery} />
    </Box>
  );
}
