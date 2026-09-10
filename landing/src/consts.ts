// LINE 公式アカウント友だち追加（ミニアプリの入口）。
export const LINE_URL = "https://line.me/R/ti/p/%40270qmktw";

// 学校向け営業LP（/for-schools）の問い合わせ先。※公開前に正式アドレスへ差し替えること。
export const SCHOOL_CONTACT_EMAIL = "contact@unischool.jp";

// 公開API のベースURL（学校一覧ページで使用）。
// PUBLIC_API_BASE_URL で上書き可能。未設定・空文字なら本番APIを既定にして env なしでも動く。
// compose が "定義済みの空文字" を build arg で渡すため ?? ではなく || を使う（"" もフォールバック）。
export const API_BASE = import.meta.env.PUBLIC_API_BASE_URL || "https://yasumi-api.unischool.jp";
