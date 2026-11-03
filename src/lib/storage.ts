import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { hmac, safeEqual } from "./tokens";

/** File storage abstraction. `local` writes to ./.data/uploads; `s3` uses @aws-sdk/client-s3 if installed. */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const ALLOWED_MIME: Record<string, string[]> = {
  quotation: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png",
    "image/jpeg",
    "text/plain",
  ],
  document: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  template: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function validateUpload(file: { size: number; type: string; name: string }, kind: keyof typeof ALLOWED_MIME) {
  if (file.size > MAX_UPLOAD_BYTES) return "File is larger than 10 MB.";
  const mime = file.type || guessMime(file.name);
  if (!ALLOWED_MIME[kind].includes(mime)) return `File type not allowed (${mime || "unknown"}).`;
  return null;
}

export function guessMime(name: string) {
  const ext = name.toLowerCase().split(".").pop();
  return (
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      doc: "application/msword",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      txt: "text/plain",
    }[ext ?? ""] ?? "application/octet-stream"
  );
}

/** Hook for an AV scanner (e.g. ClamAV). Returns null when clean. */
export async function virusScan(_data: Buffer): Promise<string | null> {
  return null;
}

class LocalDriver implements StorageDriver {
  root = path.resolve(".data/uploads");
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root)) throw new Error("Invalid key");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.p(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
  async get(key: string) {
    return fs.readFile(this.p(key));
  }
}

class S3Driver implements StorageDriver {
  private async client() {
    // Optional dependency: npm i @aws-sdk/client-s3
    const mod = "@aws-sdk/client-s3";
    const s3 = await import(/* webpackIgnore: true */ mod).catch(() => {
      throw new Error("STORAGE_DRIVER=s3 requires `npm i @aws-sdk/client-s3`");
    });
    const client = new s3.S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
    return { s3, client };
  }
  async put(key: string, data: Buffer, contentType: string) {
    const { s3, client } = await this.client();
    await client.send(new s3.PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    const { s3, client } = await this.client();
    const res = await client.send(new s3.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return Buffer.from(await res.Body.transformToByteArray());
  }
}

export const storage: StorageDriver = process.env.STORAGE_DRIVER === "s3" ? new S3Driver() : new LocalDriver();

export async function saveFile(prefix: string, name: string, data: Buffer, contentType: string) {
  const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const key = `${prefix}/${crypto.randomUUID()}-${safe}`;
  await storage.put(key, data, contentType);
  return key;
}

/** Signed, expiring download URL served by /api/files. */
export function signedUrl(key: string, ttlSeconds = 60 * 60 * 24 * 7, name?: string) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(`${key}:${exp}`);
  const q = new URLSearchParams({ key, exp: String(exp), sig });
  if (name) q.set("name", name);
  return `/api/files?${q.toString()}`;
}

export function verifySignedUrl(key: string, exp: string, sig: string) {
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmac(`${key}:${exp}`), sig);
}
