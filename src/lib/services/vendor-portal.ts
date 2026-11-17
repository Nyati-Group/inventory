import { db } from "../db";
import { hashToken } from "../tokens";
import { saveFile, validateUpload, virusScan, guessMime } from "../storage";
import { nextQuotationRef } from "../numbering";
import { queueEmail } from "../email/service";
import { layout, kv, p } from "../email/templates";
import { audit } from "../audit";
import { notifyRoles } from "../notifications";
import { refreshRfqStatus } from "./rfq";
import { enqueueJob } from "../jobs";
import { processQuotationVersion, type VendorFields } from "../quotation/process";
import { fmtDateTime, inr } from "../utils";

export class PortalError extends Error {}

/** Resolve a vendor RFQ token. Returns null for unknown tokens (no enumeration detail). */
export async function rfqVendorByToken(token: string) {
  if (!token || token.length < 20) return null;
  return db.rFQVendor.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      vendor: true,
      rfq: { include: { project: true, items: { include: { material: true } } } },
      quotation: { include: { versions: { orderBy: { versionNo: "desc" }, include: { documents: true } } } },
    },
  });
}

export type PortalState = "open" | "expired" | "closed" | "declined";

export function portalState(rv: NonNullable<Awaited<ReturnType<typeof rfqVendorByToken>>>): PortalState {
  if (["CANCELLED", "AWAITING_APPROVAL", "APPROVED", "ORDERED"].includes(rv.rfq.status)) return "closed";
  if (rv.status === "DECLINED") return "declined";
  if (rv.deadline < new Date() || rv.tokenExpiresAt < new Date()) return "expired";
  return "open";
}

export async function recordOpen(rfqVendorId: string, ip: string | null, ua: string | null) {
  const rv = await db.rFQVendor.findUniqueOrThrow({ where: { id: rfqVendorId } });
  if (!rv.openedAt) {
    await db.rFQVendor.update({
      where: { id: rv.id },
      data: { openedAt: new Date(), openIp: ip, openUa: ua?.slice(0, 300), status: ["QUEUED", "SENT", "FAILED"].includes(rv.status) ? "OPENED" : rv.status },
    });
    await audit({ label: "vendor (portal)" }, "RFQVendor", rv.id, "PORTAL_OPENED", { ip });
  }
}

export interface SubmissionInput {
  method: "TEXT" | "PDF" | "DOCX" | "IMAGE" | "XLSX";
  text?: string;
  file?: { name: string; type: string; data: Buffer };
  fields: VendorFields;
}

export async function submitQuotation(token: string, input: SubmissionInput, ip: string | null, ua: string | null) {
  const rv = await rfqVendorByToken(token);
  if (!rv) throw new PortalError("This link is not valid.");
  const state = portalState(rv);
  if (state !== "open") throw new PortalError(state === "expired" ? "The quotation deadline has passed." : "This RFQ is no longer accepting quotations.");

  if (input.method === "TEXT" && (!input.text || input.text.trim().length < 10) && !input.fields.unitRate)
    throw new PortalError("Please type or paste your quotation, or fill in at least the unit rate.");
  if (input.method !== "TEXT" && !input.file) throw new PortalError("Please attach your quotation file.");
  let docKey: string | null = null;
  let mime = "";
  if (input.file) {
    mime = input.file.type || guessMime(input.file.name);
    const err = validateUpload({ size: input.file.data.length, type: mime, name: input.file.name }, "quotation");
    if (err) throw new PortalError(err);
    const virus = await virusScan(input.file.data);
    if (virus) throw new PortalError("The file failed a security scan.");
  }

  const quotation =
    rv.quotation ?? (await db.quotation.create({ data: { rfqVendorId: rv.id, rfqId: rv.rfqId, vendorId: rv.vendorId, referenceNo: await nextQuotationRef() } }));
  if (input.file) docKey = await saveFile(`quotations/${quotation.id}`, input.file.name, input.file.data, mime);
  const versionNo = (rv.quotation?.versions[0]?.versionNo ?? 0) + 1;
  const version = await db.quotationVersion.create({
    data: {
      quotationId: quotation.id,
      versionNo,
      method: input.method,
      rawText: input.method === "TEXT" ? input.text?.trim() || null : null,
      vendorFields: input.fields as never,
      remarks: input.fields.remarks ?? null,
      ip,
      userAgent: ua?.slice(0, 300),
      documents: docKey ? { create: { fileKey: docKey, fileName: input.file!.name, mimeType: mime, size: input.file!.data.length } } : undefined,
    },
  });
  await db.quotation.update({ where: { id: quotation.id }, data: { activeVersionId: version.id } });
  await db.rFQVendor.update({ where: { id: rv.id }, data: { status: "RESPONDED", respondedAt: rv.respondedAt ?? new Date(), openedAt: rv.openedAt ?? new Date() } });
  await refreshRfqStatus(rv.rfqId);
  await audit({ label: `vendor: ${rv.vendor.name}` }, "QuotationVersion", version.id, versionNo > 1 ? "REVISED" : "SUBMITTED", { after: { versionNo, method: input.method }, ip, projectId: rv.rfq.projectId });

  // Confirmation email with reference number
  if (rv.vendor.emails.length)
    await queueEmail({
      idempotencyKey: `qconfirm:${version.id}`,
      to: rv.vendor.emails,
      subject: `Quotation received — ${rv.rfq.number} (ref ${quotation.referenceNo} v${versionNo})`,
      html: layout(
        "Quotation received",
        `${p(`Dear ${rv.vendor.contactPerson || rv.vendor.name},`)}${p("Thank you. We have received your quotation. You can revise it using the same link until the deadline.")}${kv([
          ["Reference", `${quotation.referenceNo} (version ${versionNo})`],
          ["RFQ", rv.rfq.number],
          ["Material", rv.rfq.items[0].material.name],
          ["Unit rate (as typed)", input.fields.unitRate ? inr(input.fields.unitRate) : "As per attached document"],
          ["Received at", fmtDateTime(new Date())],
        ])}`,
      ),
      relatedType: "Quotation",
      relatedId: quotation.id,
      projectId: rv.rfq.projectId,
    });
  await notifyRoles(rv.rfq.projectId, ["PROCUREMENT_MANAGER"], {
    type: "QUOTATION",
    title: `${versionNo > 1 ? "Revised quotation" : "New quotation"} — ${rv.vendor.name}`,
    body: `${rv.rfq.number} · ${rv.rfq.items[0].material.name}`,
    link: `/rfqs/${rv.rfqId}?tab=quotations`,
  });

  // Parse now, before responding — serverless hosts (Vercel) may freeze the function once the response is sent,
  // so fire-and-forget work would never finish. The job runner retries if this fails.
  const job = await enqueueJob("PARSE_QUOTATION", { versionId: version.id }, { dedupeKey: `parse:${version.id}` });
  await processQuotationVersion(version.id)
    .then(() => db.job.update({ where: { id: job.id }, data: { status: "DONE", doneAt: new Date() } }))
    .catch((e) => console.error("[parse]", e));
  return { referenceNo: quotation.referenceNo, versionNo };
}

export async function declineRfq(token: string, reason: string, ip: string | null) {
  const rv = await rfqVendorByToken(token);
  if (!rv) throw new PortalError("This link is not valid.");
  if (portalState(rv) !== "open") throw new PortalError("This RFQ is no longer open.");
  if (!reason.trim()) throw new PortalError("Please select a reason.");
  await db.rFQVendor.update({ where: { id: rv.id }, data: { status: "DECLINED", declinedAt: new Date(), declineReason: reason.slice(0, 300) } });
  await refreshRfqStatus(rv.rfqId);
  await audit({ label: `vendor: ${rv.vendor.name}` }, "RFQVendor", rv.id, "DECLINED", { after: { reason }, ip, projectId: rv.rfq.projectId });
  await notifyRoles(rv.rfq.projectId, ["PROCUREMENT_MANAGER"], { type: "QUOTATION_DECLINED", title: `${rv.vendor.name} declined ${rv.rfq.number}`, body: reason, link: `/rfqs/${rv.rfqId}` });
}
