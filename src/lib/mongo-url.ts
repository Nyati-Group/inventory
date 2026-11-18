// Builds the Prisma connection string from MONGODB_URI + MONGODB_DB (.env).
// Dependency-free so the seed and scripts/prisma.mjs can import it with Node's type stripping.
//
//   MONGODB_URI="mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority"
//   MONGODB_DB="nyati_procurement"
//   → mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/nyati_procurement?retryWrites=true&w=majority
//
// Falls back to DATABASE_URL when MONGODB_URI is not set.

export function mongoUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const uri = env.MONGODB_URI?.trim();
  if (!uri) return env.DATABASE_URL || undefined;
  const name = env.MONGODB_DB?.trim();
  const m = uri.match(/^(mongodb(?:\+srv)?:\/\/[^/?]+)(\/[^?]*)?(\?.*)?$/);
  if (!m) throw new Error("MONGODB_URI must start with mongodb:// or mongodb+srv://");
  const [, base, pathPart, query = ""] = m;
  const db = name || (pathPart && pathPart !== "/" ? pathPart.slice(1) : "");
  if (!db) throw new Error("Set MONGODB_DB (or include the database name in MONGODB_URI)");
  return `${base}/${encodeURIComponent(db)}${withPoolDefaults(query)}`;
}

/**
 * Connection-pool defaults (only added when the URI doesn't set them):
 * - maxIdleTimeMS: retire idle connections before routers/NAT/serverless freezes silently drop them — a query sent
 *   on a dead connection otherwise hangs until the timeout (~10 s) before the driver retries.
 * - connectTimeoutMS / socketTimeoutMS: fail over to a fresh connection quickly instead of waiting 10 s+.
 */
const POOL_DEFAULTS: Record<string, string> = { maxIdleTimeMS: "30000", connectTimeoutMS: "5000", retryReads: "true", retryWrites: "true" };

function withPoolDefaults(query: string) {
  const params = new URLSearchParams(query.replace(/^\?/, ""));
  const have = new Set([...params.keys()].map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(POOL_DEFAULTS)) if (!have.has(k.toLowerCase())) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : "";
}
