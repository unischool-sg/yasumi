import { Autocomplete, Box, Button, Card, CardContent, Chip, Divider, Link as MuiLink, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WARNING_TYPE_OPTIONS } from "@yasumi/shared";
import { api } from "../api/client.ts";
import { AreaBlocksPicker } from "../components/AreaBlocksPicker.tsx";
import { useToast } from "../components/Toast.tsx";
import { PREFECTURES } from "../lib/prefectures.ts";
const RESULTS = [
  ["NORMAL", "通常登校"],
  ["WAIT", "自宅待機"],
  ["AM_OFF", "午前休"],
  ["PM_START", "午後から登校"],
  ["FULL_OFF", "全日休校"],
];
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
// テスト送信で選べる判定結果（NORMAL は通知しないため除外し、検証用に UNKNOWN を含める）。
const TEST_RESULTS = [
  ["WAIT", "自宅待機"],
  ["AM_OFF", "午前休"],
  ["PM_START", "午後から登校"],
  ["FULL_OFF", "全日休校"],
  ["UNKNOWN", "判定不能（UNKNOWN）"],
];

export function SchoolDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["school", id], queryFn: () => api.getSchool(id) });
  const { data: subscribers = [] } = useQuery({ queryKey: ["school-subscribers", id], queryFn: () => api.getSchoolSubscribers(id) });
  const { data: teachers = [] } = useQuery({ queryKey: ["school-teachers", id], queryFn: () => api.getSchoolTeachers(id) });
  // 学校の都道府県の地域のみ取得（全国 1806 件を出さない）
  const { data: allAreas = [] } = useQuery({
    queryKey: ["areas", data?.prefecture],
    queryFn: () => api.listAreas(data!.prefecture),
    enabled: !!data,
  });

  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [studentCount, setStudentCount] = useState("");
  const [areaCodes, setAreaCodes] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<Set<string>>(new Set());
  const [rule, setRule] = useState({ checkTime: "08:00", result: "AM_OFF" });
  const [bcast, setBcast] = useState("");
  const [plan, setPlan] = useState("");
  const [planExpiresAt, setPlanExpiresAt] = useState("");
  const [newTeacher, setNewTeacher] = useState({ email: "", name: "", role: "owner", password: "" });
  const [testResult, setTestResult] = useState("FULL_OFF");
  const [testTargetMode, setTestTargetMode] = useState<"subscribers" | "lineUser">("lineUser");
  const [testLineUserId, setTestLineUserId] = useState("");
  const [testSummary, setTestSummary] = useState<Awaited<ReturnType<typeof api.testNotifySchool>> | null>(null);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setCity(data.city ?? "");
    setWebsiteUrl(data.websiteUrl ?? "");
    setStudentCount(data.studentCount != null ? String(data.studentCount) : "");
    setPlan(data.plan ?? "");
    setPlanExpiresAt(data.planExpiresAt ? data.planExpiresAt.slice(0, 10) : "");
    setAreaCodes(new Set(data.areaCodes));
    setWarnings(new Set(data.warningTypes));
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["school", id] });
  const onError = (e: unknown) => toast.error(`保存に失敗しました: ${(e as Error).message}`);
  const apiBase = import.meta.env.VITE_ADMIN_API_BASE_URL ?? "";
  const [logoVer, setLogoVer] = useState(0);
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      return api.uploadSchoolLogo(id, file.type, dataBase64);
    },
    onSuccess: () => { invalidate(); setLogoVer((v) => v + 1); toast.success("ロゴを保存しました"); },
    onError,
  });
  const delLogo = useMutation({
    mutationFn: () => api.deleteSchoolLogo(id),
    onSuccess: () => { invalidate(); setLogoVer((v) => v + 1); toast.success("ロゴを削除しました"); },
    onError,
  });

  const save = useMutation({
    mutationFn: () =>
      api.updateSchool(id, {
        name,
        city: city || null,
        websiteUrl: websiteUrl || null,
        studentCount: studentCount.trim() ? Number(studentCount) : null,
        areaCodes: [...areaCodes],
        warningTypes: [...warnings],
      }),
    onSuccess: () => { invalidate(); toast.success("保存しました"); },
    onError,
  });
  const addRule = useMutation({
    mutationFn: () => api.createRule(id, rule),
    onSuccess: () => { invalidate(); toast.success("ルールを追加しました"); },
    onError,
  });
  const delRule = useMutation({
    mutationFn: (rid: string) => api.deleteRule(rid),
    onSuccess: () => { invalidate(); toast.success("ルールを削除しました"); },
    onError,
  });
  const broadcastSubs = useMutation({
    mutationFn: () => api.broadcast(bcast, { type: "school", schoolId: id }),
    onSuccess: (r) => { setBcast(""); toast.success(`購読者へ送信しました（${r.sent}/${r.total} 件）`); },
    onError,
  });
  const sendBroadcast = () => {
    if (!window.confirm(`この学校の購読者（${subscribers.length}名）にメッセージを送信します。よろしいですか？`)) return;
    broadcastSubs.mutate();
  };

  const testNotify = useMutation({
    mutationFn: () =>
      api.testNotifySchool(id, {
        result: testResult,
        target: testTargetMode === "subscribers" ? { type: "subscribers" } : { type: "lineUser", lineUserId: testLineUserId.trim() },
      }),
    onSuccess: (r) => {
      setTestSummary(r);
      toast.success(`テスト送信しました（成功 ${r.sent} / 全 ${r.total} 件）`);
    },
    onError,
  });
  const sendTest = () => {
    if (testTargetMode === "subscribers" && !window.confirm(`この学校の購読者（${subscribers.length}名）全員に実際の通知が送られます。よろしいですか？`)) return;
    testNotify.mutate();
  };

  const savePlan = useMutation({
    mutationFn: () =>
      api.updateSchool(id, {
        plan: plan || null,
        planExpiresAt: planExpiresAt ? new Date(`${planExpiresAt}T00:00:00.000Z`).toISOString() : null,
      }),
    onSuccess: () => { invalidate(); toast.success("プランを保存しました"); },
    onError,
  });
  const invalidateTeachers = () => qc.invalidateQueries({ queryKey: ["school-teachers", id] });
  const addTeacher = useMutation({
    mutationFn: () =>
      api.createTeacher(id, {
        email: newTeacher.email,
        password: newTeacher.password,
        name: newTeacher.name,
        role: newTeacher.role as "owner" | "teacher",
      }),
    onSuccess: () => {
      invalidateTeachers();
      setNewTeacher({ email: "", name: "", role: "owner", password: "" });
      toast.success("教員アカウントを発行しました");
    },
    onError,
  });
  const toggleTeacher = useMutation({
    mutationFn: (t: { id: string; disabled: boolean }) => api.updateTeacher(t.id, { disabled: t.disabled }),
    onSuccess: () => { invalidateTeachers(); toast.success("更新しました"); },
    onError,
  });
  const delTeacher = useMutation({
    mutationFn: (tid: string) => api.deleteTeacher(tid),
    onSuccess: () => { invalidateTeachers(); toast.success("削除しました"); },
    onError,
  });

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setter(n);
  }

  if (!data) return <Typography>読み込み中…</Typography>;

  return (
    <Box>
      <Button onClick={() => navigate({ to: "/schools" })} size="small" sx={{ mb: 1 }}>
        ← 学校一覧
      </Button>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        {data.name}
      </Typography>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>基本情報</Typography>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField size="small" label="学校名" value={name} onChange={(e) => setName(e.target.value)} />
            <Autocomplete
              size="small"
              options={allAreas.map((a) => a.name)}
              value={city || null}
              onChange={(_, v) => setCity(v ?? "")}
              sx={{ minWidth: 200 }}
              renderInput={(params) => <TextField {...params} label="市区町村" />}
            />
          </Stack>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              size="small"
              fullWidth
              label="学校公式サイトURL（任意）"
              placeholder="https://example.ed.jp"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
            <TextField
              size="small"
              type="number"
              label="全校生徒数（任意）"
              placeholder="例: 480"
              helperText="浸透率の分母"
              value={studentCount}
              onChange={(e) => setStudentCount(e.target.value)}
              sx={{ width: 200, flexShrink: 0 }}
            />
          </Stack>
          <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "center" }}>
            <Box
              sx={{
                width: 56, height: 56, borderRadius: 2, border: "1px solid", borderColor: "divider",
                display: "grid", placeItems: "center", overflow: "hidden", bgcolor: "#fff", flexShrink: 0,
              }}
            >
              {data.logoKey
                ? <img src={`${apiBase}/public/school-logo/${id}?t=${logoVer}`} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : <Typography variant="caption" color="text.secondary">ロゴ無</Typography>}
            </Box>
            <Button variant="outlined" component="label" size="small" disabled={uploadLogo.isPending}>
              ロゴをアップロード
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate(f); e.target.value = ""; }}
              />
            </Button>
            {data.logoKey && (
              <Button size="small" color="error" disabled={delLogo.isPending} onClick={() => delLogo.mutate()}>削除</Button>
            )}
            <Typography variant="caption" color="text.secondary">png/jpeg/webp/svg・512KBまで</Typography>
          </Stack>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>対象地域（都道府県ごとに追加・県跨ぎOK）</Typography>
          <Box sx={{ mb: 2 }}>
            <AreaBlocksPicker
              key={data.id}
              value={data.areaCodes}
              onChange={(codes) => setAreaCodes(new Set(codes))}
              loadAreas={api.listAreas}
              prefectures={PREFECTURES}
            />
          </Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>対象警報</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
            {WARNING_TYPE_OPTIONS.map((w) => {
              const on = warnings.has(w.name);
              const chip = (
                <Chip
                  key={w.name}
                  label={w.adminOnly ? `${w.name}（管理者のみ）` : w.name}
                  color={on ? "primary" : "default"}
                  variant={on ? "filled" : "outlined"}
                  onClick={() => toggle(warnings, w.name, setWarnings)}
                />
              );
              return w.adminOnly ? (
                <Tooltip key={w.name} title="この警報は管理画面からのみ有効化できます（生徒側では選べません）">
                  {chip}
                </Tooltip>
              ) : (
                chip
              );
            })}
          </Box>
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>
            保存
          </Button>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>有料プラン（学校向けSaaS）</Typography>
          <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "center" }}>
            <TextField size="small" select label="プラン" value={plan} onChange={(e) => setPlan(e.target.value)} sx={{ width: 200 }}>
              <MenuItem value="">未契約（無料）</MenuItem>
              <MenuItem value="basic">ベーシック</MenuItem>
              <MenuItem value="standard">スタンダード</MenuItem>
              <MenuItem value="premium">プレミアム</MenuItem>
            </TextField>
            <TextField
              size="small"
              type="date"
              label="有効期限"
              value={planExpiresAt}
              onChange={(e) => setPlanExpiresAt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 180 }}
            />
            <Button variant="contained" onClick={() => savePlan.mutate()} disabled={savePlan.isPending}>
              プラン保存
            </Button>
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>教員アカウント（先生ダッシュボード）</Typography>
          <Stack spacing={1} sx={{ mb: 2 }}>
            {teachers.map((t) => (
              <Stack key={t.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontWeight: 600, minWidth: 120 }}>{t.name}</Typography>
                <code style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t.email}</code>
                <Chip size="small" label={t.role === "owner" ? "管理者" : "教員"} variant="outlined" />
                <Typography variant="caption" color={t.disabled ? "text.secondary" : "success.main"} sx={{ width: 56 }}>
                  {t.disabled ? "無効" : "有効"}
                </Typography>
                <Switch size="small" checked={!t.disabled} onChange={(e) => toggleTeacher.mutate({ id: t.id, disabled: !e.target.checked })} />
                <Button size="small" color="error" onClick={() => confirm("削除しますか？") && delTeacher.mutate(t.id)}>削除</Button>
              </Stack>
            ))}
            {teachers.length === 0 && <Typography variant="body2" color="text.secondary">教員アカウントがありません</Typography>}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <TextField size="small" label="氏名" value={newTeacher.name} onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })} sx={{ width: 130 }} />
            <TextField size="small" label="メール" value={newTeacher.email} onChange={(e) => setNewTeacher({ ...newTeacher, email: e.target.value })} sx={{ width: 200 }} />
            <TextField size="small" select label="権限" value={newTeacher.role} onChange={(e) => setNewTeacher({ ...newTeacher, role: e.target.value })} sx={{ width: 110 }}>
              <MenuItem value="owner">管理者</MenuItem>
              <MenuItem value="teacher">教員</MenuItem>
            </TextField>
            <TextField size="small" type="password" label="初期パスワード(8字以上)" value={newTeacher.password} onChange={(e) => setNewTeacher({ ...newTeacher, password: e.target.value })} sx={{ width: 200 }} />
            <Button
              variant="outlined"
              disabled={!newTeacher.name || !newTeacher.email || newTeacher.password.length < 8 || addTeacher.isPending}
              onClick={() => addTeacher.mutate()}
            >
              発行
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>判定ルール（30分刻み）</Typography>
          <Stack spacing={1} sx={{ mb: 2 }}>
            {data.rules.map((r) => (
              <Stack key={r.id} direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontWeight: 700, width: 64 }}>{r.checkTime}</Typography>
                <Typography>→ {RESULTS.find(([v]) => v === r.result)?.[1] ?? r.result}</Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" color="error" onClick={() => delRule.mutate(r.id)}>削除</Button>
              </Stack>
            ))}
            {data.rules.length === 0 && <Typography variant="body2" color="text.secondary">ルールがありません</Typography>}
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <TextField size="small" select label="時刻" value={rule.checkTime} onChange={(e) => setRule({ ...rule, checkTime: e.target.value })} sx={{ width: 120 }}>
              {TIMES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField size="small" select label="結果" value={rule.result} onChange={(e) => setRule({ ...rule, result: e.target.value })} sx={{ width: 180 }}>
              {RESULTS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </TextField>
            <Button variant="outlined" onClick={() => addRule.mutate()}>ルール追加</Button>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>テスト送信（警報検知通知）</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            実際の判定パイプラインと同じ経路・文面で通知を手動送信します。送信本文・成否・エラーログ・経路（FCM/LINE）は{" "}
            <MuiLink component="button" type="button" onClick={() => navigate({ to: "/history" })}>通知履歴</MuiLink>{" "}
            の行をクリックすると詳細で確認できます。※NORMAL は通知対象外のため選べません。
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <TextField size="small" select label="判定結果" value={testResult} onChange={(e) => setTestResult(e.target.value)} sx={{ width: 190 }}>
              {TEST_RESULTS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </TextField>
            <TextField size="small" select label="送信先" value={testTargetMode} onChange={(e) => setTestTargetMode(e.target.value as "subscribers" | "lineUser")} sx={{ width: 240 }}>
              <MenuItem value="lineUser">指定LINEユーザーのみ（自分宛で検証）</MenuItem>
              <MenuItem value="subscribers">購読者全員（{subscribers.length}名）</MenuItem>
            </TextField>
            {testTargetMode === "lineUser" && (
              <TextField size="small" label="宛先 LINE User ID" placeholder="Uxxxxxxxxxxxx…" value={testLineUserId} onChange={(e) => setTestLineUserId(e.target.value)} sx={{ width: 280 }} />
            )}
            <Button
              variant="contained"
              color="secondary"
              onClick={sendTest}
              disabled={testNotify.isPending || (testTargetMode === "lineUser" ? !testLineUserId.trim() : subscribers.length === 0)}
            >
              テスト送信
            </Button>
          </Stack>
          {testSummary && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: "#f8f9fa", borderRadius: 1, border: "1px solid #eceff1" }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                送信結果: 成功 {testSummary.sent} ／ 配信不能 {testSummary.skippedUndeliverable} ／ エラー {testSummary.errors}（全 {testSummary.total} 件・対象日 {testSummary.targetDate}）
              </Typography>
              <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "inherit", color: "text.secondary" }}>
                {testSummary.text}
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 1.5 }}>
            <Typography variant="subtitle2">購読中のユーザー（{subscribers.length}）</Typography>
            {data.studentCount != null && data.studentCount > 0 && (
              <Typography variant="caption" color="primary.main" sx={{ fontWeight: 700 }}>
                浸透率 {Math.round((subscribers.length / data.studentCount) * 100)}%（{subscribers.length}/{data.studentCount}人）
              </Typography>
            )}
          </Stack>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start", mb: 2 }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              placeholder="購読者へ一斉送信するメッセージ（例: 「明日は創立記念日で休校です」）"
              value={bcast}
              onChange={(e) => setBcast(e.target.value)}
            />
            <Button variant="contained" color="warning" disabled={!bcast.trim() || subscribers.length === 0 || broadcastSubs.isPending} onClick={sendBroadcast} sx={{ flexShrink: 0, mt: 0.5 }}>
              一斉送信
            </Button>
          </Stack>
          <Stack spacing={1}>
            {subscribers.map((s) => (
              <Stack key={s.userId} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <code style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.lineUserId ?? s.userId}
                </code>
                <Typography variant="caption" color={s.notificationEnabled ? "success.main" : "text.secondary"} sx={{ width: 64 }}>
                  {s.notificationEnabled ? "通知ON" : "通知OFF"}
                </Typography>
                <Button size="small" onClick={() => navigate({ to: "/users/$id", params: { id: s.userId } })}>詳細</Button>
              </Stack>
            ))}
            {subscribers.length === 0 && <Typography variant="body2" color="text.secondary">購読者がいません</Typography>}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
