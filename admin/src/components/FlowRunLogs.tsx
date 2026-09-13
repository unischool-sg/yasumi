import { Chip, Link as MuiLink, Stack, Tooltip, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { type FlowRunLog, api } from "../api/client.ts";
import { DataTable } from "./DataTable.tsx";

/** ステップ結果を1行の要約に整形（送信は sent/total、フラグは付与/解除＋名称）。 */
function summarizeResults(results: FlowRunLog["results"]): string {
  if (results.length === 0) return "—";
  return results
    .map((r) => {
      if (r.type === "send") return `送信 ${r.sent ?? 0}/${r.total ?? 0}`;
      if (r.type === "addFlag") return `フラグ付与「${r.flag ?? ""}」`;
      if (r.type === "removeFlag") return `フラグ解除「${r.flag ?? ""}」`;
      return r.type;
    })
    .join(" / ");
}

export function FlowRunLogs() {
  const navigate = useNavigate();
  const { data: logs = [] } = useQuery({ queryKey: ["flow-run-logs"], queryFn: () => api.getFlowRunLogs() });

  const cols: ColumnDef<FlowRunLog, unknown>[] = [
    {
      header: "実行日時",
      accessorKey: "createdAt",
      cell: (c) => new Date(c.getValue() as string).toLocaleString("ja-JP"),
    },
    {
      header: "テンプレート",
      accessorKey: "templateName",
      cell: (c) => {
        const row = c.row.original;
        const name = c.getValue() as string;
        return row.templateId ? (
          <MuiLink
            component="button"
            type="button"
            onClick={() => navigate({ to: "/flows" })}
            sx={{ fontWeight: 600, cursor: "pointer" }}
          >
            {name}
          </MuiLink>
        ) : (
          <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
            {name}
            <Typography variant="caption" color="text.secondary" component="span" sx={{ ml: 0.5 }}>
              (削除済み)
            </Typography>
          </Typography>
        );
      },
    },
    {
      header: "トリガー",
      accessorKey: "trigger",
      cell: (c) => (
        <Chip
          size="small"
          variant="outlined"
          label={(c.getValue() as string) === "manual" ? "手動" : "定期"}
        />
      ),
    },
    { header: "対象数", accessorKey: "audienceCount", cell: (c) => `${c.getValue() as number} 名` },
    {
      header: "結果",
      id: "results",
      cell: (c) => (
        <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
          {summarizeResults(c.row.original.results)}
        </Typography>
      ),
    },
    {
      header: "状態",
      accessorKey: "status",
      cell: (c) => {
        const row = c.row.original;
        if (row.status === "success") return <Chip size="small" color="success" label="成功" />;
        return (
          <Tooltip title={row.error ?? "エラー"}>
            <Chip size="small" color="error" label="エラー" />
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        フローの手動・定期実行の記録です。ログは1ヶ月で自動削除されます（削除前に JSON でストレージに退避）。
      </Typography>
      <DataTable columns={cols} data={logs} empty="実行ログがありません" />
    </Stack>
  );
}
