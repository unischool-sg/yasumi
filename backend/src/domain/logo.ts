import { extFromMime } from "../infrastructure/storage/s3.ts";

const MAX_BYTES = 512 * 1024; // 512KB

export type PreparedLogo =
  | { ok: true; bytes: Uint8Array; key: string; contentType: string }
  | { ok: false; error: string };

/**
 * ロゴアップロード入力（base64）を検証し、保存キーとバイト列を作る。
 * 対応: png/jpeg/webp/svg・512KB 以下。キーは logos/<schoolId>.<ext>。
 */
export function prepareLogo(schoolId: string, contentType: string, dataBase64: string): PreparedLogo {
  const ext = extFromMime(contentType);
  if (!ext) return { ok: false, error: "対応していない画像形式です（png/jpeg/webp/svg）" };
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(dataBase64, "base64"));
  } catch {
    return { ok: false, error: "画像データが不正です" };
  }
  if (bytes.length === 0) return { ok: false, error: "画像が空です" };
  if (bytes.length > MAX_BYTES) return { ok: false, error: "画像サイズが大きすぎます（512KBまで）" };
  return { ok: true, bytes, key: `logos/${schoolId}.${ext}`, contentType };
}
