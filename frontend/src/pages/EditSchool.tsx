import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import type { CheckResult } from "@yasumi/shared";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Area, SchoolDetail } from "../api/types.ts";
import { AreaBlocksPicker } from "../components/AreaBlocksPicker.tsx";
import { CHECK_TIME_OPTIONS, PREFECTURES, RESULT_OPTIONS, WARNING_TYPE_OPTIONS } from "../lib/options.ts";

interface Props {
  api: ApiClient;
  schoolId: string;
  onBack: () => void;
  onNotify: (message: string) => void;
}

const RESULT_LABEL = Object.fromEntries(RESULT_OPTIONS.map((o) => [o.value, o.label]));

/** 自分が登録した学校の後編集（基本情報・対象地域・対象警報・判定ルール）。 */
export function EditSchool({ api, schoolId, onBack, onNotify }: Props) {
  const [detail, setDetail] = useState<SchoolDetail | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [areaCodes, setAreaCodes] = useState<Set<string>>(new Set());
  const [warningTypes, setWarningTypes] = useState<Set<string>>(new Set());
  const [cityOptions, setCityOptions] = useState<Area[]>([]);
  const [saving, setSaving] = useState(false);
  const [newRule, setNewRule] = useState<{ checkTime: string; result: CheckResult }>({ checkTime: "08:00", result: "AM_OFF" });
  const [busy, setBusy] = useState(false);

  function apply(d: SchoolDetail) {
    setDetail(d);
    setName(d.name);
    setCity(d.city ?? "");
    setWebsiteUrl(d.websiteUrl ?? "");
    setAreaCodes(new Set(d.areaCodes));
    setWarningTypes(new Set(d.warningTypes));
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getSchool(schoolId)
      .then((d) => !cancelled && apply(d))
      .catch(() => !cancelled && onBack());
    return () => {
      cancelled = true;
    };
  }, [api, schoolId]);

  useEffect(() => {
    if (!detail) return;
    api.listAreas(detail.prefecture).then(setCityOptions).catch(() => setCityOptions([]));
  }, [api, detail]);

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  }

  async function reload() {
    const d = await api.getSchool(schoolId);
    apply(d);
  }

  async function save() {
    setSaving(true);
    try {
      await api.updateSchool(schoolId, {
        name,
        city: city || null,
        websiteUrl: websiteUrl || null,
        areaCodes: [...areaCodes],
        warningTypes: [...warningTypes],
      });
      onNotify("学校情報を保存しました");
    } catch (e) {
      onNotify(`保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function addRule() {
    setBusy(true);
    try {
      await api.createRule(schoolId, newRule);
      await reload();
      onNotify("判定ルールを追加しました");
    } catch (e) {
      onNotify(`追加に失敗しました: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(ruleId: string) {
    setBusy(true);
    try {
      await api.deleteRule(ruleId);
      await reload();
      onNotify("判定ルールを削除しました");
    } catch (e) {
      onNotify(`削除に失敗しました: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={40} width={120} />
        <Skeleton variant="rounded" height={220} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Button onClick={onBack} startIcon={<ArrowBackIcon />} size="small" sx={{ alignSelf: "flex-start" }}>
        学校一覧へ
      </Button>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            基本情報
          </Typography>
          <Stack spacing={2}>
            <TextField label="学校名" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
            <Autocomplete
              options={cityOptions.map((a) => a.name)}
              value={city || null}
              onChange={(_, v) => setCity(v ?? "")}
              noOptionsText="地域データがありません"
              renderInput={(params) => <TextField {...params} label="市区町村" />}
              fullWidth
            />
            <TextField label="学校公式サイト（任意）" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} fullWidth />
          </Stack>

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            対象地域
          </Typography>
          <AreaBlocksPicker
            value={[...areaCodes]}
            onChange={(codes) => setAreaCodes(new Set(codes))}
            loadAreas={api.listAreas}
            prefectures={PREFECTURES}
          />

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            対象警報
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {WARNING_TYPE_OPTIONS.map((w) => {
              const on = warningTypes.has(w);
              return (
                <Chip
                  key={w}
                  label={w}
                  clickable
                  color={on ? "primary" : "default"}
                  variant={on ? "filled" : "outlined"}
                  onClick={() => toggle(warningTypes, w, setWarningTypes)}
                />
              );
            })}
          </Box>

          <Button variant="contained" onClick={save} disabled={saving || !name.trim()} sx={{ mt: 3 }}>
            {saving ? "保存中…" : "基本情報を保存"}
          </Button>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            判定ルール（30分刻み）
          </Typography>
          <Stack spacing={1} sx={{ mb: 2 }}>
            {detail.rules.map((r) => (
              <Stack key={r.id} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontWeight: 700, width: 56 }}>{r.checkTime}</Typography>
                <Typography variant="body2">→ {RESULT_LABEL[r.result] ?? r.result}</Typography>
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" color="error" disabled={busy} onClick={() => removeRule(r.id)} aria-label="ルール削除">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            {detail.rules.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                ルールがありません
              </Typography>
            )}
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>時刻</InputLabel>
              <Select label="時刻" value={newRule.checkTime} onChange={(e) => setNewRule({ ...newRule, checkTime: e.target.value })}>
                {CHECK_TIME_OPTIONS.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography color="text.secondary">→</Typography>
            <FormControl size="small" fullWidth>
              <InputLabel>結果</InputLabel>
              <Select label="結果" value={newRule.result} onChange={(e) => setNewRule({ ...newRule, result: e.target.value as CheckResult })}>
                {RESULT_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button startIcon={<AddIcon />} onClick={addRule} disabled={busy} sx={{ flexShrink: 0 }}>
              追加
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
