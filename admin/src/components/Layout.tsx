import CampaignIcon from "@mui/icons-material/Campaign";
import DashboardIcon from "@mui/icons-material/Dashboard";
import HistoryIcon from "@mui/icons-material/History";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
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
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
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
  // モバイルのドロワー開閉。デスクトップ（md 以上）では常設なので未使用。
  const [mobileOpen, setMobileOpen] = useState(false);

  function logout() {
    clearAuth();
    navigate({ to: "/login" });
  }

  const items = isSuperadmin() ? [...nav, { to: "/admins", label: "管理者アカウント", icon: <ShieldIcon /> }] : nav;

  const drawerContent = (
    <>
      <Toolbar variant="dense" />
      <List sx={{ py: 1 }}>
        {items.map((it) => {
          const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
          return (
            <ListItemButton
              key={it.to}
              component={Link}
              to={it.to}
              selected={active}
              onClick={() => setMobileOpen(false)}
              sx={{ borderRadius: 2, mx: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{it.icon}</ListItemIcon>
              <ListItemText primary={it.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: active ? 700 : 500 } } }} />
            </ListItemButton>
          );
        })}
      </List>
    </>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar variant="dense">
          <IconButton
            color="inherit"
            edge="start"
            aria-label="メニューを開く"
            onClick={() => setMobileOpen((v) => !v)}
            sx={{ mr: 1, display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, fontSize: { xs: 16, sm: 20 } }} noWrap>
            やすみ？ 管理画面
          </Typography>
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.9, display: { xs: "none", sm: "block" } }}>
            {auth?.admin.username}（{auth?.admin.role}）
          </Typography>
          <Button color="inherit" size="small" startIcon={<LogoutIcon />} onClick={logout} sx={{ flexShrink: 0 }}>
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>ログアウト</Box>
          </Button>
        </Toolbar>
      </AppBar>

      {/* ナビ: モバイルは一時ドロワー（ハンバーガー）、デスクトップは常設 */}
      <Box component="nav" sx={{ width: { md: WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: WIDTH, boxSizing: "border-box" } }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: "none", md: "block" }, "& .MuiDrawer-paper": { width: WIDTH, boxSizing: "border-box" } }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, width: { md: `calc(100% - ${WIDTH}px)` } }}>
        <Toolbar variant="dense" />
        <Outlet />
      </Box>
    </Box>
  );
}
