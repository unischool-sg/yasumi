import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import { Autocomplete, Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

interface AreaOpt {
  code: string;
  name: string;
}
interface Block {
  prefecture: string;
  codes: string[];
}

interface Props {
  value: string[];
  onChange: (codes: string[]) => void;
  loadAreas: (prefecture: string) => Promise<AreaOpt[]>;
  prefectures: readonly string[];
}

/**
 * 対象地域を「都道府県 → 市区町村（複数）」のブロック単位で任意個追加する選択 UI。
 * 県跨ぎOK。ブロックごとに全選択/クリア、全体でコピー/貼り付け（学校間の複製）に対応。
 */
export function AreaBlocksPicker({ value, onChange, loadAreas, prefectures }: Props) {
  const def = prefectures[0] ?? "兵庫県";
  const prefByCode = useMemo(() => {
    const m: Record<string, string> = {};
    prefectures.forEach((p, i) => {
      m[String(i + 1).padStart(2, "0")] = p;
    });
    return m;
  }, [prefectures]);

  const [blocks, setBlocks] = useState<Block[]>(() => initBlocks(value, prefByCode, def));
  const [copied, setCopied] = useState(false);

  function commit(next: Block[]) {
    setBlocks(next);
    onChange([...new Set(next.flatMap((b) => b.codes))]);
  }

  function setAll(codes: string[]) {
    const union = [...new Set(codes)];
    setBlocks(initBlocks(union, prefByCode, def));
    onChange(union);
  }

  async function copy() {
    const text = JSON.stringify([...new Set(value)]);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("以下をコピーしてください", text);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function paste() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = window.prompt("地域コードを貼り付けてください") ?? "";
    }
    const codes = parseCodes(text);
    if (codes.length) setAll([...value, ...codes]);
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button size="small" startIcon={<ContentCopyIcon />} onClick={copy}>
          {copied ? "コピー済み" : "コピー"}
        </Button>
        <Button size="small" startIcon={<ContentPasteIcon />} onClick={paste}>
          貼り付け
        </Button>
        <Typography variant="caption" color="text.secondary">
          選択 {new Set(value).size} 件
        </Typography>
      </Stack>

      {blocks.map((b, i) => (
        <AreaBlockRow
          key={i}
          block={b}
          prefectures={prefectures}
          loadAreas={loadAreas}
          canRemove={blocks.length > 1}
          onChange={(nb) => commit(blocks.map((x, j) => (j === i ? nb : x)))}
          onRemove={() => commit(blocks.filter((_, j) => j !== i))}
        />
      ))}
      <Button startIcon={<AddIcon />} onClick={() => commit([...blocks, { prefecture: def, codes: [] }])} sx={{ alignSelf: "flex-start" }}>
        地域ブロックを追加
      </Button>
    </Stack>
  );
}

function parseCodes(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String).filter((s) => /^\d+$/.test(s));
  } catch {
    // not JSON
  }
  return raw.split(/[\s,]+/).filter((s) => /^\d+$/.test(s));
}

function initBlocks(value: string[], prefByCode: Record<string, string>, def: string): Block[] {
  if (value.length === 0) return [{ prefecture: def, codes: [] }];
  const byPref: Record<string, string[]> = {};
  for (const code of value) {
    const p = prefByCode[code.slice(0, 2)] ?? def;
    (byPref[p] ??= []).push(code);
  }
  return Object.entries(byPref).map(([prefecture, codes]) => ({ prefecture, codes }));
}

function AreaBlockRow({
  block,
  prefectures,
  loadAreas,
  onChange,
  onRemove,
  canRemove,
}: {
  block: Block;
  prefectures: readonly string[];
  loadAreas: (prefecture: string) => Promise<AreaOpt[]>;
  onChange: (b: Block) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [areas, setAreas] = useState<AreaOpt[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadAreas(block.prefecture)
      .then((a) => !cancelled && setAreas(a))
      .catch(() => !cancelled && setAreas([]));
    return () => {
      cancelled = true;
    };
  }, [block.prefecture, loadAreas]);

  const selected = areas.filter((a) => block.codes.includes(a.code));

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <TextField
          select
          size="small"
          label="都道府県"
          value={block.prefecture}
          onChange={(e) => onChange({ prefecture: e.target.value, codes: [] })}
          sx={{ minWidth: 108 }}
        >
          {prefectures.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </TextField>
        <Autocomplete
          multiple
          size="small"
          sx={{ flex: 1 }}
          options={areas}
          getOptionLabel={(a) => a.name}
          isOptionEqualToValue={(a, b) => a.code === b.code}
          value={selected}
          onChange={(_, v) => onChange({ prefecture: block.prefecture, codes: v.map((a) => a.code) })}
          noOptionsText="地域データがありません"
          renderInput={(params) => <TextField {...params} label="市区町村" placeholder="追加…" />}
        />
        {canRemove && (
          <IconButton onClick={onRemove} sx={{ mt: 0.5 }} aria-label="ブロック削除">
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, alignItems: "center" }}>
        <Button size="small" disabled={areas.length === 0} onClick={() => onChange({ prefecture: block.prefecture, codes: areas.map((a) => a.code) })}>
          全選択
        </Button>
        <Button size="small" disabled={block.codes.length === 0} onClick={() => onChange({ prefecture: block.prefecture, codes: [] })}>
          クリア
        </Button>
        <Typography variant="caption" color="text.secondary">
          {block.codes.length} / {areas.length}
        </Typography>
      </Stack>
    </Box>
  );
}
