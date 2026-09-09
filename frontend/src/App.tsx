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

  if (liff.status === "loading") return <Centered>読み込み中…</Centered>;
  if (liff.status === "error" || !liff.api) {
    return <Centered>エラー: {liff.error ?? "初期化に失敗しました"}</Centered>;
  }
  return <Main api={liff.api} />;
}

function Main({ api }: { api: ApiClient }) {
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View>({ kind: "tabs" });
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  const reload = useCallback(() => {
    api.listSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  const subscribedIds = new Set(subscriptions.map((s) => s.schoolId));

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-bold">やすみ？</h1>
      </header>

      {view.kind === "tabs" && (
        <nav className="flex border-b border-slate-200 bg-white">
          <TabButton active={tab === "home"} onClick={() => setTab("home")}>
            ホーム
          </TabButton>
          <TabButton active={tab === "search"} onClick={() => setTab("search")}>
            学校を探す
          </TabButton>
        </nav>
      )}

      <main className="mx-auto max-w-md p-4">
        {view.kind === "register" ? (
          <Register
            api={api}
            initialName={view.name}
            onDone={() => {
              reload();
              setView({ kind: "tabs" });
              setTab("home");
            }}
            onCancel={() => setView({ kind: "tabs" })}
          />
        ) : tab === "home" ? (
          <Home api={api} subscriptions={subscriptions} onChanged={reload} />
        ) : (
          <Search
            api={api}
            subscribedIds={subscribedIds}
            onSubscribed={reload}
            onRegister={(name) => setView({ kind: "register", name })}
          />
        )}
      </main>

      <footer className="mx-auto max-w-md px-4 pb-8 pt-4 text-xs text-slate-400">
        本サービスは学校公式ではありません。最終的な登校判断は学校からの公式連絡をご確認ください。
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={`flex-1 py-3 text-sm font-semibold ${active ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-center text-slate-600">{children}</div>
  );
}
