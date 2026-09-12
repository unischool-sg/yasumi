import AddIcon from "@mui/icons-material/Add";
import EditNoteIcon from "@mui/icons-material/EditNote";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
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
import { useAuth } from "./hooks/useAuth.ts";
import { registerPushToken } from "./native/push.ts";
import { AbsenceReport } from "./pages/AbsenceReport.tsx";
import { EditSchool } from "./pages/EditSchool.tsx";
import { Home } from "./pages/Home.tsx";
import { MySchools } from "./pages/MySchools.tsx";
import { Register } from "./pages/Register.tsx";
import { Search } from "./pages/Search.tsx";

type Tab = "home" | "search" | "manage";
type View =
  | { kind: "tabs" }
  | { kind: "register"; name: string }
  | { kind: "edit"; schoolId: string }
  | { kind: "absence" };

export function App() {
  const auth = useAuth();
  if (auth.status === "loading") return <Splash>読み込み中…</Splash>;
  if (auth.status === "error" || !auth.api) {
    return <Splash error>{auth.error ?? "初期化に失敗しました"}</Splash>;
  }
  return <Main api={auth.api} />;
}

function Main({ api }: { api: ApiClient }) {
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View>({ kind: "tabs" });
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [snack, setSnack] = useState<string | null>(null);
  const [hasAbsence, setHasAbsence] = useState(false);

  const reload = useCallback(() => {
    api.listSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
    // 欠席受付が使える学校（premium・購読中）があるかで導線を出し分け
    api.listAbsenceSchools().then((s) => setHasAbsence(s.length > 0)).catch(() => setHasAbsence(false));
  }, [api]);
  useEffect(() => reload(), [reload]);

  // ネイティブアプリ実行時は FCM デバイストークンを登録（無料プッシュの送信先）。web は no-op。
  useEffect(() => {
    registerPushToken(api);
  }, [api]);

  // 広告クリックID(gclid)を保存（Google Ads コンバージョン計測）。URL / LIFF state から取得。
  useEffect(() => {
    const gclid = readGclid();
    if (gclid) api.saveAttribution({ gclid }).catch(() => {});
  }, [api]);

  const subscribedIds = new Set(subscriptions.map((s) => s.schoolId));
  const isModal = view.kind !== "tabs";
  const title =
    view.kind === "register" ? "学校を登録"
    : view.kind === "edit" ? "学校を編集"
    : view.kind === "absence" ? "欠席を連絡"
    : "やすみ？";

  return (
    <Box sx={{ maxWidth: 480, mx: "auto", minHeight: "100dvh", bgcolor: "background.default", position: "relative" }}>
      <AppBar position="sticky" elevation={0} sx={{ borderBottom: "1px solid #e8eaed" }}>
        <Toolbar variant="dense" sx={{ minHeight: 56 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" sx={{ pt: 2, pb: isModal ? 4 : 12 }}>
        {view.kind === "register" ? (
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
        ) : view.kind === "edit" ? (
          <EditSchool api={api} schoolId={view.schoolId} onBack={() => setView({ kind: "tabs" })} onNotify={setSnack} />
        ) : view.kind === "absence" ? (
          <AbsenceReport api={api} onBack={() => setView({ kind: "tabs" })} onNotify={setSnack} />
        ) : tab === "home" ? (
          <Home
            api={api}
            subscriptions={subscriptions}
            onChanged={reload}
            onGoSearch={() => setTab("search")}
            onNotify={setSnack}
            showAbsence={hasAbsence}
            onAbsence={() => setView({ kind: "absence" })}
          />
        ) : tab === "search" ? (
          <Search
            api={api}
            subscribedIds={subscribedIds}
            onSubscribed={reload}
            onRegister={(name) => setView({ kind: "register", name })}
            onNotify={setSnack}
          />
        ) : (
          <MySchools api={api} onEdit={(schoolId) => setView({ kind: "edit", schoolId })} />
        )}

        {!isModal && (
          <Typography variant="caption" align="center" color="text.secondary" sx={{ display: "block", mt: 4 }}>
            本サービスは学校公式ではありません。最終的な登校判断は学校からの公式連絡をご確認ください。
          </Typography>
        )}
      </Container>

      {/* 主要アクションの FAB（Material） */}
      {!isModal && tab === "home" && (
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

      {!isModal && (
        <Paper
          elevation={0}
          sx={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, mx: "auto", borderTop: "1px solid #e8eaed", borderRadius: 0 }}
        >
          <BottomNavigation value={tab} onChange={(_, v) => setTab(v as Tab)} showLabels>
            <BottomNavigationAction value="home" label="ホーム" icon={tab === "home" ? <HomeIcon /> : <HomeOutlinedIcon />} />
            <BottomNavigationAction value="search" label="さがす" icon={<SearchIcon />} />
            <BottomNavigationAction value="manage" label="編集" icon={tab === "manage" ? <EditNoteIcon /> : <EditNoteOutlinedIcon />} />
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

/** gclid を URL クエリまたは LIFF の liff.state（エンコードされたクエリ）から取得。 */
function readGclid(): string | null {
  try {
    const sp = new URLSearchParams(window.location.search);
    const direct = sp.get("gclid");
    if (direct) return direct;
    // LIFF は元のクエリを liff.state に入れることがある（例: liff.state=%3Fgclid%3D...）。
    const state = sp.get("liff.state");
    if (state) {
      const inner = new URLSearchParams(state.startsWith("?") ? state.slice(1) : state);
      return inner.get("gclid");
    }
  } catch {
    /* noop */
  }
  return null;
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
