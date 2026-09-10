import { Box, Button, Typography } from "@mui/material";
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
      <DataTable columns={columns} data={data} empty="ユーザーがいません" />
    </Box>
  );
}
