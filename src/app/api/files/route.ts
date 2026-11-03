import { NextResponse } from "next/server";
import { storage, verifySignedUrl, guessMime } from "@/lib/storage";

/** Signed, expiring downloads. URLs are created by signedUrl(); no session needed (vendor portal uses them too). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const key = q.get("key") ?? "";
  if (!verifySignedUrl(key, q.get("exp") ?? "0", q.get("sig") ?? "")) return NextResponse.json({ error: "Link expired or invalid" }, { status: 403 });
  try {
    const data = await storage.get(key);
    const name = q.get("name") ?? key.split("/").pop() ?? "file";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": guessMime(name),
        "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
