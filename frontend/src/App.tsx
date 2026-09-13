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
  Button,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Fab,
  Paper,
  Snackbar,
  Toolbar,
  Typography,
} from "@mui/material";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ApiClient } from "./api/client.ts";
import type { SchoolSummary, Subscription } from "./api/types.ts";
import { getLiffFriendFlag } from "./lib/auth/liff.ts";
import { openAddFriend } from "./lib/share.ts";

/** 公式アカウントの友だち追加URL（未友だちに通知が届かない対策の導線）。 */
const ADD_FRIEND_URL = import.meta.env.VITE_LINE_ADD_FRIEND_URL ?? "";
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
  // 友達招待リンク（?school=<id>）で開かれたときの購読提案（校内密度グロースの着地点）。
  const [joinSchool, setJoinSchool] = useState<SchoolSummary | null>(null);
  const [joining, setJoining] = useState(false);
  // 公式アカウントの友だち状態（null=不明/非LIFF）。false のとき LINE プッシュが届かないため追加導線を出す。
  const [isFriend, setIsFriend] = useState<boolean | null>(null);

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

  // 流入クエリ一式（gclid/utm_*/school/ref…）を first-touch 保存。
  // 友だち追加リダイレクトで URL パラメータが失われる前に着地直後へ保存する（アトリビューション堅牢化）。
  useEffect(() => {
    const query = readAllQueryParams();
    if (Object.keys(query).length > 0) api.saveAttribution({ query }).catch(() => {});
  }, [api]);

  // 公式アカウントの友だち状態を取得（LIFF のみ）。未友だちなら通知が届かないため追加導線を出す。
  useEffect(() => {
    getLiffFriendFlag().then(setIsFriend).catch(() => setIsFriend(null));
  }, []);

  // 友達招待リンク（?school=<id>）で開かれたら、その学校の購読提案ダイアログを出す。
  // 再読込での二重発火を防ぐため、取得後に URL からパラメータを除去する。
  useEffect(() => {
    const schoolId = readQueryParam("school");
    if (!schoolId) return;
    clearQueryParam("school");
    api.getSchool(schoolId).then(setJoinSchool).catch(() => {});
  }, [api]);

  async function confirmJoin() {
    if (!joinSchool) return;
    setJoining(true);
    try {
      await api.subscribe(joinSchool.id);
      reload();
      setTab("home");
      setSnack(`${joinSchool.name}の通知をONにしました`);
      setJoinSchool(null);
    } catch {
      setSnack("登録に失敗しました。時間をおいて再度お試しください");
    } finally {
      setJoining(false);
    }
  }

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

      {/* 未友だちは LINE プッシュが届かない（送信側が 400）。友だち追加を促す。 */}
      {isFriend === false && ADD_FRIEND_URL && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => openAddFriend(ADD_FRIEND_URL)}>
              追加する
            </Button>
          }
          sx={{ borderRadius: 0 }}
        >
          通知を受け取るには公式アカウントの友だち追加が必要です。
        </Alert>
      )}

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

      {/* 友達招待リンクの着地: その学校の購読を提案（校内密度グロース） */}
      <Dialog open={joinSchool !== null} onClose={() => !joining && setJoinSchool(null)}>
        <DialogTitle sx={{ fontWeight: 700 }}>{joinSchool?.name}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {joinSchool && subscribedIds.has(joinSchool.id)
              ? "この学校はすでに登録済みです。警報ルールに応じて今日の登校可否を通知します。"
              : "この学校を登録すると、警報ルールに応じて今日の登校可否をLINEで自動通知します。無料です。"}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setJoinSchool(null)} disabled={joining}>
            閉じる
          </Button>
          {joinSchool && !subscribedIds.has(joinSchool.id) && (
            <Button variant="contained" onClick={confirmJoin} disabled={joining}>
              通知を受け取る
            </Button>
          )}
        </DialogActions>
      </Dialog>

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

/**
 * 現在のクエリを { 直接のクエリ ∪ liff.state 内のクエリ } として1つにまとめて返す。
 * LIFF はログイン/友だち追加リダイレクトで元のクエリを liff.state に入れることがあり、
 * その形は `?school=..` / `/?school=..` / `school=..` と揺れるため、最初の `?` 以降を取り出す。
 */
function readAllQueryParams(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const sp = new URLSearchParams(window.location.search);
    for (const [k, v] of sp) {
      if (k !== "liff.state") out[k] = v;
    }
    const state = sp.get("liff.state");
    if (state) {
      const q = state.includes("?") ? state.slice(state.indexOf("?") + 1) : state;
      for (const [k, v] of new URLSearchParams(q)) out[k] = v;
    }
  } catch {
    /* noop */
  }
  return out;
}

/** 単一パラメータを取得（直接クエリと liff.state の両対応）。 */
function readQueryParam(name: string): string | null {
  return readAllQueryParams()[name] ?? null;
}

/** URL からクエリパラメータを除去（履歴を汚さず replaceState）。再読込での二重処理防止。 */
function clearQueryParam(name: string): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* noop */
  }
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
