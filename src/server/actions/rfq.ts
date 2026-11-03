"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, getUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { audit } from "@/lib/audit";
import { emailRfqVendor, refreshRfqStatus, regenerateRfqVendorLink } from "@/lib/services/rfq";
import { rfqLinkExpiry } from "@/lib/vendor-links";
import { recomputeComparison } from "@/lib/services/comparison";
import { computeLanded } from "@/lib/engine/landed-cost";
import { creditDaysFrom } from "@/lib/quotation/process";
import { requestApproval, decideApprovalRequest } from "@/lib/services/approval";
import { enqueueJob } from "@/lib/jobs";
import { run } from "../action-result";

async function rfqFor(rfqId: string, userId: { id: string; role: string; name: string; email: string }) {
  const rfq = await db.rFQ.findUniqueOrThrow({ where: { id: rfqId } });
  await assertProjectAccess(userId as never, rfq.projectId);
  return rfq;
}

export async function resendRfqEmail(rfqVendorId: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const rv = await db.rFQVendor.findUniqueOrThrow({ where: { id: rfqVendorId } });
    await rfqFor(rv.rfqId, user);
    await db.rFQVendor.update({ where: { id: rv.id }, data: { status: rv.status === "FAILED" ? "QUEUED" : rv.status } });
    await emailRfqVendor(rv.id, "invite", undefined, { discriminator: `resend-${Date.now()}` });
    await audit(user, "RFQVendor", rv.id, "RESENT", { projectId: undefined });
    revalidatePath(`/rfqs/${rv.rfqId}`);
    return undefined;
  });
}

/** New link for one vendor; the old one stops working at once. */
export async function regenerateVendorLink(rfqVendorId: string, resend: boolean) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const rv = await db.rFQVendor.findUniqueOrThrow({ where: { id: rfqVendorId } });
    await rfqFor(rv.rfqId, user);
    const link = await regenerateRfqVendorLink(rv.id, user, resend);
    revalidatePath(`/rfqs/${rv.rfqId}`);
    return { link };
  });
}

export async function extendDeadline(rfqId: string, deadlineIso: string, rfqVendorIds?: string[]) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const rfq = await rfqFor(rfqId, user);
    const deadline = new Date(deadlineIso);
    if (!(deadline > new Date())) throw new Error("New deadline must be in the future");
    if (["AWAITING_APPROVAL", "APPROVED", "ORDERED", "CANCELLED"].includes(rfq.status)) throw new Error(`Cannot extend an RFQ that is ${rfq.status.toLowerCase().replace("_", " ")}`);
    const targets = await db.rFQVendor.findMany({
      where: { rfqId, ...(rfqVendorIds?.length ? { id: { in: rfqVendorIds } } : {}), status: { notIn: ["DECLINED"] } },
    });
    for (const rv of targets) {
      await db.rFQVendor.update({
        where: { id: rv.id },
        data: { deadline, tokenExpiresAt: rfqLinkExpiry(deadline), remindersSent: 0, status: rv.status === "NO_RESPONSE" ? "SENT" : rv.status },
      });
      await emailRfqVendor(rv.id, "extension", undefined, { discriminator: deadline.toISOString() });
    }
    const latest = rfqVendorIds?.length ? rfq.deadline > deadline ? rfq.deadline : deadline : deadline;
    await db.rFQ.update({ where: { id: rfqId }, data: { deadline: latest, status: rfq.status === "CLOSED" ? "PARTIALLY_RESPONDED" : rfq.status, closedAt: null } });
    await refreshRfqStatus(rfqId);
    await audit(user, "RFQ", rfqId, "DEADLINE_EXTENDED", { before: { deadline: rfq.deadline }, after: { deadline, vendors: targets.length }, projectId: rfq.projectId });
    revalidatePath(`/rfqs/${rfqId}`);
    return { count: targets.length };
  });
}

export async function sendNegotiation(rfqVendorId: string, message: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    if (message.trim().length < 5) throw new Error("Write a short message to the vendor");
    const rv = await db.rFQVendor.findUniqueOrThrow({ where: { id: rfqVendorId } });
    const rfq = await rfqFor(rv.rfqId, user);
    if (rv.deadline < new Date()) {
      // reopen this vendor's link for 48 h so they can revise
      const d = new Date(Date.now() + 48 * 3600_000);
      await db.rFQVendor.update({ where: { id: rv.id }, data: { deadline: d, tokenExpiresAt: rfqLinkExpiry(d) } });
    }
    await emailRfqVendor(rv.id, "negotiation", undefined, { message, discriminator: String(Date.now()) });
    await audit(user, "RFQVendor", rv.id, "NEGOTIATION_SENT", { after: { message }, projectId: rfq.projectId });
    revalidatePath(`/rfqs/${rv.rfqId}`);
    return undefined;
  });
}

export async function cancelRfq(rfqId: string, reason: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const rfq = await rfqFor(rfqId, user);
    if (reason.trim().length < 3) throw new Error("Reason is required");
    if (rfq.status === "ORDERED") throw new Error("RFQ already converted to a purchase order");
    await db.rFQ.update({ where: { id: rfqId }, data: { status: "CANCELLED", closedAt: new Date() } });
    await db.approvalRequest.updateMany({ where: { rfqId, status: "PENDING" }, data: { status: "CANCELLED" } });
    await audit(user, "RFQ", rfqId, "CANCELLED", { before: { status: rfq.status }, after: { reason }, projectId: rfq.projectId });
    revalidatePath(`/rfqs/${rfqId}`);
    return undefined;
  });
}

export async function reparseQuotation(versionId: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const v = await db.quotationVersion.findUniqueOrThrow({ where: { id: versionId }, include: { quotation: true } });
    await rfqFor(v.quotation.rfqId, user);
    await db.quotationVersion.update({ where: { id: versionId }, data: { parseStatus: "PENDING" } });
    const { processQuotationVersion } = await import("@/lib/quotation/process");
    await processQuotationVersion(versionId);
    revalidatePath(`/rfqs/${v.quotation.rfqId}`);
    return undefined;
  });
}

const Review = z.object({
  versionId: z.string(),
  unitRate: z.number().positive(),
  quantity: z.number().positive(),
  gstPercent: z.number().min(0).max(28),
  freight: z.number().min(0),
  loading: z.number().min(0),
  otherCharges: z.number().min(0),
  statedTotal: z.number().min(0).nullable(),
  deliveryDate: z.string().nullable(),
  deliveryDays: z.number().int().min(0).nullable(),
  paymentTerms: z.string().nullable(),
  validityDays: z.number().int().min(0).nullable(),
  warranty: z.string().nullable(),
  deviations: z.array(z.string()),
});

/** Buyer confirms/corrects extracted values (side-by-side review). Corrections are saved and audited. */
export async function confirmQuotationReview(input: z.infer<typeof Review>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = Review.parse(input);
    const v = await db.quotationVersion.findUniqueOrThrow({ where: { id: d.versionId }, include: { quotation: true } });
    await rfqFor(v.quotation.rfqId, user);
    const landed = computeLanded({ items: [{ quantity: d.quantity, unitRate: d.unitRate, gstPercent: d.gstPercent }], freight: d.freight, loading: d.loading, other: d.otherCharges, statedTotal: d.statedTotal });
    const deliveryDate = d.deliveryDate ? new Date(d.deliveryDate) : d.deliveryDays ? new Date(v.submittedAt.getTime() + d.deliveryDays * 86_400_000) : null;
    const after = {
      unitRate: d.unitRate,
      quantity: d.quantity,
      gstPercent: d.gstPercent,
      freight: d.freight,
      loading: d.loading,
      otherCharges: d.otherCharges,
      statedTotal: d.statedTotal,
      subtotal: landed.subtotal,
      gstTotal: landed.gstTotal,
      landedCost: landed.landedCost,
      totalMismatch: landed.mismatch,
      deliveryDate,
      deliveryDays: d.deliveryDays,
      paymentTerms: d.paymentTerms,
      creditDays: creditDaysFrom(d.paymentTerms),
      validityDays: d.validityDays,
      warranty: d.warranty,
      deviations: d.deviations.filter((x) => x.trim()),
      parseStatus: "CONFIRMED" as const,
      reviewedById: user.id,
      reviewedAt: new Date(),
    };
    await db.quotationVersion.update({ where: { id: v.id }, data: after });
    await audit(user, "QuotationVersion", v.id, "REVIEW_CONFIRMED", {
      before: { unitRate: v.unitRate, quantity: v.quantity, gstPercent: v.gstPercent, freight: v.freight, landedCost: v.landedCost, deliveryDate: v.deliveryDate },
      after,
    });
    await recomputeComparison(v.quotation.rfqId);
    revalidatePath(`/rfqs/${v.quotation.rfqId}`);
    return { landedCost: landed.landedCost, mismatch: landed.mismatch };
  });
}

/** Buyer records a quotation received outside the portal (e.g. by email/phone) on the vendor's behalf. */
export async function enterQuotationForVendor(fd: FormData) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const rfqVendorId = String(fd.get("rfqVendorId"));
    const text = String(fd.get("text") ?? "").trim();
    if (text.length < 10) throw new Error("Paste the quotation text");
    const rv = await db.rFQVendor.findUniqueOrThrow({ where: { id: rfqVendorId } });
    await rfqFor(rv.rfqId, user);
    const { nextQuotationRef } = await import("@/lib/numbering");
    const q = (await db.quotation.findUnique({ where: { rfqVendorId } })) ?? (await db.quotation.create({ data: { rfqVendorId, rfqId: rv.rfqId, vendorId: rv.vendorId, referenceNo: await nextQuotationRef() } }));
    const last = await db.quotationVersion.findFirst({ where: { quotationId: q.id }, orderBy: { versionNo: "desc" } });
    const ver = await db.quotationVersion.create({ data: { quotationId: q.id, versionNo: (last?.versionNo ?? 0) + 1, method: "TEXT", rawText: text, source: "BUYER_ENTRY" } });
    await db.quotation.update({ where: { id: q.id }, data: { activeVersionId: ver.id } });
    await db.rFQVendor.update({ where: { id: rv.id }, data: { status: "RESPONDED", respondedAt: rv.respondedAt ?? new Date() } });
    await refreshRfqStatus(rv.rfqId);
    await enqueueJob("PARSE_QUOTATION", { versionId: ver.id });
    const { processQuotationVersion } = await import("@/lib/quotation/process");
    await processQuotationVersion(ver.id).catch(() => undefined);
    await audit(user, "Quotation", q.id, "ENTERED_BY_BUYER", { after: { versionNo: ver.versionNo } });
    revalidatePath(`/rfqs/${rv.rfqId}`);
    return undefined;
  });
}

// ─────────────────────────── Approval ───────────────────────────

const SendApproval = z.object({
  rfqId: z.string(),
  selectedVendorId: z.string().optional(),
  overrideReason: z.string().optional(),
  split: z.array(z.object({ vendorId: z.string(), quantity: z.number().positive() })).optional(),
  note: z.string().optional(),
});

export async function sendForApproval(input: z.infer<typeof SendApproval>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = SendApproval.parse(input);
    await rfqFor(d.rfqId, user);
    const req = await requestApproval(d, user);
    revalidatePath(`/rfqs/${d.rfqId}`);
    return { id: req.id };
  });
}

const Decision = z.object({
  requestId: z.string(),
  decision: z.enum(["APPROVE", "CHOOSE_OTHER", "REJECT", "RE_RFQ"]),
  vendorId: z.string().optional(),
  comment: z.string().optional(),
});

export async function decideApproval(input: z.infer<typeof Decision>) {
  return run(async () => {
    const user = await requireRole("APPROVER");
    const d = Decision.parse(input);
    const req = await db.approvalRequest.findUniqueOrThrow({ where: { id: d.requestId } });
    await assertProjectAccess(user, req.projectId);
    const r = await decideApprovalRequest(d, user);
    revalidatePath(`/rfqs/${req.rfqId}`);
    revalidatePath("/purchase-orders");
    return r;
  });
}

export async function recomputeNow(rfqId: string) {
  return run(async () => {
    const user = await getUser();
    if (!user) throw new Error("Not signed in");
    await rfqFor(rfqId, user);
    await recomputeComparison(rfqId);
    revalidatePath(`/rfqs/${rfqId}`);
    return undefined;
  });
}
