import crypto from "node:crypto";

/** Cryptographically random URL-safe token (only its hash is stored). */
export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const secret = () => process.env.NEXTAUTH_SECRET ?? "dev-secret";

export function hmac(data: string) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function key() {
  return crypto.createHash("sha256").update(`enc:${secret()}`).digest();
}

/** Reversible encryption for tokens that must be re-sent (reminders). AES-256-GCM. */
export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
}

export function decrypt(blob: string) {
  const b = Buffer.from(blob, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

export function appUrl(path = "") {
  const base = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}
