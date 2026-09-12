import LogoutIcon from "@mui/icons-material/Logout";
import { AppBar, Box, Button, Chip, Stack, Toolbar, Typography } from "@mui/material";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { clearAuth, getAuth } from "../lib/auth.ts";

const PLAN_LABEL: Record<string, string> = { basic: "ベーシック", standard: "スタンダード", premium: "プレミアム" };

const nav = [
  { to: "/", label: "送信" },
  { to: "/absences", label: "欠席受付" },
];
const ownerNav = [{ to: "/manage", label: "管理" }];

export function Layout() {
  const navigate = useNavigate();
  const auth = getAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });

  function logout() {
    clearAuth();
    navigate({ to: "/login" });
  }

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <AppBar position="fixed">
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ fontWeight: 700, mr: 3 }}>
            やすみ？ 先生ダッシュボード
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexGrow: 1 }}>
            {[...nav, ...(auth?.teacher.role === "owner" ? ownerNav : [])].map((n) => {
              const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
              return (
                <Button
                  key={n.to}
                  component={Link}
                  to={n.to}
                  color="inherit"
                  size="small"
                  sx={{ fontWeight: active ? 700 : 400, opacity: active ? 1 : 0.85, borderBottom: active ? "2px solid #fff" : "2px solid transparent", borderRadius: 0 }}
                >
                  {n.label}
                </Button>
              );
            })}
          </Stack>
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
