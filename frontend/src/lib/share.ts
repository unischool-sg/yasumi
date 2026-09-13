import liff from "@line/liff";

/**
 * 校内密度グロースの中核となる「友達招待」ユーティリティ。
 * LINE ミニアプリ内では shareTargetPicker で同じ学校の友達へ直接送り、
 * それ以外の環境では Web Share / クリップボードにフォールバックする。
 */

/** ミニアプリの公開ベースURL（招待リンクの起点）。LIFF ID があれば liff.line.me を使う。 */
function miniAppBase(): string {
  const liffId = import.meta.env.VITE_LIFF_ID;
  return liffId ? `https://liff.line.me/${liffId}` : window.location.origin;
}

/** 学校購読の招待リンク（?school=<id>）。着地時にその学校の購読を提案する。 */
export function buildInviteUrl(schoolId: string): string {
  const base = miniAppBase();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}school=${encodeURIComponent(schoolId)}`;
}

/** シェアするテキスト本文（純関数・テスト可能）。 */
export function buildInviteText(schoolName: string, url: string): string {
  return [
    `🏫 ${schoolName}の「今日、学校ある？」がLINEで分かる`,
    "警報が出たら休校か自動で通知。無料。",
    "",
    "▼登録はこちら",
    url,
  ].join("\n");
}

/** 公式アカウントの友だち追加ページを開く（LINE内なら LIFF、外なら通常遷移）。 */
export function openAddFriend(url: string): void {
  if (!url) return;
  try {
    if (liff.isInClient()) {
      liff.openWindow({ url, external: false });
      return;
    }
  } catch {
    /* フォールバックへ */
  }
  window.open(url, "_blank", "noopener");
}

export type ShareResult = "shared" | "cancelled" | "copied" | "unavailable";

/**
 * 同じ学校の友達に招待を送る。
 * 優先度: LIFF shareTargetPicker → OS 共有シート(Web Share) → クリップボードコピー。
 * 例外は投げず ShareResult を返す（呼び出し側でスナックバー表示）。
 */
export async function shareSchool(schoolId: string, schoolName: string): Promise<ShareResult> {
  const url = buildInviteUrl(schoolId);
  const text = buildInviteText(schoolName, url);

  // LINE ミニアプリ内: 友達ピッカーで直接送る（最も校内密度に効く）。
  try {
    if (liff.isApiAvailable("shareTargetPicker")) {
      const res = await liff.shareTargetPicker([{ type: "text", text }]);
      // 送信完了で結果オブジェクト、キャンセル時は null（環境により undefined）。
      return res ? "shared" : "cancelled";
    }
  } catch {
    /* フォールバックへ */
  }

  // ネイティブ/PWA: OS の共有シート。
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return "shared";
    }
  } catch {
    return "cancelled";
  }

  // 最終手段: クリップボードにコピー。
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "unavailable";
  }
}
