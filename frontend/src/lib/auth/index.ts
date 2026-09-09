import { liffAuthProvider } from "./liff.ts";
import { nativeAuthProvider } from "./native.ts";
import type { AuthProvider } from "./types.ts";

export type { AuthProvider } from "./types.ts";

/**
 * ビルド時のプラットフォーム(VITE_PLATFORM)で認証プロバイダを選択する。
 * 既定は LIFF（既存 web の挙動を維持）。native ビルドでは LINE ログイン版を使う。
 */
export function getAuthProvider(): AuthProvider {
  return import.meta.env.VITE_PLATFORM === "native" ? nativeAuthProvider : liffAuthProvider;
}
