import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
import { type UserRow, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";

export function Users() {
  const navigate = useNavigate();
  const { data = [] } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });

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
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline", mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>ユーザー（{data.length}）</Typography>
        <Typography variant="caption" color="text.secondary">一斉送信・条件抽出・フラグは「フロー」タブへ</Typography>
      </Stack>
      <DataTable columns={columns} data={data} empty="ユーザーがいません" />
    </Box>
  );
}
