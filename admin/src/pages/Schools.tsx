import { Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { type School, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";
import { PREFECTURES } from "../lib/prefectures.ts";

export function Schools() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", prefecture: "兵庫県", city: "" });

  const { data = [] } = useQuery({ queryKey: ["schools", search], queryFn: () => api.listSchools(search || undefined) });
  // 作成ダイアログの市区町村候補（選択中の都道府県の地域）
  const { data: areaOptions = [] } = useQuery({
    queryKey: ["areas", form.prefecture],
    queryFn: () => api.listAreas(form.prefecture),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => api.createSchool({ name: form.name, prefecture: form.prefecture, city: form.city || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schools"] });
      setOpen(false);
      setForm({ name: "", prefecture: "兵庫県", city: "" });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteSchool(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schools"] }),
  });

  const columns: ColumnDef<School, unknown>[] = [
    { header: "学校名", accessorKey: "name", cell: (c) => <b>{c.getValue() as string}</b> },
    { header: "所在", cell: (c) => `${c.row.original.prefecture}${c.row.original.city ? ` ${c.row.original.city}` : ""}` },
    {
      header: "操作",
      cell: (c) => (
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => navigate({ to: "/schools/$id", params: { id: c.row.original.id } })}>
            詳細
          </Button>
          <Button size="small" color="error" onClick={() => confirm("削除しますか？") && del.mutate(c.row.original.id)}>
            削除
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        学校・ルール
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="学校名で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSearch(q)}
        />
        <Button variant="outlined" onClick={() => setSearch(q)}>
          検索
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => setOpen(true)}>
          学校を追加
        </Button>
      </Stack>

      <DataTable columns={columns} data={data} empty="学校がありません" />

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>学校を追加</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="学校名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="都道府県" select value={form.prefecture} onChange={(e) => setForm({ ...form, prefecture: e.target.value, city: "" })}>
              {PREFECTURES.map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </TextField>
            <Autocomplete
              options={areaOptions.map((a) => a.name)}
              value={form.city || null}
              onChange={(_, v) => setForm({ ...form, city: v ?? "" })}
              noOptionsText="地域データがありません"
              renderInput={(params) => <TextField {...params} label="市区町村" />}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button variant="contained" disabled={!form.name || create.isPending} onClick={() => create.mutate()}>
            作成
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
