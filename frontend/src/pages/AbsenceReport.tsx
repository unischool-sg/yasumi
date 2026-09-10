import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Divider, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { AbsenceSchool, AbsenceType, StudentProfile } from "../api/types.ts";

const TYPES: AbsenceType[] = ["欠席", "遅刻", "早退", "休校"];

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function AbsenceReport({ api, onBack, onNotify }: { api: ApiClient; onBack: () => void; onNotify: (m: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<AbsenceSchool[]>([]);
  const [profiles, setProfiles] = useState<StudentProfile[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [type, setType] = useState<AbsenceType>("欠席");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 新規プロフィール入力
  const [newProfile, setNewProfile] = useState({ studentName: "", grade: "", className: "" });

  const reloadProfiles = () => api.listStudentProfiles().then(setProfiles).catch(() => setProfiles([]));

  useEffect(() => {
    Promise.all([api.listAbsenceSchools(), api.listStudentProfiles()])
      .then(([s, p]) => {
        setSchools(s);
        setProfiles(p);
        const only = s[0];
        if (s.length === 1 && only) setSchoolId(only.id);
      })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [api]);

  // 選択中の学校に紐づくプロフィールのみ
  const schoolProfiles = useMemo(() => profiles.filter((p) => p.schoolId === schoolId), [profiles, schoolId]);

  async function addProfile() {
    if (!schoolId || !newProfile.studentName.trim()) return;
    setError(null);
    try {
      const created = await api.createStudentProfile({
        schoolId,
        studentName: newProfile.studentName.trim(),
        ...(newProfile.grade.trim() ? { grade: newProfile.grade.trim() } : {}),
        ...(newProfile.className.trim() ? { className: newProfile.className.trim() } : {}),
      });
      await reloadProfiles();
      setProfileId(created.id);
      setNewProfile({ studentName: "", grade: "", className: "" });
      onNotify("生徒を登録しました");
    } catch {
      setError("生徒の登録に失敗しました");
    }
  }

  async function submit() {
    if (!schoolId || !profileId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createAbsenceReport({ schoolId, studentProfileId: profileId, date, type, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      onNotify("学校へ欠席を連絡しました");
      onBack();
    } catch {
      setError("送信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Box sx={{ display: "grid", placeItems: "center", py: 8 }}><CircularProgress size={26} /></Box>;
  }

  if (schools.length === 0) {
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          欠席連絡に対応している学校がありません。この機能は学校が「やすみ？」の対応プランに加入している場合にご利用いただけます。
        </Alert>
        <Button variant="outlined" onClick={onBack}>戻る</Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        学校へ欠席・遅刻・早退などを連絡します。内容は学校の先生に届きます。
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <TextField select label="学校" value={schoolId} onChange={(e) => { setSchoolId(e.target.value); setProfileId(""); }} fullWidth>
              {schools.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>

            {schoolId && (
              <>
                <TextField select label="お子さま / 本人" value={profileId} onChange={(e) => setProfileId(e.target.value)} fullWidth
                  helperText={schoolProfiles.length === 0 ? "まだ登録がありません。下で登録してください。" : undefined}>
                  {schoolProfiles.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.studentName}{(p.grade || p.className) ? `（${p.grade ?? ""}${p.className ?? ""}）` : ""}
                    </MenuItem>
                  ))}
                </TextField>

                <Box sx={{ pl: 1, borderLeft: "2px solid #e8eaed" }}>
                  <Typography variant="caption" color="text.secondary">生徒を登録</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                    <TextField size="small" label="氏名" value={newProfile.studentName} onChange={(e) => setNewProfile({ ...newProfile, studentName: e.target.value })} />
                    <TextField size="small" label="学年" value={newProfile.grade} onChange={(e) => setNewProfile({ ...newProfile, grade: e.target.value })} sx={{ width: 80 }} />
                    <TextField size="small" label="組" value={newProfile.className} onChange={(e) => setNewProfile({ ...newProfile, className: e.target.value })} sx={{ width: 70 }} />
                  </Stack>
                  <Button size="small" sx={{ mt: 1 }} disabled={!newProfile.studentName.trim()} onClick={addProfile}>この生徒を登録</Button>
                </Box>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {schoolId && profileId && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <TextField type="date" label="日付" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
              <TextField select label="種別" value={type} onChange={(e) => setType(e.target.value as AbsenceType)} fullWidth>
                {TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField label="理由（任意）" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} fullWidth placeholder="例）発熱のため" />
            </Stack>
          </CardContent>
        </Card>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Divider />
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" onClick={onBack} fullWidth>戻る</Button>
        <Button variant="contained" onClick={submit} disabled={!schoolId || !profileId || submitting} fullWidth>
          {submitting ? "送信中…" : "学校へ連絡する"}
        </Button>
      </Stack>
    </Stack>
  );
}
