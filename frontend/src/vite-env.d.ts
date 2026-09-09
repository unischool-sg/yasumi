/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIFF_ID?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MOCK?: string;
  /** 実行プラットフォーム。未設定/"liff"=LINEミニアプリ、"native"=Capacitorアプリ。 */
  readonly VITE_PLATFORM?: "liff" | "native";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
