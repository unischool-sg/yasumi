import { Box, Card, CardContent, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.ts";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card variant="outlined" sx={{ flex: "1 1 180px" }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5 }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: api.stats });

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        ダッシュボード
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        <Stat label="学校" value={isLoading ? "…" : (data?.schools ?? 0)} />
        <Stat label="ユーザー" value={isLoading ? "…" : (data?.users ?? 0)} />
        <Stat label="購読" value={isLoading ? "…" : (data?.subscriptions ?? 0)} />
        <Stat label={`本日の判定 (${data?.date ?? ""})`} value={isLoading ? "…" : (data?.checksToday ?? 0)} />
        <Stat label="本日の通知" value={isLoading ? "…" : (data?.notificationsToday ?? 0)} />
      </Box>
    </Box>
  );
}
