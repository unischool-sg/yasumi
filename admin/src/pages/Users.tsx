import { Box, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type UserRow, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";
import { EMPTY_QUERY, type UserQuery, UserQueryEditor, compareUsers, matchesQuery, querySummary } from "../components/UserQueryEditor.tsx";

export function Users() {
  const navigate = useNavigate();
  const { data = [] } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const { data: flagDefs = [] } = useQuery({ queryKey: ["flag-defs"], queryFn: api.getFlagDefs });
  const flagNames = flagDefs.map((f) => f.name);

  const [query, setQuery] = useState<UserQuery>(EMPTY_QUERY);
  const [editorOpen, setEditorOpen] = useState(false);
  const active = query.filters.length > 0 || query.sorts.length > 0;
  const shown = active ? data.filter((u) => matchesQuery(u, query)).sort((a, b) => compareUsers(a, b, query.sorts)) : data;

  const columns: ColumnDef<UserRow, unknown>[] = [
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
    {
      header: "フラグ",
      id: "flags",
      cell: (c) => {
        const flags = c.row.original.flags;
        return flags.length ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
            {flags.map((f) => <Chip key={f} size="small" label={f} sx={{ height: 20 }} />)}
          </Stack>
        ) : <Typography variant="caption" color="text.secondary">—</Typography>;
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
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="subtitle2">条件で絞り込み・並び替え</Typography>
            <Button variant="outlined" size="small" onClick={() => setEditorOpen(true)}>条件エディターを開く</Button>
            {active && <Button size="small" color="inherit" onClick={() => setQuery(EMPTY_QUERY)}>クリア</Button>}
            <Box sx={{ flex: 1 }} />
            <Typography variant="body2" color="text.secondary">表示: <b>{shown.length}</b> / {data.length} 名</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            条件：{querySummary(query)}（テーブル上部のボックスで文字検索、列見出しクリックで並べ替えも可）
          </Typography>
        </CardContent>
      </Card>

      <DataTable columns={columns} data={shown} empty="条件に一致するユーザーがいません" />

      <UserQueryEditor open={editorOpen} onClose={() => setEditorOpen(false)} query={query} onChange={setQuery} flagNames={flagNames} />
    </Box>
  );
}
