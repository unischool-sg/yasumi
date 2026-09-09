import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * LINE Webhook 署名検証（PRD §54）。
 * 生ボディを channelSecret で HMAC-SHA256 → base64 し、X-Line-Signature と定数時間比較する。
 */
export function verifySignature(rawBody: string, signature: string | undefined, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
