import { z } from "zod";
import { llmAvailable, llmJson, type LlmPart } from "../llm";

/** The strict extraction contract (§7). */
export const ExtractionSchema = z.object({
  vendor_name: z.string(),
  quotation_no: z.string(),
  date: z.string(),
  items: z.array(
    z.object({
      description: z.string(),
      unit: z.string(),
      quantity: z.number(),
      unit_rate: z.number(),
      gst_percent: z.number(),
      amount: z.number(),
    }),
  ),
  freight: z.number(),
  loading_charges: z.number(),
  other_charges: z.number(),
  subtotal: z.number(),
  gst_total: z.number(),
  grand_total: z.number(),
  delivery_days: z.number(),
  delivery_date: z.string(),
  payment_terms: z.string(),
  validity_days: z.number(),
  warranty: z.string(),
  incoterms_or_delivery_basis: z.string(),
  deviations_or_exclusions: z.string(),
  confidence: z.number().min(0).max(1),
  extraction_notes: z.string(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const str = { type: "string" };
const numT = { type: "number" };
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor_name: str,
    quotation_no: str,
    date: str,
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { description: str, unit: str, quantity: numT, unit_rate: numT, gst_percent: numT, amount: numT },
        required: ["description", "unit", "quantity", "unit_rate", "gst_percent", "amount"],
      },
    },
    freight: numT,
    loading_charges: numT,
    other_charges: numT,
    subtotal: numT,
    gst_total: numT,
    grand_total: numT,
    delivery_days: numT,
    delivery_date: str,
    payment_terms: str,
    validity_days: numT,
    warranty: str,
    incoterms_or_delivery_basis: str,
    deviations_or_exclusions: str,
    confidence: numT,
    extraction_notes: str,
  },
  required: [
    "vendor_name", "quotation_no", "date", "items", "freight", "loading_charges", "other_charges", "subtotal",
    "gst_total", "grand_total", "delivery_days", "delivery_date", "payment_terms", "validity_days", "warranty",
    "incoterms_or_delivery_basis", "deviations_or_exclusions", "confidence", "extraction_notes",
  ],
};

export interface RfqContext {
  rfqNo: string;
  material: string;
  spec: string | null;
  quantity: number;
  unit: string;
  expectedDeliveryDate: string;
  deliveryAddress: string;
}

const SYSTEM = `You extract supplier quotations for a construction company's procurement team in India.
Read the quotation and return the JSON fields exactly as quoted by the vendor. Rules:
- Amounts are in INR; strip currency symbols and thousands separators ("1,23,450.00" → 123450).
- Use 0 for a numeric field that is not stated, and "" for a text field that is not stated. Never invent values.
- items: one entry per quoted line. unit_rate is the pre-tax rate per unit. amount = quantity × unit_rate as written.
- delivery_days: days from order to delivery if stated; delivery_date: ISO date (YYYY-MM-DD) if a date is stated.
- deviations_or_exclusions: anything that differs from the RFQ (partial quantity, different brand/grade, excluded unloading, price escalation clauses, etc.).
- confidence: 0–1, your confidence that the key commercial fields (rate, quantity, taxes, total, delivery) are correct.
- extraction_notes: brief notes on ambiguities or assumptions.`;

export async function llmExtract(
  ctx: RfqContext,
  source: { text?: string; pdf?: Buffer; image?: { data: Buffer; mime: "image/png" | "image/jpeg" } },
): Promise<Extraction> {
  // Scanned PDFs and photos are sent inline — Gemini reads them natively (no separate OCR step).
  const parts: LlmPart[] = [];
  if (source.pdf) parts.push({ inlineData: { mimeType: "application/pdf", data: source.pdf.toString("base64") } });
  if (source.image) parts.push({ inlineData: { mimeType: source.image.mime, data: source.image.data.toString("base64") } });
  const rfq = `RFQ ${ctx.rfqNo}: ${ctx.quantity} ${ctx.unit} of "${ctx.material}"${ctx.spec ? ` (spec: ${ctx.spec})` : ""}, required by ${ctx.expectedDeliveryDate.slice(0, 10)} at ${ctx.deliveryAddress}.`;
  parts.push({
    text: `${rfq}\n\nExtract the vendor's quotation${source.text ? ` below:\n\n<quotation>\n${source.text}\n</quotation>` : " from the attached document."}`,
  });
  return llmJson({ system: SYSTEM, parts, schema: JSON_SCHEMA, validate: ExtractionSchema });
}

// ─────────── Rule-based fallback (no API key / API failure) ───────────

const NUM = String.raw`(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)`;
const toNum = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : 0);

function find(text: string, re: RegExp) {
  const m = text.match(re);
  return m ? toNum(m[1]) : 0;
}

function lineWith(text: string, re: RegExp) {
  const line = text.split(/\r?\n/).find((l) => re.test(l));
  return line ? line.replace(re, "").replace(/^[\s:\-–]+/, "").trim() : "";
}

export function heuristicExtract(text: string, ctx: RfqContext): Extraction {
  const t = text.replace(/\u00a0/g, " ");
  const unitRate = find(t, new RegExp(String.raw`(?:unit\s*rate|rate\s*per\s*\w+|rate)\s*(?:\(.*?\))?\s*[:=\-]?\s*${NUM}`, "i"));
  const qtyMatch = t.match(/(?:qty|quantity)\s*[:=\-]?\s*([\d,]+(?:\.\d+)?)\s*([a-zA-Z³.]+)?/i);
  const quantity = qtyMatch ? toNum(qtyMatch[1]) : 0;
  const unit = qtyMatch?.[2] ?? ctx.unit;
  const gst = find(t, /gst\s*(?:@|at)?\s*[:=\-]?\s*(\d{1,2}(?:\.\d+)?)\s*%/i);
  const freight = find(t, new RegExp(String.raw`(?:freight|transport(?:ation)?)\s*(?:charges?)?\s*[:=\-]?\s*${NUM}`, "i"));
  const loading = find(t, new RegExp(String.raw`(?:loading|unloading)\s*(?:charges?)?\s*[:=\-]?\s*${NUM}`, "i"));
  const totals = [...t.matchAll(new RegExp(String.raw`(?:grand\s*total|total\s*amount|net\s*amount|total)\s*(?:\(.*?\))?\s*[:=\-]?\s*${NUM}`, "gi"))];
  const grandTotal = totals.length ? toNum(totals[totals.length - 1][1]) : 0;
  const deliveryDays =
    find(t, /deliver(?:y|ed)?[^.\n]*?within\s*(\d+)\s*(?:working\s*)?days?/i) ||
    find(t, /deliver(?:y|ed)?\s*(?:period|time|in)?\s*[:=\-]?\s*(\d+)\s*(?:working\s*)?days?/i);
  const validity = find(t, /valid(?:ity)?[^\d\n]*(\d+)\s*days/i);
  const quoteNo = t.match(/(?:quotation|quote|ref(?:erence)?)\s*(?:no\.?|#|number)\s*[:\-]?\s*([\w\-\/]+)/i)?.[1] ?? "";
  const payment = lineWith(t, /payment\s*(?:terms?)?\s*[:\-]?/i);
  const warranty = lineWith(t, /warranty\s*[:\-]?/i);
  const deviations = lineWith(t, /(?:exclusions?|deviations?|note)\s*[:\-]/i);

  const q = quantity || ctx.quantity;
  const subtotal = unitRate * q;
  const gstTotal = (subtotal * gst) / 100;
  const found = [unitRate > 0, quantity > 0, gst > 0, grandTotal > 0, deliveryDays > 0].filter(Boolean).length;
  const reconciles = grandTotal > 0 && Math.abs(subtotal + gstTotal + freight + loading - grandTotal) <= Math.max(10, grandTotal * 0.005);
  const confidence = Math.min(0.75, found * 0.12 + (reconciles ? 0.2 : 0));

  return {
    vendor_name: "",
    quotation_no: quoteNo,
    date: "",
    items: unitRate > 0 ? [{ description: ctx.material, unit, quantity: q, unit_rate: unitRate, gst_percent: gst, amount: subtotal }] : [],
    freight,
    loading_charges: loading,
    other_charges: 0,
    subtotal,
    gst_total: gstTotal,
    grand_total: grandTotal,
    delivery_days: deliveryDays,
    delivery_date: "",
    payment_terms: payment,
    validity_days: validity,
    warranty,
    incoterms_or_delivery_basis: "",
    deviations_or_exclusions: deviations,
    confidence,
    extraction_notes: `Rule-based extraction (no LLM). Found ${found}/5 key fields${reconciles ? "; totals reconcile" : ""}.`,
  };
}

export { llmAvailable };
