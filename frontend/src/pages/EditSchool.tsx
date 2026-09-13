import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Area, SchoolDetail } from "../api/types.ts";
import { AreaBlocksPicker } from "../components/AreaBlocksPicker.tsx";
import { type RuleDraft, RuleListEditor } from "../components/RuleListEditor.tsx";
import { PREFECTURES, WARNING_TYPE_OPTIONS } from "../lib/options.ts";

interface Props {
  api: ApiClient;
  schoolId: string;
  onBack: () => void;
  onNotify: (message: string) => void;
}

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
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [busy, setBusy] = useState(false);

  function apply(d: SchoolDetail) {
    setDetail(d);
    setName(d.name);
    setCity(d.city ?? "");
    setWebsiteUrl(d.websiteUrl ?? "");
    setAreaCodes(new Set(d.areaCodes));
    setWarningTypes(new Set(d.warningTypes));
    setRules(
      d.rules.map((r) => ({ id: r.id, checkTime: r.checkTime, result: r.result, condition: r.condition })),
    );
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

  /** 編集中の rules をサーバーへ反映（既存と差分を取り、作成/更新/削除）。 */
  async function saveRules() {
    setBusy(true);
    try {
      const existing = detail?.rules ?? [];
      const keepIds = new Set(rules.filter((r) => r.id).map((r) => r.id));
      // 削除: 既存にあってドラフトに無い
      for (const ex of existing) {
        if (!keepIds.has(ex.id)) await api.deleteRule(ex.id);
      }
      // 作成/更新
      for (const r of rules) {
        if (!r.id) {
          await api.createRule(schoolId, { checkTime: r.checkTime, result: r.result, condition: r.condition });
          continue;
        }
        const ex = existing.find((e) => e.id === r.id);
        const changed =
          !ex ||
          ex.checkTime !== r.checkTime ||
          ex.result !== r.result ||
          JSON.stringify(ex.condition) !== JSON.stringify(r.condition);
        if (changed) {
          await api.updateRule(r.id, { checkTime: r.checkTime, result: r.result, condition: r.condition });
        }
      }
      await reload();
      onNotify("判定ルールを保存しました");
    } catch (e) {
      onNotify(`保存に失敗しました: ${(e as Error).message}`);
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
          <RuleListEditor rules={rules} onChange={setRules} />
          <Button variant="contained" onClick={saveRules} disabled={busy} sx={{ mt: 2 }}>
            {busy ? "保存中…" : "判定ルールを保存"}
          </Button>
        </CardContent>
      </Card>
    </Stack>
  );
}
