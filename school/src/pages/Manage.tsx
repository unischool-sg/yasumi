import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, MenuItem, Stack, Switch, TextField, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client.ts";
import { useToast } from "../components/Toast.tsx";

const apiBase = import.meta.env.VITE_SCHOOL_API_BASE_URL ?? "";

export function Manage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isOwner = me?.teacher.role === "owner";
  const plan = me?.school?.plan ?? null;
  const canManage = plan === "standard" || plan === "premium"; // standard+
  const [logoVer, setLogoVer] = useState(0);
  const [newT, setNewT] = useState({ email: "", name: "", password: "", role: "teacher" as "owner" | "teacher" });

  const { data: teachers = [] } = useQuery({ queryKey: ["teachers"], queryFn: api.getTeachers, enabled: isOwner });

  const onErr = (e: unknown) => toast.error(`失敗しました: ${(e as Error).message}`);
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      return api.uploadLogo(file.type, dataBase64);
    },
    onSuccess: () => { setLogoVer((v) => v + 1); qc.invalidateQueries({ queryKey: ["me"] }); toast.success("ロゴを保存しました"); },
    onError: onErr,
  });
  const delLogo = useMutation({ mutationFn: () => api.deleteLogo(), onSuccess: () => { setLogoVer((v) => v + 1); toast.success("ロゴを削除しました"); }, onError: onErr });
  const addT = useMutation({
    mutationFn: () => api.createTeacher(newT),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["teachers"] }); setNewT({ email: "", name: "", password: "", role: "teacher" }); toast.success("教員を追加しました"); },
    onError: onErr,
  });
  const toggleT = useMutation({ mutationFn: (t: { id: string; disabled: boolean }) => api.updateTeacher(t.id, { disabled: t.disabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ["teachers"] }), onError: onErr });
  const delT = useMutation({ mutationFn: (id: string) => api.deleteTeacher(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["teachers"] }); toast.success("削除しました"); }, onError: onErr });

  if (!isOwner) return <Alert severity="info">この画面は管理者（owner）アカウントのみ利用できます。</Alert>;

  const schoolId = me?.school?.id ?? "";

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>管理</Typography>

      {!canManage && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          ロゴ設定・教員の追加はスタンダード以上のプランで利用できます。アップグレードはお問い合わせください。
        </Alert>
      )}

      {/* ロゴ */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>学校ロゴ</Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Box sx={{ width: 64, height: 64, borderRadius: 2, border: "1px solid", borderColor: "divider", display: "grid", placeItems: "center", overflow: "hidden", bgcolor: "#fff" }}>
              <img src={`${apiBase}/public/school-logo/${schoolId}?t=${logoVer}`} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
            </Box>
            <Button variant="outlined" component="label" size="small" disabled={!canManage || uploadLogo.isPending}>
              アップロード
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate(f); e.target.value = ""; }} />
            </Button>
            <Button size="small" color="error" disabled={!canManage || delLogo.isPending} onClick={() => delLogo.mutate()}>削除</Button>
            <Typography variant="caption" color="text.secondary">png/jpeg/webp/svg・512KBまで。LPの学校一覧・トップに表示されます。</Typography>
          </Stack>
        </CardContent>
      </Card>

      {/* 教員 */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>教員アカウント</Typography>
          <Stack spacing={1} sx={{ mb: 2 }}>
            {teachers.map((t) => (
              <Stack key={t.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontWeight: 600, minWidth: 120 }}>{t.name}</Typography>
                <code style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t.email}</code>
                <Chip size="small" label={t.role === "owner" ? "管理者" : "教員"} variant="outlined" />
                <Switch size="small" checked={!t.disabled} onChange={(e) => toggleT.mutate({ id: t.id, disabled: !e.target.checked })} disabled={t.role === "owner"} />
                {t.role !== "owner" && <Button size="small" color="error" onClick={() => confirm("削除しますか？") && delT.mutate(t.id)}>削除</Button>}
              </Stack>
            ))}
          </Stack>
          <Divider sx={{ mb: 1.5 }} />
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <TextField size="small" label="氏名" value={newT.name} onChange={(e) => setNewT({ ...newT, name: e.target.value })} sx={{ width: 130 }} />
            <TextField size="small" label="メール" value={newT.email} onChange={(e) => setNewT({ ...newT, email: e.target.value })} sx={{ width: 200 }} />
            <TextField size="small" select label="権限" value={newT.role} onChange={(e) => setNewT({ ...newT, role: e.target.value as "owner" | "teacher" })} sx={{ width: 110 }}>
              <MenuItem value="teacher">教員</MenuItem>
              <MenuItem value="owner">管理者</MenuItem>
            </TextField>
            <TextField size="small" type="password" label="初期パスワード(8字以上)" value={newT.password} onChange={(e) => setNewT({ ...newT, password: e.target.value })} sx={{ width: 200 }} />
            <Button variant="outlined" disabled={!canManage || !newT.name || !newT.email || newT.password.length < 8 || addT.isPending} onClick={() => addT.mutate()}>追加</Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
