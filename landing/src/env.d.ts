/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** 公開API のベースURL（学校一覧ページが叩く / ビルド時に埋め込み）。 */
  readonly PUBLIC_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
