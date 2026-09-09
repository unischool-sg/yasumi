import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import type { CheckResult } from "@yasumi/shared";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Area } from "../api/types.ts";
import { AreaBlocksPicker } from "../components/AreaBlocksPicker.tsx";
import { CHECK_TIME_OPTIONS, PREFECTURES, RESULT_OPTIONS, WARNING_TYPE_OPTIONS } from "../lib/options.ts";

interface Props {
  api: ApiClient;
  initialName?: string;
  onDone: (schoolId: string) => void;
  onCancel: () => void;
}

interface RuleDraft {
  checkTime: string;
  result: CheckResult;
}

const STEPS = ["基本情報", "対象地域", "対象警報", "判定ルール"];

export function Register({ api, initialName, onDone, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName ?? "");
  const [prefecture, setPrefecture] = useState("兵庫県");
  const [city, setCity] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaCodes, setAreaCodes] = useState<Set<string>>(new Set());
  const [warningTypes, setWarningTypes] = useState<Set<string>>(new Set(["暴風警報"]));
  const [rules, setRules] = useState<RuleDraft[]>([{ checkTime: "08:00", result: "AM_OFF" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 学校所在の都道府県が変わったら市区町村候補を再取得（対象地域は Step2 で独立管理）。
  useEffect(() => {
    api.listAreas(prefecture).then(setAreas).catch(() => setAreas([]));
    setCity("");
  }, [prefecture, api]);

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const school = await api.createSchool({
        name,
        prefecture,
        city: city || undefined,
        websiteUrl: websiteUrl || undefined,
        areaCodes: [...areaCodes],
        warningTypes: [...warningTypes],
      });
      for (const r of rules) await api.createRule(school.id, r);
      await api.subscribe(school.id);
      onDone(school.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canNext = step === 0 ? name.trim().length > 0 : true;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "70vh" }}>
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ flex: 1 }}>
        {step === 0 && (
          <Stack spacing={2.5}>
            <TextField label="学校名" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
            <TextField label="都道府県" select value={prefecture} onChange={(e) => setPrefecture(e.target.value)} fullWidth>
              {PREFECTURES.map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </TextField>
            <Autocomplete
              options={areas.map((a) => a.name)}
              value={city || null}
              onChange={(_, v) => setCity(v ?? "")}
              noOptionsText="地域データがありません"
              renderInput={(params) => <TextField {...params} label="市区町村" />}
              fullWidth
            />
            <TextField label="学校公式サイト（任意）" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} fullWidth />
          </Stack>
        )}

        {step === 1 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              警報判定に使う地域を、都道府県ごとに追加（複数可・県跨ぎOK）
            </Typography>
            <AreaBlocksPicker
              value={[...areaCodes]}
              onChange={(codes) => setAreaCodes(new Set(codes))}
              loadAreas={api.listAreas}
              prefectures={PREFECTURES}
            />
          </Box>
        )}

        {step === 2 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              対象とする警報を選択（複数可）
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
          </Box>
        )}

        {step === 3 && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              判定時刻ごとの結果（30分刻み）
            </Typography>
            {rules.map((r, i) => (
              <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <FormControl size="small" sx={{ minWidth: 100 }}>
                  <InputLabel>時刻</InputLabel>
                  <Select
                    label="時刻"
                    value={r.checkTime}
                    onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, checkTime: e.target.value } : x)))}
                  >
                    {CHECK_TIME_OPTIONS.map((t) => (
                      <MenuItem key={t} value={t}>{t}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography color="text.secondary">→</Typography>
                <FormControl size="small" fullWidth>
                  <InputLabel>結果</InputLabel>
                  <Select
                    label="結果"
                    value={r.result}
                    onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, result: e.target.value as CheckResult } : x)))}
                  >
                    {RESULT_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {rules.length > 1 && (
                  <IconButton size="small" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            ))}
            <Button startIcon={<AddIcon />} onClick={() => setRules([...rules, { checkTime: "10:00", result: "FULL_OFF" }])} sx={{ alignSelf: "flex-start" }}>
              判定時刻を追加
            </Button>
          </Stack>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

      <Stack direction="row" spacing={1.5} sx={{ mt: 3, position: "sticky", bottom: 0, bgcolor: "background.default", py: 2 }}>
        <Button onClick={step === 0 ? onCancel : () => setStep(step - 1)} color="inherit">
          {step === 0 ? "キャンセル" : "戻る"}
        </Button>
        <Box sx={{ flex: 1 }} />
        {step < STEPS.length - 1 ? (
          <Button variant="contained" onClick={() => setStep(step + 1)} disabled={!canNext}>
            次へ
          </Button>
        ) : (
          <Button variant="contained" onClick={submit} disabled={submitting || rules.length === 0}>
            {submitting ? "登録中…" : "登録して通知をON"}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
