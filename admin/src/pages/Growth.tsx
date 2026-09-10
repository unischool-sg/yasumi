import { Box, Button, Card, CardContent, Chip, LinearProgress, Stack, Tooltip, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
import { type SchoolStats, api } from "../api/client.ts";
import { DataTable } from "../components/DataTable.tsx";

// 浸透率 = 購読者数 / 全校生徒数。分母(生徒数)未入力の学校は算出不可。
function penetration(s: SchoolStats): number | null {
  if (s.studentCount == null || s.studentCount <= 0) return null;
  return s.subscriberCount / s.studentCount;
}

// 校内密度のセールス目安（私立で1校に集めるほど売りやすい）。
function densityChip(s: SchoolStats) {
  const p = penetration(s);
  if (p == null) {
    if (s.subscriberCount >= 30) return { label: "有望", color: "success" as const };
    if (s.subscriberCount >= 10) return { label: "育成中", color: "warning" as const };
    return { label: "種まき", color: "default" as const };
  }
  if (p >= 0.3) return { label: "商談化", color: "success" as const };
  if (p >= 0.1) return { label: "育成中", color: "warning" as const };
  return { label: "種まき", color: "default" as const };
}

export function Growth() {
  const navigate = useNavigate();
  const { data = [] } = useQuery({ queryKey: ["schools-overview"], queryFn: api.getSchoolsOverview });

  const totalSubs = data.reduce((a, s) => a + s.subscriberCount, 0);
  const withDenominator = data.filter((s) => penetration(s) != null);
  const sellable = data.filter((s) => densityChip(s).label === "商談化" || densityChip(s).label === "有望").length;

  const columns: ColumnDef<SchoolStats, unknown>[] = [
    {
      header: "学校",
      accessorKey: "name",
      cell: (c) => (
        <Box>
          <b>{c.getValue() as string}</b>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {c.row.original.prefecture}
            {c.row.original.city ? ` ${c.row.original.city}` : ""}
          </Typography>
        </Box>
      ),
    },
    { header: "購読者", accessorKey: "subscriberCount", cell: (c) => <b>{c.getValue() as number}</b> },
    {
      header: "通知ON",
      accessorKey: "enabledCount",
      cell: (c) => `${c.getValue() as number} / ${c.row.original.subscriberCount}`,
    },
    {
      header: "生徒数",
      accessorKey: "studentCount",
      cell: (c) => (c.getValue() as number | null) ?? <Typography variant="caption" color="text.secondary">未入力</Typography>,
    },
    {
      header: "浸透率",
      id: "penetration",
      cell: (c) => {
        const p = penetration(c.row.original);
        if (p == null) return <Typography variant="caption" color="text.secondary">—</Typography>;
        return (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 140 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(p * 100, 100)}
              color={p >= 0.3 ? "success" : p >= 0.1 ? "warning" : "inherit"}
              sx={{ flex: 1, height: 8, borderRadius: 4 }}
            />
            <Typography variant="body2" sx={{ fontWeight: 700, width: 44, textAlign: "right" }}>
              {Math.round(p * 100)}%
            </Typography>
          </Stack>
        );
      },
    },
    {
      header: "状態",
      id: "density",
      cell: (c) => {
        const d = densityChip(c.row.original);
        return (
          <Tooltip title="商談化=浸透率30%↑ / 有望=購読30人↑（生徒数未入力時）">
            <Chip size="small" label={d.label} color={d.color} variant={d.color === "default" ? "outlined" : "filled"} />
          </Tooltip>
        );
      },
    },
    {
      header: "",
      id: "actions",
      cell: (c) => (
        <Button size="small" onClick={() => navigate({ to: "/schools/$id", params: { id: c.row.original.id } })}>
          詳細
        </Button>
      ),
    },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        浸透率（営業）
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        学校ごとの校内密度＝私立へ「御校の生徒◯人に公式で届く」と売り込むための数字。購読者の多い順。
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: "wrap" }}>
        <StatCard label="登録校" value={data.length} />
        <StatCard label="購読者合計" value={totalSubs} />
        <StatCard label="商談化・有望" value={sellable} accent />
        <StatCard label="生徒数入力済" value={`${withDenominator.length} / ${data.length}`} />
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <DataTable columns={columns} data={data} empty="学校がありません" />
        </CardContent>
      </Card>
    </Box>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 160, ...(accent ? { borderColor: "primary.main" } : {}) }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 700, color: accent ? "primary.main" : undefined }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}
