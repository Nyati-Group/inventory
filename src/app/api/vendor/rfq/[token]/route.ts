import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { submitQuotation, declineRfq, PortalError } from "@/lib/services/vendor-portal";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

const optNum = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(0).nullable());
const optStr = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null), z.string().nullable());

const Fields = z.object({
  unitRate: optNum,
  gstPercent: optNum,
  freight: optNum,
  loading: optNum,
  total: optNum,
  deliveryDays: optNum,
  deliveryDate: optStr,
  paymentTerms: optStr,
  validityDays: optNum,
  warranty: optStr,
  remarks: optStr,
  quantity: optNum,
});

function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? null;
}

/** Public, tokenised endpoint for vendor quotation submission / decline. Rate-limited per IP and per token. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ip = clientIp(req);
  if (!rateLimit(`vendor:ip:${ip}`, 30, 60_000) || !rateLimit(`vendor:tok:${params.token}`, 10, 60_000))
    return NextResponse.json({ error: "Too many requests — please wait a minute and try again." }, { status: 429 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 512 * 1024) return NextResponse.json({ error: "File is larger than 10 MB." }, { status: 413 });
  try {
    const fd = await req.formData();
    if (fd.get("action") === "decline") {
      await declineRfq(params.token, String(fd.get("reason") ?? ""), ip);
      return NextResponse.json({ ok: true });
    }
    const method = z.enum(["TEXT", "PDF", "DOCX", "IMAGE", "XLSX"]).parse(fd.get("method"));
    const fields = Fields.parse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
    const f = fd.get("file");
    const file = f instanceof File && f.size ? { name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) } : undefined;
    const r = await submitQuotation(params.token, { method, text: String(fd.get("text") ?? ""), file, fields }, ip, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof PortalError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Please check the values you entered." }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
