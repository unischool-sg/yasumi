type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Discord Webhook にテキストを送信（運用通知用）。
 * webhookUrl は秘密情報のため env から注入する（リポジトリに置かない）。
 * 失敗しても投げない（呼び出し元の主処理を止めないため）。
 */
export async function postDiscordMessage(
  webhookUrl: string,
  content: string,
  opts: { fetchFn?: FetchFn } = {},
): Promise<boolean> {
  if (!webhookUrl) return false;
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  try {
    const res = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Discord の content 上限は 2000 文字。allowed_mentions で @everyone 等の ping を無効化。
      body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: [] } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
