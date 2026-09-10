type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface LineProfile {
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

/**
 * LINE Messaging API でユーザーのプロフィールを取得（GET /v2/bot/profile/{userId}）。
 * bot を友だち追加済みのユーザーのみ取得可。未友だち/失敗時は null（管理画面の表示用途）。
 */
export async function getLineProfile(
  accessToken: string,
  lineUserId: string,
  opts: { fetchFn?: FetchFn } = {},
): Promise<LineProfile | null> {
  if (!accessToken) return null;
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  try {
    const res = await fetchFn(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LineProfile;
    return data.displayName ? data : null;
  } catch {
    return null;
  }
}
