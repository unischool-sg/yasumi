type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Google Ads へのクリックコンバージョン送信の抽象（テストでフェイク注入）。 */
export interface AdsConversionProvider {
  upload(input: { gclid: string; at: Date }): Promise<boolean>;
}

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // ハイフン無し
  loginCustomerId?: string; // MCC 経由の場合
  conversionAction: string; // resource name: customers/<id>/conversionActions/<id>
}

/** JST の "YYYY-MM-DD HH:mm:ss+09:00" 形式（Ads の conversion_date_time 要件）。 */
function adsDateTime(at: Date): string {
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}:${p(jst.getUTCSeconds())}+09:00`;
}

/**
 * Google Ads REST（uploadClickConversions）でコンバージョンを送る provider。
 * 資格情報が不足していれば null（＝ドーマント。gclidは貯まるが送信しない）。失敗しても投げない。
 */
export function createGoogleAdsConversionProvider(cfg: Partial<GoogleAdsConfig>, opts: { fetchFn?: FetchFn } = {}): AdsConversionProvider | null {
  if (!cfg.developerToken || !cfg.clientId || !cfg.clientSecret || !cfg.refreshToken || !cfg.customerId || !cfg.conversionAction) {
    return null;
  }
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const config = cfg as GoogleAdsConfig;
  return {
    async upload({ gclid, at }) {
      try {
        // 1) refresh token → access token
        const tokenRes = await fetchFn("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: config.refreshToken,
            grant_type: "refresh_token",
          }).toString(),
        });
        if (!tokenRes.ok) return false;
        const accessToken = ((await tokenRes.json()) as { access_token?: string }).access_token;
        if (!accessToken) return false;

        // 2) uploadClickConversions
        const url = `https://googleads.googleapis.com/v18/customers/${config.customerId}:uploadClickConversions`;
        const res = await fetchFn(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "developer-token": config.developerToken,
            ...(config.loginCustomerId ? { "login-customer-id": config.loginCustomerId } : {}),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            conversions: [{ gclid, conversionAction: config.conversionAction, conversionDateTime: adsDateTime(at) }],
            partialFailure: true,
          }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
