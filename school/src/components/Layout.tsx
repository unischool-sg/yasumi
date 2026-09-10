import LogoutIcon from "@mui/icons-material/Logout";
import { AppBar, Box, Button, Chip, Toolbar, Typography } from "@mui/material";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { clearAuth, getAuth } from "../lib/auth.ts";

const PLAN_LABEL: Record<string, string> = { basic: "ベーシック", standard: "スタンダード", premium: "プレミアム" };

export function Layout() {
  const navigate = useNavigate();
  const auth = getAuth();

  function logout() {
    clearAuth();
    navigate({ to: "/login" });
  }

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <AppBar position="fixed">
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            やすみ？ 先生ダッシュボード
          </Typography>
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.95 }}>
            {auth?.teacher.name}（{auth?.teacher.role === "owner" ? "管理者" : "教員"}）
          </Typography>
          <Button color="inherit" size="small" startIcon={<LogoutIcon />} onClick={logout}>
            ログアウト
          </Button>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ p: 3, maxWidth: 960, mx: "auto" }}>
        <Toolbar variant="dense" />
        <Outlet />
      </Box>
    </Box>
  );
}

export function PlanChip({ plan, expiresAt }: { plan: string | null; expiresAt: string | null }) {
  if (!plan) return <Chip size="small" label="未契約（無料）" variant="outlined" />;
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  return (
    <Chip
      size="small"
      color={expired ? "default" : "success"}
      label={`${PLAN_LABEL[plan] ?? plan}${expired ? "（期限切れ）" : ""}`}
    />
  );
}
