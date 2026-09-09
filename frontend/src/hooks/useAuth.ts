import { useEffect, useState } from "react";
import { type ApiClient, createApiClient } from "../api/client.ts";
import { createMockClient } from "../api/mock-client.ts";
import { getAuthProvider } from "../lib/auth/index.ts";

export interface AuthState {
  status: "loading" | "ready" | "error";
  api?: ApiClient;
  error?: string;
}

/**
 * 認証プロバイダ(LIFF / native)で初期化 → ID トークン取得 → API クライアント生成（PRD §21）。
 * VITE_MOCK=1 は LIFF/バックエンド無しのモック（デザイン確認用）。
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    // デザイン確認用モックモード（VITE_MOCK=1）: 認証/バックエンド無しで実画面を表示。
    if (import.meta.env.VITE_MOCK === "1") {
      setState({ status: "ready", api: createMockClient() });
      return;
    }
    (async () => {
      try {
        const provider = getAuthProvider();
        await provider.init();
        const token = provider.getToken();
        if (!token) {
          if (!cancelled) setState({ status: "error", error: "認証トークンを取得できませんでした" });
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
