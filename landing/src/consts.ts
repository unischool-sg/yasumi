// LINE 公式アカウント友だち追加（ミニアプリの入口）。
export const LINE_URL = "https://line.me/R/ti/p/%40270qmktw";

// LIFF ID（設定時、CTA を LIFF 経由にして gclid を引き継ぐ / Google Ads 計測）。
export const LIFF_ID = import.meta.env.PUBLIC_LIFF_ID || "";

// 学校向け営業LP（/for-schools）の問い合わせ先。
export const SCHOOL_CONTACT_EMAIL = "unischool@sandagakuen.ed.jp";

// 先生ダッシュボード（学校向けログイン）の公開URL。
export const SCHOOL_APP_URL = "https://yasumi-school.unischool.jp";

// 運営者情報（フッター・規約・特商法で使用）。
export const OPERATOR = {
  name: "UniSchool",
  manager: "田中博悠",
  email: "unischool@sandagakuen.ed.jp",
};

// 公開API のベースURL（学校一覧ページで使用）。
// PUBLIC_API_BASE_URL で上書き可能。未設定・空文字なら本番APIを既定にして env なしでも動く。
// compose が "定義済みの空文字" を build arg で渡すため ?? ではなく || を使う（"" もフォールバック）。
export const API_BASE = import.meta.env.PUBLIC_API_BASE_URL || "https://yasumi-api.unischool.jp";
