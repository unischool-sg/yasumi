import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Box, Button, Card, CardContent, Chip, Stack, Tab, Table, TableBody, TableCell, TableHead,
  TableRow, Tabs, Tooltip, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type AbsenceReport, api } from "../api/client.ts";
import { PlanChip } from "../components/Layout.tsx";
import { useToast } from "../components/Toast.tsx";

type View = "unread" | "confirmed" | "flagged";

// 監視対象＝警報が出ていない日に「休校」で申請されたもの（不正使用の疑い）。
function isFlagged(r: AbsenceReport): boolean {
  return r.type === "休校" && !r.warningActive;
}

export function Absences() {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>("unread");
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { data: all = [] } = useQuery({ queryKey: ["absences"], queryFn: () => api.getAbsences() });

  const confirm = useMutation({
    mutationFn: (id: string) => api.setAbsenceStatus(id, "confirmed"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["absences"] }); toast.success("確認済みにしました"); },
    onError: (e) => toast.error(`更新に失敗しました: ${(e as Error).message}`),
  });

  const premium = me?.school?.plan === "premium";
  const unread = all.filter((r) => r.status === "unread");
  const confirmed = all.filter((r) => r.status === "confirmed");
  const flagged = all.filter(isFlagged);
  const rows = view === "unread" ? unread : view === "confirmed" ? confirmed : flagged;

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>欠席受付</Typography>
        <PlanChip plan={me?.school?.plan ?? null} expiresAt={me?.school?.planExpiresAt ?? null} />
      </Stack>

      {!premium && (
        <Card variant="outlined" sx={{ mb: 2, borderColor: "warning.main" }}>
          <CardContent>
            <Typography variant="body2">
              欠席受付はプレミアムプランの機能です。保護者・生徒からの欠席連絡を受け取るには、プランのアップグレードをご相談ください。
            </Typography>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardContent>
          <Tabs value={view} onChange={(_, v) => setView(v)} sx={{ mb: 1 }}>
            <Tab value="unread" label={`未読 (${unread.length})`} />
            <Tab value="confirmed" label={`確認済み (${confirmed.length})`} />
            <Tab
              value="flagged"
              label={
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <WarningAmberIcon fontSize="small" color="warning" />
                  <span>要確認 ({flagged.length})</span>
                </Stack>
              }
            />
          </Tabs>
          {view === "flagged" && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              警報が出ていない日に「休校」で申請されたもの。不正使用がないか確認してください。
            </Typography>
          )}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>日付</TableCell>
                <TableCell>生徒</TableCell>
                <TableCell>種別</TableCell>
                <TableCell>理由</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{r.date}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {r.studentName}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {(r.grade || r.className) ? ` ${r.grade ?? ""}${r.className ?? ""}` : ""}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {r.type}
                    {isFlagged(r) && (
                      <Tooltip title="警報なしの休校申請">
                        <WarningAmberIcon fontSize="inherit" color="warning" sx={{ ml: 0.5, verticalAlign: "middle" }} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason ?? "—"}</TableCell>
                  <TableCell align="right">
                    {r.status === "unread"
                      ? <Button size="small" variant="outlined" disabled={confirm.isPending} onClick={() => confirm.mutate(r.id)}>確認済みに</Button>
                      : <Chip size="small" color="success" label="確認済み" variant="outlined" />}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                      該当する欠席連絡はありません
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
