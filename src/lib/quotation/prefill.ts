import { convertQty, convertRate } from "../engine/units";
import { extractText } from "./extract-text";
import { heuristicExtract, llmExtract, llmAvailable, type Extraction, type RfqContext } from "./extract";
import type { VendorFields } from "./process";

export interface PrefillResult {
  fields: VendorFields;
  confidence: number;
  method: "ai" | "rules" | "none";
  notes: string[];
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const pos = (n: number | undefined) => (typeof n === "number" && n > 0 ? n : null);

/**
 * Read a quotation the vendor is about to submit and suggest values for the portal form.
 * Nothing is stored — the vendor checks/edits the values before submitting.
 */
export async function prefillQuotation(ctx: RfqContext, source: { text?: string; file?: { data: Buffer; mime: string } }): Promise<PrefillResult> {
  const notes: string[] = [];
  let text = source.text?.trim() ?? "";
  let pdf: Buffer | undefined;
  let image: { data: Buffer; mime: "image/png" | "image/jpeg" } | undefined;

  if (source.file) {
    const t = await extractText(source.file.data, source.file.mime);
    text = t.text;
    if (!text && source.file.mime === "application/pdf") pdf = source.file.data;
    if (!text && (source.file.mime === "image/png" || source.file.mime === "image/jpeg")) image = { data: source.file.data, mime: source.file.mime };
  }

  let ex: Extraction | null = null;
  let method: PrefillResult["method"] = "none";
  if (llmAvailable() && (text || pdf || image)) {
    try {
      ex = await llmExtract(ctx, { text: text || undefined, pdf, image });
      method = "ai";
    } catch {
      notes.push("The AI reader is busy right now — filled what we could with basic matching.");
    }
  }
  if (!ex && text) {
    ex = heuristicExtract(text, ctx);
    method = "rules";
  }
  if (!ex) {
    notes.push(pdf || image ? "We couldn't read this scanned file automatically — please type the key figures." : "No readable text found — please type the key figures.");
    return { fields: {}, confidence: 0, method: "none", notes };
  }

  // Line matching the requested material (first line otherwise), converted to the RFQ unit.
  const line = ex.items.find((i) => i.description.toLowerCase().includes(ctx.material.toLowerCase().split(" ")[0])) ?? ex.items[0];
  let unitRate = pos(line?.unit_rate);
  let quantity = pos(line?.quantity);
  if (line && unitRate && line.unit) {
    const r = convertRate(unitRate, line.unit, ctx.unit);
    if (r !== null && Math.abs(r - unitRate) > 1e-9) {
      notes.push(`Rate converted from ₹/${line.unit} to ₹/${ctx.unit}.`);
      unitRate = round(r);
      if (quantity) quantity = round(convertQty(quantity, line.unit, ctx.unit) ?? quantity, 3);
    } else if (r === null) {
      notes.push(`Your quotation uses "${line.unit}" but we asked for "${ctx.unit}" — please check the unit rate.`);
    }
  }
  if (ex.items.length > 1) notes.push(`Your quotation has ${ex.items.length} lines — we used "${line.description || "line 1"}".`);

  const date = ex.delivery_date && !Number.isNaN(Date.parse(ex.delivery_date)) ? ex.delivery_date.slice(0, 10) : null;
  const fields: VendorFields = {
    unitRate,
    quantity,
    gstPercent: pos(line?.gst_percent),
    freight: pos(ex.freight),
    loading: pos(ex.loading_charges),
    total: pos(ex.grand_total),
    deliveryDays: pos(ex.delivery_days),
    deliveryDate: date,
    validityDays: pos(ex.validity_days),
    paymentTerms: ex.payment_terms.trim() || null,
    warranty: ex.warranty.trim() || null,
    remarks: ex.deviations_or_exclusions.trim() || null,
  };
  return { fields, confidence: ex.confidence, method, notes };
}
