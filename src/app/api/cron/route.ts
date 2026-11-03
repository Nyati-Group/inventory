import { NextResponse } from "next/server";
import { runDueJobs } from "@/lib/jobs";
import { safeEqual } from "@/lib/tokens";

/**
 * External scheduler hook (e.g. Vercel Cron / a system cron hitting this every minute):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron
 * The in-process runner (instrumentation) does the same on long-running servers.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(auth, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runDueJobs());
}
