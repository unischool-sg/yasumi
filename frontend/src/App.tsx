import AddIcon from "@mui/icons-material/Add";
import HomeIcon from "@mui/icons-material/Home";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  AppBar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  CircularProgress,
  Container,
  Fab,
  Paper,
  Snackbar,
  Toolbar,
  Typography,
} from "@mui/material";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ApiClient } from "./api/client.ts";
import type { Subscription } from "./api/types.ts";
import { useLiff } from "./hooks/useLiff.ts";
import { Home } from "./pages/Home.tsx";
import { Register } from "./pages/Register.tsx";
import { Search } from "./pages/Search.tsx";

type Tab = "home" | "search";
type View = { kind: "tabs" } | { kind: "register"; name: string };

export function App() {
  const liff = useLiff();
  if (liff.status === "loading") return <Splash>読み込み中…</Splash>;
  if (liff.status === "error" || !liff.api) {
    return <Splash error>{liff.error ?? "初期化に失敗しました"}</Splash>;
  }
  return <Main api={liff.api} />;
}

function Main({ api }: { api: ApiClient }) {
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View>({ kind: "tabs" });
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [snack, setSnack] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.listSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
  }, [api]);
  useEffect(() => reload(), [reload]);

  const subscribedIds = new Set(subscriptions.map((s) => s.schoolId));
  const inRegister = view.kind === "register";

  return (
    <Box sx={{ maxWidth: 480, mx: "auto", minHeight: "100dvh", bgcolor: "background.default", position: "relative" }}>
      <AppBar position="sticky" elevation={0} sx={{ borderBottom: "1px solid #e8eaed" }}>
        <Toolbar variant="dense" sx={{ minHeight: 56 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {inRegister ? "学校を登録" : "やすみ？"}
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" sx={{ pt: 2, pb: inRegister ? 4 : 12 }}>
        {inRegister ? (
          <Register
            api={api}
            initialName={view.name}
            onDone={() => {
              reload();
              setView({ kind: "tabs" });
              setTab("home");
              setSnack("学校を登録し、通知をONにしました");
            }}
            onCancel={() => setView({ kind: "tabs" })}
          />
        ) : tab === "home" ? (
          <Home
            api={api}
            subscriptions={subscriptions}
            onChanged={reload}
            onGoSearch={() => setTab("search")}
            onNotify={setSnack}
          />
        ) : (
          <Search
            api={api}
            subscribedIds={subscribedIds}
            onSubscribed={reload}
            onRegister={(name) => setView({ kind: "register", name })}
            onNotify={setSnack}
          />
        )}

        {!inRegister && (
          <Typography variant="caption" align="center" color="text.secondary" sx={{ display: "block", mt: 4 }}>
            本サービスは学校公式ではありません。最終的な登校判断は学校からの公式連絡をご確認ください。
          </Typography>
        )}
      </Container>

      {/* 主要アクションの FAB（Material） */}
      {!inRegister && tab === "home" && (
        <Fab
          color="primary"
          variant="extended"
          onClick={() => setView({ kind: "register", name: "" })}
          sx={{ position: "fixed", right: 16, bottom: 72, zIndex: 1200 }}
        >
          <AddIcon sx={{ mr: 1 }} />
          学校を追加
        </Fab>
      )}

      {!inRegister && (
        <Paper
          elevation={0}
          sx={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, mx: "auto", borderTop: "1px solid #e8eaed", borderRadius: 0 }}
        >
          <BottomNavigation value={tab} onChange={(_, v) => setTab(v as Tab)} showLabels>
            <BottomNavigationAction value="home" label="ホーム" icon={tab === "home" ? <HomeIcon /> : <HomeOutlinedIcon />} />
            <BottomNavigationAction value="search" label="さがす" icon={<SearchIcon />} />
          </BottomNavigation>
        </Paper>
      )}

      <Snackbar
        open={snack !== null}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ bottom: { xs: 80 } }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSnack(null)} sx={{ width: "100%" }}>
          {snack}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function Splash({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 3 }}>
      <Box sx={{ textAlign: "center" }}>
        {!error && <CircularProgress size={28} sx={{ mb: 2 }} />}
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 700 }}>
          やすみ？
        </Typography>
        <Typography variant="body2" color={error ? "error" : "text.secondary"}>
          {children}
        </Typography>
      </Box>
    </Box>
  );
}
