import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { useSecureCookies } from "@/lib/auth-cookies";

export const dynamic = "force-dynamic";

/** Strip anything that could be a connection string or credential from an error message. */
function clean(msg: string) {
  return msg.replace(/mongodb(\+srv)?:\/\/\S+/gi, "mongodb://***").replace(/\s+/g, " ").slice(0, 300);
}

/**
 * Deployment self-check (public, no secrets): open https://<your-app>/api/health.
 * Explains the usual reasons sign-in fails after deploying.
 */
export async function GET(req: Request) {
  const problems: string[] = [];
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const publicOrigin = host ? `${proto}://${host}` : null;
  const nextauthUrl = process.env.NEXTAUTH_URL ?? null;

  if (!process.env.NEXTAUTH_SECRET) problems.push("NEXTAUTH_SECRET is not set — sign-in cannot work. Add it to the host's environment variables.");
  if (!nextauthUrl) problems.push(`NEXTAUTH_URL is not set — set it to ${publicOrigin ?? "your public https URL"}.`);
  else if (publicOrigin && new URL(nextauthUrl).host !== host)
    problems.push(`NEXTAUTH_URL is ${nextauthUrl} but this site is served at ${publicOrigin} — set NEXTAUTH_URL (and APP_URL) to ${publicOrigin}.`);
  if (proto === "https" && !useSecureCookies) problems.push("Site is served over https but NEXTAUTH_URL/APP_URL is not https — set them to the https address.");
  if (!process.env.MONGODB_URI && !process.env.DATABASE_URL) problems.push("MONGODB_URI is not set.");

  const database: { reachable: boolean; usersExist?: boolean; adminExists?: boolean; error?: string } = { reachable: false };
  try {
    const [users, admins] = await Promise.all([db.user.count(), db.user.count({ where: { role: "ADMIN", isActive: true } })]);
    database.reachable = true;
    database.usersExist = users > 0;
    database.adminExists = admins > 0;
    if (!admins) problems.push('No active admin user — run: npm run create-admin -- you@nyati.in "Your Name" "password"');
  } catch (e) {
    database.error = clean((e as Error).message);
    problems.push(
      "Cannot reach MongoDB. Check MONGODB_URI / MONGODB_DB, and in Atlas → Network Access allow this server's IP (on Render/Railway, which use changing IPs, allow 0.0.0.0/0).",
    );
  }

  return NextResponse.json(
    {
      ok: problems.length === 0,
      problems,
      checks: {
        servedAt: publicOrigin,
        nextauthUrl,
        appUrl: process.env.APP_URL ?? null,
        nextauthSecretSet: !!process.env.NEXTAUTH_SECRET,
        secureCookies: useSecureCookies,
        database,
        databaseName: process.env.MONGODB_DB ?? null,
        nodeVersion: process.version,
      },
    },
    { status: problems.length ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
