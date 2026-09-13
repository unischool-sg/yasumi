/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIFF_ID?: string;
  readonly VITE_API_BASE_URL?: string;
  /** 公式アカウントの友だち追加URL（未友だち導線 / 例: https://lin.ee/xxxx）。 */
  readonly VITE_LINE_ADD_FRIEND_URL?: string;
  readonly VITE_MOCK?: string;
  /** 実行プラットフォーム。未設定/"liff"=LINEミニアプリ、"native"=Capacitorアプリ。 */
  readonly VITE_PLATFORM?: "liff" | "native";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
