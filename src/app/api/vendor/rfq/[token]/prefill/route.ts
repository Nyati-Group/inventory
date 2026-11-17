import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { rfqVendorByToken, portalState } from "@/lib/services/vendor-portal";
import { MAX_UPLOAD_BYTES, validateUpload, guessMime } from "@/lib/storage";
import { prefillQuotation } from "@/lib/quotation/prefill";
import { num } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Vendor portal: read an uploaded (or pasted) quotation and return suggested form values.
 * Nothing is saved — the vendor reviews the values and submits as usual.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!rateLimit(`prefill:ip:${ip}`, 20, 60_000) || !rateLimit(`prefill:tok:${params.token}`, 8, 60_000))
    return NextResponse.json({ error: "Too many requests — please wait a minute." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 512 * 1024) return NextResponse.json({ error: "File is larger than 10 MB." }, { status: 413 });

  const rv = await rfqVendorByToken(params.token);
  if (!rv || portalState(rv) !== "open") return NextResponse.json({ error: "This RFQ is not accepting quotations." }, { status: 400 });

  try {
    const fd = await req.formData();
    const f = fd.get("file");
    let file: { data: Buffer; mime: string } | undefined;
    if (f instanceof File && f.size) {
      const mime = f.type || guessMime(f.name);
      const err = validateUpload({ size: f.size, type: mime, name: f.name }, "quotation");
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      file = { data: Buffer.from(await f.arrayBuffer()), mime };
    }
    const text = String(fd.get("text") ?? "").slice(0, 50_000);
    if (!file && text.trim().length < 10) return NextResponse.json({ error: "Nothing to read." }, { status: 400 });

    const item = rv.rfq.items[0];
    const result = await prefillQuotation(
      {
        rfqNo: rv.rfq.number,
        material: item.material.name,
        spec: item.spec ?? item.material.spec,
        quantity: num(item.quantity),
        unit: item.unit,
        expectedDeliveryDate: rv.rfq.expectedDeliveryDate.toISOString(),
        deliveryAddress: rv.rfq.deliveryAddress,
      },
      { text, file },
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error("[prefill]", e);
    return NextResponse.json({ error: "Could not read the quotation — please type the key figures." }, { status: 500 });
  }
}
