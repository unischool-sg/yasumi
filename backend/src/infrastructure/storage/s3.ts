import { S3Client } from "bun";

/**
 * オブジェクトストレージ抽象（ロゴ画像など）。テストではフェイクを注入する。
 */
export interface Storage {
  put(key: string, data: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
}

/**
 * RustFS(S3互換, https://aws-api.unischool.jp) 用ストレージ。Bun 標準 S3Client を使用。
 * 資格情報は env 注入（リポジトリに置かない）。設定不足なら null を返す（機能はドーマント）。
 */
export function createS3Storage(cfg: Partial<S3Config>): Storage | null {
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) return null;
  const client = new S3Client({
    endpoint: cfg.endpoint,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    bucket: cfg.bucket,
    region: cfg.region ?? "us-east-1",
  });
  return {
    async put(key, data, contentType) {
      await client.file(key).write(data, { type: contentType });
    },
    async get(key) {
      const f = client.file(key);
      if (!(await f.exists())) return null;
      return new Uint8Array(await f.arrayBuffer());
    },
    async delete(key) {
      await client.file(key).delete();
    },
  };
}

/** キー拡張子から MIME を推定（配信時の content-type 用）。 */
export function mimeFromKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/** MIME から拡張子（アップロード時のキー生成用）。対応外は null。 */
export function extFromMime(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return null;
  }
}
