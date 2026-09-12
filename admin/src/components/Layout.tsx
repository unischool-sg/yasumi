import CampaignIcon from "@mui/icons-material/Campaign";
import DashboardIcon from "@mui/icons-material/Dashboard";
import HistoryIcon from "@mui/icons-material/History";
import LogoutIcon from "@mui/icons-material/Logout";
import PeopleIcon from "@mui/icons-material/People";
import PlaceIcon from "@mui/icons-material/Place";
import SchoolIcon from "@mui/icons-material/School";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ShieldIcon from "@mui/icons-material/AdminPanelSettings";
import {
  AppBar,
  Box,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { clearAuth, getAuth, isSuperadmin } from "../lib/auth.ts";

const WIDTH = 236;

const nav = [
  { to: "/", label: "ダッシュボード", icon: <DashboardIcon /> },
  { to: "/schools", label: "学校・ルール", icon: <SchoolIcon /> },
  { to: "/growth", label: "浸透率（営業）", icon: <TrendingUpIcon /> },
  { to: "/areas", label: "地域マスタ", icon: <PlaceIcon /> },
  { to: "/users", label: "ユーザー", icon: <PeopleIcon /> },
  { to: "/flows", label: "フロー", icon: <CampaignIcon /> },
  { to: "/history", label: "判定・通知履歴", icon: <HistoryIcon /> },
];

export function Layout() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const auth = getAuth();

  function logout() {
    clearAuth();
    navigate({ to: "/login" });
  }

  const items = isSuperadmin() ? [...nav, { to: "/admins", label: "管理者アカウント", icon: <ShieldIcon /> }] : nav;

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            やすみ？ 管理画面
          </Typography>
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.9 }}>
            {auth?.admin.username}（{auth?.admin.role}）
          </Typography>
          <Button color="inherit" size="small" startIcon={<LogoutIcon />} onClick={logout}>
            ログアウト
          </Button>
        </Toolbar>
      </AppBar>

      <Drawer variant="permanent" sx={{ width: WIDTH, "& .MuiDrawer-paper": { width: WIDTH, boxSizing: "border-box" } }}>
        <Toolbar variant="dense" />
        <List sx={{ py: 1 }}>
          {items.map((it) => {
            const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
            return (
              <ListItemButton key={it.to} component={Link} to={it.to} selected={active} sx={{ borderRadius: 2, mx: 1 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>{it.icon}</ListItemIcon>
                <ListItemText primary={it.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: active ? 700 : 500 } } }} />
              </ListItemButton>
            );
          })}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, width: `calc(100% - ${WIDTH}px)` }}>
        <Toolbar variant="dense" />
        <Outlet />
      </Box>
    </Box>
  );
}
