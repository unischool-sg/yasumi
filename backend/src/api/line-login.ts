type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";

/**
 * ネイティブアプリの LINE ログイン: 認可コードを ID トークンに交換する（PKCE + confidential client）。
 * channel secret は端末に置けないため、この交換はサーバー側で行う。
 * 返す id_token は既存の verifyIdToken（client_id=LIFF_CHANNEL_ID）でそのまま検証できる
 * （ネイティブは LIFF と同じ LINE Login チャネルを使う前提）。
 */
export async function exchangeLineCode(
  params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    channelId: string;
    channelSecret: string;
  },
  opts: { fetchFn?: FetchFn } = {},
): Promise<{ idToken: string }> {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const res = await fetchFn(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.channelId,
      client_secret: params.channelSecret,
      code_verifier: params.codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`LINE token exchange failed (HTTP ${res.status})`);
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("LINE token exchange: no id_token");
  return { idToken: data.id_token };
}
