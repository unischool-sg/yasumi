import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { type Area, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";

export function Areas() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", prefecture: "兵庫県" });
  const { data = [] } = useQuery({ queryKey: ["areas"], queryFn: api.listAreas });

  const create = useMutation({
    mutationFn: () => api.createArea(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      setOpen(false);
      setForm({ code: "", name: "", prefecture: "兵庫県" });
    },
  });
  const del = useMutation({ mutationFn: (code: string) => api.deleteArea(code), onSuccess: () => qc.invalidateQueries({ queryKey: ["areas"] }) });

  const columns: ColumnDef<Area, unknown>[] = [
    { header: "コード", accessorKey: "code" },
    { header: "名称", accessorKey: "name" },
    { header: "都道府県", accessorKey: "prefecture" },
    { header: "操作", cell: (c) => <Button size="small" color="error" onClick={() => confirm("削除しますか？") && del.mutate(c.row.original.code)}>削除</Button> },
  ];

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flexGrow: 1 }}>地域マスタ</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>地域を追加</Button>
      </Stack>
      <DataTable columns={columns} data={data} empty="地域がありません" />

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>地域を追加</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="気象庁コード" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} helperText="例: 2834100" />
            <TextField label="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="都道府県" value={form.prefecture} onChange={(e) => setForm({ ...form, prefecture: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button variant="contained" disabled={!form.code || !form.name || create.isPending} onClick={() => create.mutate()}>作成</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
