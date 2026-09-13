import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import type { CheckResult, RuleCondition } from "@yasumi/shared";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { CHECK_TIME_OPTIONS, RESULT_OPTIONS } from "../lib/options.ts";

/** 編集中のルール1件。既存（永続化済み）は id を持つ。 */
export interface RuleDraft {
  id?: string;
  checkTime: string;
  result: CheckResult;
  condition: RuleCondition;
}

interface Props {
  rules: RuleDraft[];
  onChange: (rules: RuleDraft[]) => void;
}

const CONDITION_OPTIONS: { value: RuleCondition["type"]; label: string }[] = [
  { value: "WARNING_ACTIVE", label: "警報が出ている" },
  { value: "WARNING_CLEARED", label: "警報が解除された" },
];

/** 台風など複雑な運用の雛形（8時警報→午前休 / 10時継続→休校 / 10時解除→午後登校）。 */
const TYPHOON_PRESET: RuleDraft[] = [
  { checkTime: "08:00", result: "AM_OFF", condition: { type: "WARNING_ACTIVE" } },
  { checkTime: "10:00", result: "FULL_OFF", condition: { type: "WARNING_ACTIVE" } },
  { checkTime: "10:00", result: "PM_START", condition: { type: "WARNING_CLEARED", afterClosureOnly: true } },
];

/**
 * 判定ルールの共通エディタ（登録ウィザード / 学校編集で共有）。
 * 既定は簡易（時刻→結果）。「詳細エディタ」をONにすると条件（警報あり/解除）や
 * 「午前が休みのときだけ」を指定できる。プリセットで複雑な雛形を一括生成。
 */
export function RuleListEditor({ rules, onChange }: Props) {
  // 詳細を要する条件（解除など）が既にあれば詳細モードで開く。
  const [advanced, setAdvanced] = useState(() => rules.some((r) => r.condition.type !== "WARNING_ACTIVE"));

  const update = (i: number, patch: Partial<RuleDraft>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...rules, { checkTime: "08:00", result: "AM_OFF", condition: { type: "WARNING_ACTIVE" } }]);
  const applyTyphoon = () => onChange([...rules, ...TYPHOON_PRESET.map((r) => ({ ...r }))]);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <FormControlLabel
          control={<Switch size="small" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />}
          label="詳細エディタ"
        />
        <Box sx={{ flex: 1 }} />
        {advanced && (
          <Button size="small" variant="outlined" onClick={applyTyphoon}>
            台風モードを追加
          </Button>
        )}
      </Stack>

      {advanced && (
        <Typography variant="caption" color="text.secondary">
          「警報が解除された」を選ぶと、警報が外れたときの動作（例: 午後から登校）を設定できます。
          「午前が休みのときだけ」を付けると、通常登校の日には発動しません。
        </Typography>
      )}

      <Stack spacing={1}>
        {rules.map((r, i) => {
          const isCleared = r.condition.type === "WARNING_CLEARED";
          return (
            <Box key={r.id ?? `new-${i}`} sx={{ border: "1px solid #e0e0e0", borderRadius: 2, p: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <FormControl size="small" sx={{ minWidth: 96 }}>
                  <InputLabel>時刻</InputLabel>
                  <Select label="時刻" value={r.checkTime} onChange={(e) => update(i, { checkTime: e.target.value })}>
                    {CHECK_TIME_OPTIONS.map((t) => (
                      <MenuItem key={t} value={t}>
                        {t}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {advanced && (
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>条件</InputLabel>
                    <Select
                      label="条件"
                      value={r.condition.type}
                      onChange={(e) => {
                        const type = e.target.value as RuleCondition["type"];
                        update(i, {
                          condition:
                            type === "WARNING_CLEARED"
                              ? { type: "WARNING_CLEARED", afterClosureOnly: true }
                              : { type: "WARNING_ACTIVE" },
                        });
                      }}
                    >
                      {CONDITION_OPTIONS.map((o) => (
                        <MenuItem key={o.value} value={o.value}>
                          {o.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <Typography color="text.secondary">→</Typography>
                <FormControl size="small" sx={{ minWidth: 130, flex: 1 }}>
                  <InputLabel>結果</InputLabel>
                  <Select
                    label="結果"
                    value={r.result}
                    onChange={(e) => update(i, { result: e.target.value as CheckResult })}
                  >
                    {RESULT_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <IconButton size="small" color="error" onClick={() => remove(i)} aria-label="ルール削除">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>

              {advanced && isCleared && (
                <FormControlLabel
                  sx={{ ml: 0.5, mt: 0.5 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={r.condition.type === "WARNING_CLEARED" ? (r.condition.afterClosureOnly ?? true) : true}
                      onChange={(e) =>
                        update(i, { condition: { type: "WARNING_CLEARED", afterClosureOnly: e.target.checked } })
                      }
                    />
                  }
                  label={<Typography variant="caption">午前が休みのときだけ</Typography>}
                />
              )}
            </Box>
          );
        })}
        {rules.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            ルールがありません
          </Typography>
        )}
      </Stack>

      <Divider />
      <Button startIcon={<AddIcon />} onClick={add} size="small" sx={{ alignSelf: "flex-start" }}>
        ステップを追加
      </Button>
    </Stack>
  );
}
