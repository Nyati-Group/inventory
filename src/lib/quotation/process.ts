import { db } from "../db";
import { storage } from "../storage";
import { num } from "../utils";
import { computeLanded } from "../engine/landed-cost";
import { convertQty, convertRate, canonicalUnit } from "../engine/units";
import { extractText } from "./extract-text";
import { heuristicExtract, llmExtract, llmAvailable, type Extraction, type RfqContext } from "./extract";
import { recomputeComparison } from "../services/comparison";
import { notifyRoles } from "../notifications";

export interface VendorFields {
  unitRate?: number | null;
  gstPercent?: number | null;
  freight?: number | null;
  loading?: number | null;
  total?: number | null;
  deliveryDays?: number | null;
  deliveryDate?: string | null;
  paymentTerms?: string | null;
  validityDays?: number | null;
  warranty?: string | null;
  remarks?: string | null;
  quantity?: number | null;
}

export function creditDaysFrom(terms: string | null | undefined) {
  if (!terms) return 0;
  if (/advance|against\s*delivery|immediate|cod|cash/i.test(terms) && !/\d+\s*days/i.test(terms)) return 0;
  const m = terms.match(/(\d+)\s*days?/i);
  return m ? Number(m[1]) : 0;
}

/** Run extraction for a quotation version and store normalised values. Never throws — failures mark it for review. */
export async function processQuotationVersion(versionId: string) {
  const v = await db.quotationVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      documents: true,
      quotation: { include: { rfq: { include: { items: { include: { material: true } } } }, vendor: true } },
    },
  });
  const rfq = v.quotation.rfq;
  const item = rfq.items[0];
  const ctx: RfqContext = {
    rfqNo: rfq.number,
    material: item.material.name,
    spec: item.spec ?? item.material.spec,
    quantity: num(item.quantity),
    unit: item.unit,
    expectedDeliveryDate: rfq.expectedDeliveryDate.toISOString(),
    deliveryAddress: rfq.deliveryAddress,
  };

  const notes: string[] = [];
  let extraction: Extraction | null = null;
  let rawText = v.rawText ?? "";

  try {
    const doc = v.documents[0];
    let pdf: Buffer | undefined;
    let image: { data: Buffer; mime: "image/png" | "image/jpeg" } | undefined;
    if (doc && !rawText) {
      const buf = await storage.get(doc.fileKey);
      const t = await extractText(buf, doc.mimeType);
      rawText = t.text;
      if (t.note) notes.push(t.note);
      if (!rawText && doc.mimeType === "application/pdf") pdf = buf;
      if (!rawText && (doc.mimeType === "image/png" || doc.mimeType === "image/jpeg")) image = { data: buf, mime: doc.mimeType };
    }
    if (llmAvailable() && (rawText || pdf || image)) {
      try {
        extraction = await llmExtract(ctx, { text: rawText || undefined, pdf, image });
      } catch (e) {
        notes.push(`LLM extraction failed (${(e as Error).message}); used rule-based fallback.`);
      }
    } else if (!llmAvailable()) {
      notes.push("GEMINI_API_KEY not set — rule-based extraction used.");
    }
    if (!extraction && rawText) extraction = heuristicExtract(rawText, ctx);
  } catch (e) {
    notes.push(`Text extraction failed: ${(e as Error).message}`);
  }

  const vf = (v.vendorFields ?? {}) as VendorFields;
  const n = normalise(extraction, vf, ctx, v.submittedAt, notes);
  const needsReview = n.confidence < 0.7 || n.unitRate === null || n.landedCost === null || n.totalMismatch;

  await db.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { versionId } });
    await tx.quotationVersion.update({
      where: { id: versionId },
      data: {
        rawText: rawText || v.rawText,
        extracted: (extraction ?? undefined) as never,
        confidence: n.confidence,
        parseStatus: needsReview ? "NEEDS_REVIEW" : "PARSED",
        parseNotes: notes.join(" ") || null,
        unitRate: n.unitRate,
        quantity: n.quantity,
        unit: ctx.unit,
        gstPercent: n.gstPercent,
        freight: n.freight,
        loading: n.loading,
        otherCharges: n.other,
        subtotal: n.subtotal,
        gstTotal: n.gstTotal,
        statedTotal: n.statedTotal,
        landedCost: n.landedCost,
        totalMismatch: n.totalMismatch,
        deliveryDays: n.deliveryDays,
        deliveryDate: n.deliveryDate,
        paymentTerms: n.paymentTerms,
        creditDays: n.creditDays,
        validityDays: n.validityDays,
        warranty: n.warranty,
        deviations: n.deviations,
        items: {
          create: (extraction?.items ?? []).map((it) => ({
            description: it.description || ctx.material,
            unit: it.unit,
            quantity: it.quantity,
            unitRate: it.unit_rate,
            gstPercent: it.gst_percent,
            amount: it.amount || it.quantity * it.unit_rate,
          })),
        },
      },
    });
  });

  if (needsReview)
    await notifyRoles(rfq.projectId, ["PROCUREMENT_MANAGER"], {
      type: "QUOTATION_REVIEW",
      title: `Quotation needs review — ${v.quotation.vendor.name}`,
      body: `${rfq.number}: ${notes[0] ?? "low extraction confidence"}`,
      link: `/rfqs/${rfq.id}/review/${versionId}`,
    });
  await recomputeComparison(rfq.id);
}

interface Normalised {
  unitRate: number | null;
  quantity: number | null;
  gstPercent: number | null;
  freight: number;
  loading: number;
  other: number;
  subtotal: number | null;
  gstTotal: number | null;
  statedTotal: number | null;
  landedCost: number | null;
  totalMismatch: boolean;
  deliveryDays: number | null;
  deliveryDate: Date | null;
  paymentTerms: string | null;
  creditDays: number;
  validityDays: number | null;
  warranty: string | null;
  deviations: string[];
  confidence: number;
}

/** Merge LLM/heuristic extraction with vendor-typed fields, convert units, compute landed cost, flag deviations. */
export function normalise(ex: Extraction | null, vf: VendorFields, ctx: RfqContext, submittedAt: Date, notes: string[]): Normalised {
  let confidence = ex?.confidence ?? 0;
  const line = ex?.items?.[0];
  let unitRate: number | null = line?.unit_rate || null;
  let quantity: number | null = line?.quantity || null;
  const lineUnit = line?.unit || ctx.unit;
  const deviations: string[] = [];

  if (unitRate && lineUnit && canonicalUnit(lineUnit) && canonicalUnit(ctx.unit) && canonicalUnit(lineUnit) !== canonicalUnit(ctx.unit)) {
    const r = convertRate(unitRate, lineUnit, ctx.unit);
    const q = quantity ? convertQty(quantity, lineUnit, ctx.unit) : null;
    if (r !== null) {
      notes.push(`Converted rate from ₹/${lineUnit} to ₹/${ctx.unit}.`);
      unitRate = Math.round(r * 100) / 100;
      quantity = q !== null ? Math.round(q * 1000) / 1000 : quantity;
    } else {
      deviations.push(`Quoted in a different unit (${lineUnit}) than requested (${ctx.unit})`);
    }
  }

  // Cross-check with structured fields the vendor typed in the portal
  if (vf.unitRate) {
    if (unitRate && Math.abs(unitRate - vf.unitRate) / vf.unitRate > 0.01) {
      notes.push(`Typed unit rate ₹${vf.unitRate} differs from document (₹${unitRate}).`);
      confidence = Math.min(confidence, 0.6);
    }
    if (!unitRate) {
      unitRate = vf.unitRate;
      confidence = Math.max(confidence, 0.75);
    }
  }
  if (!quantity) quantity = vf.quantity || ctx.quantity;
  const gstPercent = line?.gst_percent || vf.gstPercent || null;
  const freight = ex?.freight || vf.freight || 0;
  const loading = ex?.loading_charges || vf.loading || 0;
  const other = ex?.other_charges || 0;
  const statedTotal = ex?.grand_total || vf.total || null;

  const landed =
    unitRate !== null
      ? computeLanded({ items: [{ quantity: quantity!, unitRate, gstPercent: gstPercent ?? 18 }], freight, loading, other, statedTotal })
      : null;
  if (gstPercent === null && unitRate !== null) notes.push("GST % not stated — 18% assumed for landed cost.");
  if (landed?.mismatch) notes.push(`Stated total differs from recomputed landed cost by ₹${landed.mismatchAmount}.`);

  const deliveryDays = ex?.delivery_days || vf.deliveryDays || null;
  let deliveryDate: Date | null = null;
  const dd = ex?.delivery_date || vf.deliveryDate;
  if (dd && !Number.isNaN(Date.parse(dd))) deliveryDate = new Date(dd);
  else if (deliveryDays) deliveryDate = new Date(submittedAt.getTime() + deliveryDays * 86_400_000);

  if (quantity !== null && quantity + 1e-9 < ctx.quantity) deviations.push(`Partial quantity: ${quantity} of ${ctx.quantity} ${ctx.unit}`);
  if (deliveryDate) {
    const late = Math.ceil((deliveryDate.getTime() - new Date(ctx.expectedDeliveryDate).getTime()) / 86_400_000);
    if (late > 0) deviations.push(`Late delivery by ${late} day${late === 1 ? "" : "s"}`);
  }
  if (ex?.deviations_or_exclusions?.trim()) deviations.push(ex.deviations_or_exclusions.trim());
  if (ex?.extraction_notes) notes.push(ex.extraction_notes);

  const paymentTerms = ex?.payment_terms || vf.paymentTerms || null;
  return {
    unitRate,
    quantity,
    gstPercent,
    freight,
    loading,
    other,
    subtotal: landed?.subtotal ?? null,
    gstTotal: landed?.gstTotal ?? null,
    statedTotal,
    landedCost: landed?.landedCost ?? null,
    totalMismatch: landed?.mismatch ?? false,
    deliveryDays,
    deliveryDate,
    paymentTerms,
    creditDays: creditDaysFrom(paymentTerms),
    validityDays: ex?.validity_days || vf.validityDays || null,
    warranty: ex?.warranty || vf.warranty || null,
    deviations,
    confidence,
  };
}
