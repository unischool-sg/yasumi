import type { CheckResult } from "@yasumi/shared";
import { type ReactNode, useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Area } from "../api/types.ts";
import { CHECK_TIME_OPTIONS, RESULT_OPTIONS, WARNING_TYPE_OPTIONS } from "../lib/options.ts";

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

/** 学校登録（4ステップ / PRD §13）。基本情報 → 対象地域 → 対象警報 → 判定ルール。 */
export function Register({ api, initialName, onDone, onCancel }: Props) {
  const [step, setStep] = useState(1);
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

  useEffect(() => {
    if (step === 2 && areas.length === 0) {
      api.listAreas(prefecture).then(setAreas).catch(() => setAreas([]));
    }
  }, [step, prefecture, areas.length, api]);

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-500">ステップ {step} / 4</p>
        <button className="text-sm text-slate-400" onClick={onCancel}>
          キャンセル
        </button>
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <Field label="学校名">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="都道府県">
            <input className={inputCls} value={prefecture} onChange={(e) => setPrefecture(e.target.value)} />
          </Field>
          <Field label="市区町村">
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="学校公式サイト (任意)">
            <input className={inputCls} value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-500">警報判定に使う地域を選択（複数可）</p>
          {areas.map((a) => (
            <label key={a.code} className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
              <input
                type="checkbox"
                checked={areaCodes.has(a.code)}
                onChange={() => toggle(areaCodes, a.code, setAreaCodes)}
              />
              {a.name}
            </label>
          ))}
          {areas.length === 0 && <p className="text-sm text-slate-400">対象地域データがありません。</p>}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-500">対象とする警報を選択（複数可）</p>
          {WARNING_TYPE_OPTIONS.map((w) => (
            <label key={w} className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
              <input type="checkbox" checked={warningTypes.has(w)} onChange={() => toggle(warningTypes, w, setWarningTypes)} />
              {w}
            </label>
          ))}
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">判定時刻ごとの結果（30分刻み）</p>
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className={inputCls}
                value={r.checkTime}
                onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, checkTime: e.target.value } : x)))}
              >
                {CHECK_TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                className={inputCls}
                value={r.result}
                onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, result: e.target.value as CheckResult } : x)))}
              >
                {RESULT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {rules.length > 1 && (
                <button className="text-slate-400" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            className="self-start text-sm font-semibold text-emerald-700"
            onClick={() => setRules([...rules, { checkTime: "10:00", result: "FULL_OFF" }])}
          >
            + 判定時刻を追加
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="mt-2 flex justify-between">
        <button
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
          onClick={() => setStep(step - 1)}
          disabled={step === 1}
        >
          戻る
        </button>
        {step < 4 ? (
          <button
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={() => setStep(step + 1)}
            disabled={step === 1 && !name.trim()}
          >
            次へ
          </button>
        ) : (
          <button
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={submit}
            disabled={submitting || rules.length === 0}
          >
            {submitting ? "登録中…" : "登録して購読"}
          </button>
        )}
      </div>
    </div>
  );
}

const inputCls = "flex-1 rounded-lg border border-slate-300 px-3 py-2";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-600">
      {label}
      {children}
    </label>
  );
}
