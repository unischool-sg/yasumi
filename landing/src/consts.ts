// LINE 公式アカウント友だち追加（ミニアプリの入口）。
export const LINE_URL = "https://line.me/R/ti/p/%40270qmktw";

// 公開API のベースURL（学校一覧ページで使用）。
// PUBLIC_API_BASE_URL で上書き可能。未設定時は本番APIを既定にして env なしでも動くようにする
//（astro.config の site 既定と同じ思想。ドメインは .env.example に公開済み）。
export const API_BASE = import.meta.env.PUBLIC_API_BASE_URL ?? "https://yasumi-api.unischool.jp";
