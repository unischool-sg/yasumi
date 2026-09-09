import { useEffect, useState } from "react";
import { type ApiClient, createApiClient } from "../api/client.ts";
import { createMockClient } from "../api/mock-client.ts";
import { getIdToken, initLiff } from "../lib/liff.ts";

export interface LiffState {
  status: "loading" | "ready" | "error";
  api?: ApiClient;
  error?: string;
}

/** LIFF 初期化 → ID トークン取得 → API クライアント生成（PRD §21）。 */
export function useLiff(): LiffState {
  const [state, setState] = useState<LiffState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    // デザイン確認用モックモード（VITE_MOCK=1）: LIFF/バックエンド無しで実画面を表示。
    if (import.meta.env.VITE_MOCK === "1") {
      setState({ status: "ready", api: createMockClient() });
      return;
    }
    (async () => {
      try {
        await initLiff();
        const token = getIdToken();
        if (!token) {
          if (!cancelled) setState({ status: "error", error: "IDトークンを取得できませんでした" });
          return;
        }
        if (!cancelled) setState({ status: "ready", api: createApiClient(token) });
      } catch (e) {
        if (!cancelled) setState({ status: "error", error: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
