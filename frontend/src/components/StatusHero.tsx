import IosShareIcon from "@mui/icons-material/IosShare";
import { Box, Button, Card, CardContent, Chip, Typography } from "@mui/material";
import type { SchoolStatus } from "../api/types.ts";
import { STATUS_STYLE, timeLabel } from "../lib/status.ts";

/**
 * ホームの「今日どう？」表示（PRD §15〜§17）。
 * マテリアル You 風のトーナル（淡色地）カードで判定結果を主役に。
 * onShare を渡すと「同じ学校の友達に教える」導線を出す（校内密度グロース）。
 */
export function StatusHero({ status, onShare }: { status: SchoolStatus; onShare?: () => void }) {
  const latest = status.latest;

  if (!latest) {
    return (
      <Card elevation={0} sx={{ bgcolor: "#e8f0fe" }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {status.schoolName}
          </Typography>
          <Typography variant="h5" sx={{ mt: 1, fontWeight: 700 }}>
            まだ判定はありません
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            次回の判定時刻に自動でチェックします。
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const s = STATUS_STYLE[latest.result];
  const reason = [...new Set(latest.warnings.map((w) => `${w.areaName} ${w.warningType}`))];

  return (
    <Card elevation={0} sx={{ bgcolor: `${s.color}1F` }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="body2" sx={{ color: "rgba(0,0,0,0.6)" }}>
            {status.schoolName}
          </Typography>
          <Chip size="small" label="今日" sx={{ bgcolor: s.color, color: "#fff", fontWeight: 700, height: 24 }} />
        </Box>

        <Typography variant="h3" sx={{ mt: 1.5, fontWeight: 800, color: s.color, letterSpacing: "-0.02em" }}>
          {s.label}
        </Typography>

        {reason.length > 0 ? (
          <Typography variant="body1" sx={{ mt: 1.5, fontWeight: 500, color: "rgba(0,0,0,0.75)" }}>
            {reason.join(" / ")}
          </Typography>
        ) : (
          <Typography variant="body2" sx={{ mt: 1.5, color: "rgba(0,0,0,0.6)" }}>
            対象となる警報はありません。
          </Typography>
        )}

        <Box sx={{ mt: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="caption" sx={{ color: "rgba(0,0,0,0.5)" }}>
            {timeLabel(latest.checkedAt)} 判定
          </Typography>
          {onShare && (
            <Button
              size="small"
              startIcon={<IosShareIcon sx={{ fontSize: 18 }} />}
              onClick={onShare}
              sx={{ color: s.color, fontWeight: 700 }}
            >
              友達に教える
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
