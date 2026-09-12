import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import type { UserRow } from "../api/client.ts";

// ── 型 ───────────────────────────────────────────────
export type QueryField = "subscriptionCount" | "createdAt" | "lineUserId" | "id" | "flag" | "school";
export type Combinator = "and" | "or";
export interface FilterBlock { id: string; field: QueryField; op: string; value: string; label?: string }
export interface SortBlock { id: string; field: QueryField; dir: "asc" | "desc" }
export interface UserQuery { combinator: Combinator; filters: FilterBlock[]; sorts: SortBlock[] }

export const EMPTY_QUERY: UserQuery = { combinator: "and", filters: [], sorts: [] };

type FieldType = "number" | "date" | "string" | "flag" | "school";

const FIELDS: Record<QueryField, { label: string; type: FieldType }> = {
  subscriptionCount: { label: "購読校数", type: "number" },
  createdAt: { label: "登録日", type: "date" },
  lineUserId: { label: "LINE ID", type: "string" },
  id: { label: "内部ID", type: "string" },
  flag: { label: "フラグ", type: "flag" },
  school: { label: "購読中の学校", type: "school" },
};

const OPS: Record<FieldType, { v: string; label: string; needsValue: boolean; valueType?: "number" | "date" | "text" }[]> = {
  number: [
    { v: "gte", label: "≧", needsValue: true, valueType: "number" },
    { v: "lte", label: "≦", needsValue: true, valueType: "number" },
    { v: "gt", label: ">", needsValue: true, valueType: "number" },
    { v: "lt", label: "<", needsValue: true, valueType: "number" },
    { v: "eq", label: "=", needsValue: true, valueType: "number" },
    { v: "ne", label: "≠", needsValue: true, valueType: "number" },
  ],
  date: [
    { v: "olderThanDays", label: "登録からN日以上前", needsValue: true, valueType: "number" },
    { v: "withinDays", label: "登録からN日以内", needsValue: true, valueType: "number" },
    { v: "after", label: "指定日より後", needsValue: true, valueType: "date" },
    { v: "before", label: "指定日より前", needsValue: true, valueType: "date" },
  ],
  string: [
    { v: "contains", label: "を含む", needsValue: true, valueType: "text" },
    { v: "equals", label: "に一致", needsValue: true, valueType: "text" },
    { v: "empty", label: "が空", needsValue: false },
    { v: "notEmpty", label: "がある", needsValue: false },
  ],
  flag: [
    { v: "hasFlag", label: "を持つ", needsValue: true, valueType: "text" },
    { v: "notHasFlag", label: "を持たない", needsValue: true, valueType: "text" },
  ],
  school: [
    { v: "subscribes", label: "を購読している", needsValue: true, valueType: "text" },
    { v: "notSubscribes", label: "を購読していない", needsValue: true, valueType: "text" },
  ],
};

const genId = () => (crypto.randomUUID ? crypto.randomUUID() : `b${Date.now()}${Math.random()}`);
const defaultOp = (field: QueryField) => OPS[FIELDS[field].type][0]!.v;

// ── 評価・ソート（Users から利用）──────────────────────
function evalBlock(u: UserRow, b: FilterBlock): boolean {
  const type = FIELDS[b.field].type;
  if (type === "flag") {
    const has = (u.flags ?? []).includes(b.value);
    return b.op === "hasFlag" ? has : !has;
  }
  if (type === "school") {
    const has = (u.subscribedSchools ?? []).some((s) => s.id === b.value);
    return b.op === "subscribes" ? has : !has;
  }
  if (type === "number") {
    const n = u.subscriptionCount;
    const v = Number(b.value);
    switch (b.op) {
      case "gte": return n >= v;
      case "lte": return n <= v;
      case "gt": return n > v;
      case "lt": return n < v;
      case "eq": return n === v;
      case "ne": return n !== v;
    }
  }
  if (type === "date") {
    const t = new Date(u.createdAt).getTime();
    if (b.op === "olderThanDays" || b.op === "withinDays") {
      const ageMs = Date.now() - t;
      const th = (Number(b.value) || 0) * 86400000;
      return b.op === "olderThanDays" ? ageMs >= th : ageMs <= th;
    }
    const d = new Date(b.value).getTime();
    if (Number.isNaN(d)) return true;
    return b.op === "after" ? t > d : t < d;
  }
  // string
  const s = (b.field === "lineUserId" ? u.lineUserId : u.id) ?? "";
  switch (b.op) {
    case "contains": return s.toLowerCase().includes(b.value.toLowerCase());
    case "equals": return s === b.value;
    case "empty": return s === "";
    case "notEmpty": return s !== "";
  }
  return true;
}

export function matchesQuery(u: UserRow, q: UserQuery): boolean {
  if (q.filters.length === 0) return true;
  return q.combinator === "and" ? q.filters.every((b) => evalBlock(u, b)) : q.filters.some((b) => evalBlock(u, b));
}

export function compareUsers(a: UserRow, b: UserRow, sorts: SortBlock[]): number {
  for (const s of sorts) {
    let cmp = 0;
    if (s.field === "subscriptionCount") cmp = a.subscriptionCount - b.subscriptionCount;
    else if (s.field === "createdAt") cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    else cmp = String((a as never)[s.field] ?? "").localeCompare(String((b as never)[s.field] ?? ""));
    if (cmp !== 0) return s.dir === "desc" ? -cmp : cmp;
  }
  return 0;
}

/** ロード済みユーザーの購読から、絞り込み用の学校候補（重複除去・名前順）を作る。 */
export function schoolOptionsFromUsers(users: UserRow[]): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const u of users) for (const s of u.subscribedSchools ?? []) map.set(s.id, s.name);
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export function querySummary(q: UserQuery): string {
  const parts: string[] = [];
  if (q.filters.length) {
    const joiner = q.combinator === "and" ? " かつ " : " または ";
    parts.push(
      q.filters
        .map((b) => {
          const op = OPS[FIELDS[b.field].type].find((o) => o.v === b.op);
          if (b.field === "school") return `${b.label ?? b.value}${op?.label ?? b.op}`;
          return `${FIELDS[b.field].label}${op?.label ?? b.op}${op?.needsValue ? ` ${b.value}` : ""}`;
        })
        .join(joiner),
    );
  }
  if (q.sorts.length) parts.push(`並び: ${q.sorts.map((s) => `${FIELDS[s.field].label}${s.dir === "asc" ? "↑" : "↓"}`).join(" → ")}`);
  return parts.join(" / ") || "条件なし";
}

// ── モーダル UI（Scratch風ブロック）─────────────────────
export function UserQueryEditor({ open, onClose, query, onChange, flagNames = [], schoolOptions = [] }: { open: boolean; onClose: () => void; query: UserQuery; onChange: (q: UserQuery) => void; flagNames?: string[]; schoolOptions?: { id: string; name: string }[] }) {
  const setFilters = (filters: FilterBlock[]) => onChange({ ...query, filters });
  const setSorts = (sorts: SortBlock[]) => onChange({ ...query, sorts });

  const addFilter = () => setFilters([...query.filters, { id: genId(), field: "subscriptionCount", op: defaultOp("subscriptionCount"), value: "" }]);
  const updateFilter = (id: string, patch: Partial<FilterBlock>) =>
    setFilters(query.filters.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeFilter = (id: string) => setFilters(query.filters.filter((b) => b.id !== id));

  const addSort = () => setSorts([...query.sorts, { id: genId(), field: "createdAt", dir: "desc" }]);
  const updateSort = (id: string, patch: Partial<SortBlock>) => setSorts(query.sorts.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSort = (id: string) => setSorts(query.sorts.filter((s) => s.id !== id));
  const moveSort = (i: number, dir: -1 | 1) => {
    const next = [...query.sorts];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSorts(next);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>条件エディター</DialogTitle>
      <DialogContent dividers>
        {/* フィルター */}
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <Typography variant="subtitle2">絞り込み</Typography>
          <TextField select size="small" value={query.combinator} onChange={(e) => onChange({ ...query, combinator: e.target.value as Combinator })} sx={{ width: 150 }}>
            <MenuItem value="and">すべて満たす (AND)</MenuItem>
            <MenuItem value="or">いずれか満たす (OR)</MenuItem>
          </TextField>
        </Stack>
        <Stack spacing={1} sx={{ mb: 1 }}>
          {query.filters.map((b) => {
            const type = FIELDS[b.field].type;
            const op = OPS[type].find((o) => o.v === b.op);
            return (
              <Box key={b.id} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", bgcolor: "#e8f0fe", borderRadius: 999, px: 1.5, py: 1 }}>
                <TextField select size="small" variant="standard" value={b.field}
                  onChange={(e) => { const f = e.target.value as QueryField; updateFilter(b.id, { field: f, op: defaultOp(f), value: "" }); }} sx={{ minWidth: 110 }}>
                  {Object.entries(FIELDS).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
                </TextField>
                <TextField select size="small" variant="standard" value={b.op} onChange={(e) => updateFilter(b.id, { op: e.target.value, value: "" })} sx={{ minWidth: 130 }}>
                  {OPS[type].map((o) => <MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>)}
                </TextField>
                {op?.needsValue && type === "flag" ? (
                  <TextField select size="small" variant="standard" value={b.value} onChange={(e) => updateFilter(b.id, { value: e.target.value })} sx={{ minWidth: 130 }}>
                    {flagNames.length === 0 && <MenuItem value="" disabled>（フラグ未定義）</MenuItem>}
                    {flagNames.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                  </TextField>
                ) : op?.needsValue && type === "school" ? (
                  <TextField select size="small" variant="standard" value={b.value}
                    onChange={(e) => updateFilter(b.id, { value: e.target.value, label: schoolOptions.find((s) => s.id === e.target.value)?.name })} sx={{ minWidth: 180 }}>
                    {schoolOptions.length === 0 && <MenuItem value="" disabled>（購読校なし）</MenuItem>}
                    {schoolOptions.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                  </TextField>
                ) : op?.needsValue ? (
                  <TextField size="small" variant="standard" type={op.valueType === "number" ? "number" : op.valueType === "date" ? "date" : "text"}
                    value={b.value} onChange={(e) => updateFilter(b.id, { value: e.target.value })}
                    slotProps={op.valueType === "date" ? { inputLabel: { shrink: true } } : undefined} sx={{ minWidth: 120 }} />
                ) : null}
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" onClick={() => removeFilter(b.id)}>✕</IconButton>
              </Box>
            );
          })}
          {query.filters.length === 0 && <Typography variant="caption" color="text.secondary">条件ブロックがありません。「＋ 条件ブロック」で追加。</Typography>}
        </Stack>
        <Button size="small" onClick={addFilter}>＋ 条件ブロック</Button>

        {/* 並び替え */}
        <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>並び替え（上から優先）</Typography>
        <Stack spacing={1} sx={{ mb: 1 }}>
          {query.sorts.map((s, i) => (
            <Box key={s.id} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", bgcolor: "#e6f4ea", borderRadius: 999, px: 1.5, py: 1 }}>
              <Chip size="small" label={i + 1} />
              <TextField select size="small" variant="standard" value={s.field} onChange={(e) => updateSort(s.id, { field: e.target.value as QueryField })} sx={{ minWidth: 110 }}>
                {Object.entries(FIELDS).filter(([k]) => k !== "school").map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
              </TextField>
              <TextField select size="small" variant="standard" value={s.dir} onChange={(e) => updateSort(s.id, { dir: e.target.value as "asc" | "desc" })} sx={{ minWidth: 90 }}>
                <MenuItem value="asc">昇順 ↑</MenuItem>
                <MenuItem value="desc">降順 ↓</MenuItem>
              </TextField>
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" disabled={i === 0} onClick={() => moveSort(i, -1)}>↑</IconButton>
              <IconButton size="small" disabled={i === query.sorts.length - 1} onClick={() => moveSort(i, 1)}>↓</IconButton>
              <IconButton size="small" onClick={() => removeSort(s.id)}>✕</IconButton>
            </Box>
          ))}
          {query.sorts.length === 0 && <Typography variant="caption" color="text.secondary">並び替えなし（新しい順）。「＋ 並び替え」で追加。</Typography>}
        </Stack>
        <Button size="small" onClick={addSort}>＋ 並び替え</Button>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={() => onChange(EMPTY_QUERY)}>すべてクリア</Button>
        <Button variant="contained" onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
