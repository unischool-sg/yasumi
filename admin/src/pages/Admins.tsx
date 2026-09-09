import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { type Admin, type Role, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";
import { useToast } from "../components/Toast.tsx";
import { getAuth } from "../lib/auth.ts";

export function Admins() {
  const qc = useQueryClient();
  const toast = useToast();
  const meId = getAuth()?.admin.id;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ username: string; password: string; role: Role }>({ username: "", password: "", role: "admin" });
  const { data = [] } = useQuery({ queryKey: ["admins"], queryFn: api.listAdmins });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admins"] });
  const onError = (e: unknown) => toast.error(`更新に失敗しました: ${(e as Error).message}`);
  const create = useMutation({
    mutationFn: () => api.createAdmin(form),
    onSuccess: () => { invalidate(); setOpen(false); setForm({ username: "", password: "", role: "admin" }); toast.success("管理者を追加しました"); },
    onError,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof api.updateAdmin>[1] }) => api.updateAdmin(v.id, v.body),
    onSuccess: () => { invalidate(); toast.success("更新しました"); },
    onError,
  });

  const columns: ColumnDef<Admin, unknown>[] = [
    { header: "ユーザー名", accessorKey: "username", cell: (c) => <b>{c.getValue() as string}</b> },
    { header: "権限", accessorKey: "role", cell: (c) => <Chip size="small" label={c.getValue() as string} color={c.getValue() === "superadmin" ? "primary" : "default"} /> },
    { header: "状態", accessorKey: "disabled", cell: (c) => ((c.getValue() as boolean) ? <Chip size="small" label="無効" color="error" /> : <Chip size="small" label="有効" color="success" />) },
    {
      header: "操作",
      cell: (c) => {
        const a = c.row.original;
        if (a.id === meId) return <Typography variant="caption" color="text.secondary">自分</Typography>;
        return (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => patch.mutate({ id: a.id, body: { role: a.role === "superadmin" ? "admin" : "superadmin" } })}>
              {a.role === "superadmin" ? "admin化" : "superadmin化"}
            </Button>
            <Button size="small" color={a.disabled ? "success" : "error"} onClick={() => patch.mutate({ id: a.id, body: { disabled: !a.disabled } })}>
              {a.disabled ? "有効化" : "無効化"}
            </Button>
            <Button size="small" onClick={() => { const p = prompt("新しいパスワード(8文字以上)"); if (p && p.length >= 8) patch.mutate({ id: a.id, body: { password: p } }); }}>
              PW再設定
            </Button>
          </Stack>
        );
      },
    },
  ];

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flexGrow: 1 }}>管理者アカウント</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>管理者を追加</Button>
      </Stack>
      <DataTable columns={columns} data={data} empty="管理者がいません" />

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>管理者を追加</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="ユーザー名" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <TextField label="パスワード（8文字以上）" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <TextField label="権限" select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <MenuItem value="admin">admin</MenuItem>
              <MenuItem value="superadmin">superadmin</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button variant="contained" disabled={!form.username || form.password.length < 8 || create.isPending} onClick={() => create.mutate()}>作成</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
