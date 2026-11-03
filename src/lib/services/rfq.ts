import type { RFQ, RFQVendor, Vendor, Project, RFQItem, Material } from "@prisma/client";
import { db, notDeleted } from "../db";
import { num, numOrNull, fmtDate, fmtDateTime, qty as fmtQty } from "../utils";
import { newToken, hashToken, encrypt, decrypt } from "../tokens";
import { rfqVendorLink, rfqLinkExpiry } from "../vendor-links";
import { storage, saveFile } from "../storage";
import { queueEmail, type EmailAttachment } from "../email/service";
import { layout, button, kv, p } from "../email/templates";
import { renderRfqPdf, fillDocxTemplate, type RfqDocData } from "../pdf";
import { getSettings } from "../settings";
import { vendorFitScore } from "../engine/scoring";
import { estimatedDeliveryDays } from "../engine/geo";
import { nextRfqNumber } from "../numbering";
import { audit } from "../audit";
import { vendorOnTimePct } from "./comparison";
import type { SessionUser } from "../auth";

/** Vendors in the project's vendor book that supply this material or its category, best fit first (§4.2 step 2). */
export async function vendorCandidates(projectId: string, materialId: string, expectedDate: Date) {
  const material = await db.material.findUniqueOrThrow({ where: { id: materialId } });
  const pvs = await db.projectVendor.findMany({
    where: {
      projectId,
      vendor: {
        deletedAt: notDeleted,
        OR: [{ materials: { some: { materialId } } }, { categories: { some: { categoryId: material.categoryId } } }],
      },
    },
    include: { vendor: { include: { materials: { where: { materialId } } } } },
  });
  const onTime = await vendorOnTimePct(pvs.map((p) => p.vendorId));
  const daysUntilNeed = Math.max(0, Math.ceil((expectedDate.getTime() - Date.now()) / 86_400_000));
  return pvs
    .map((pv) => {
      const v = pv.vendor;
      const rating = pv.ratedOrders >= 3 && pv.rating !== null ? num(pv.rating) : numOrNull(v.overallRating);
      const blacklisted = v.status === "BLACKLISTED" || pv.isBlacklisted;
      const withinRadius = pv.distanceKm === null || pv.distanceKm <= v.serviceRadiusKm;
      const etaDays = estimatedDeliveryDays(v.leadTimeDays, pv.transitHours);
      return {
        vendorId: v.id,
        name: v.name,
        city: v.city,
        emails: v.emails,
        status: blacklisted ? ("BLACKLISTED" as const) : v.status,
        distanceKm: pv.distanceKm,
        transitHours: pv.transitHours,
        etaDays,
        canMeetDate: etaDays <= daysUntilNeed,
        withinRadius,
        serviceRadiusKm: v.serviceRadiusKm,
        rating,
        completedOrders: v.completedOrders,
        isNew: v.completedOrders < 3 || rating === null,
        onTimePct: onTime(v.id),
        lastRate: numOrNull(v.materials[0]?.lastRate),
        preferred: v.isPreferred || pv.isPreferred,
        fitScore: vendorFitScore({
          distanceKm: pv.distanceKm,
          serviceRadiusKm: v.serviceRadiusKm,
          leadTimeDays: v.leadTimeDays,
          transitHours: pv.transitHours,
          daysUntilNeed,
          rating,
          completedOrders: v.completedOrders,
          preferred: v.isPreferred || pv.isPreferred,
        }),
      };
    })
    .sort((a, b) => Number(a.status === "BLACKLISTED") - Number(b.status === "BLACKLISTED") || b.fitScore - a.fitScore);
}

type RfqFull = RFQ & { project: Project; items: (RFQItem & { material: Material & { category: { name: string } } })[] };

export async function rfqDocData(rfq: RfqFull, vendorName = "", templateVersion = 1, terms?: string): Promise<RfqDocData> {
  const s = await getSettings();
  const item = rfq.items[0];
  return {
    rfq_no: rfq.number,
    company_name: s.companyName,
    project_name: rfq.project.name,
    project_code: rfq.project.code,
    material: item.material.name,
    category: item.material.category.name,
    spec: item.spec ?? item.material.spec ?? "",
    quantity: fmtQty(num(item.quantity)),
    unit: item.unit,
    delivery_date: fmtDate(rfq.expectedDeliveryDate),
    delivery_address: rfq.deliveryAddress,
    deadline: fmtDateTime(rfq.deadline),
    payment_terms: rfq.paymentTermsPref ?? "",
    notes: rfq.notes ?? "",
    terms: terms ?? s.defaultTerms,
    site_contact: [rfq.project.siteContactName, rfq.project.siteContactPhone].filter(Boolean).join(", ") || "-",
    vendor_name: vendorName,
    issue_date: fmtDate(rfq.createdAt),
    template_version: String(templateVersion),
  };
}

/** Render the RFQ PDF (and fill the .docx when the active template is a Word file). */
export async function renderRfqDocuments(rfqId: string) {
  const rfq = await db.rFQ.findUniqueOrThrow({
    where: { id: rfqId },
    include: { project: true, items: { include: { material: { include: { category: true } } } }, template: true },
  });
  const tpl = rfq.template;
  const data = await rfqDocData(rfq, "", tpl?.version ?? 1, tpl?.terms);
  const pdf = await renderRfqPdf(data);
  const pdfKey = await saveFile(`rfq/${rfq.id}`, `${rfq.number}.pdf`, pdf, "application/pdf");
  let docxKey: string | null = null;
  if (tpl?.kind === "DOCX" && tpl.fileKey) {
    try {
      const filled = fillDocxTemplate(await storage.get(tpl.fileKey), data as unknown as Record<string, string>);
      docxKey = await saveFile(`rfq/${rfq.id}`, `${rfq.number}.docx`, filled, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch (e) {
      console.error("DOCX template fill failed", e);
    }
  }
  await db.rFQ.update({ where: { id: rfqId }, data: { pdfKey, docxKey } });
  return { pdfKey, docxKey };
}

export interface SendRfqInput {
  projectId: string;
  materialId: string;
  quantity: number;
  expectedDeliveryDate: Date;
  deadline: Date;
  deliveryAddress: string;
  notes?: string;
  paymentTermsPref?: string;
  vendorIds: string[];
  attachments?: { name: string; key: string; contentType: string }[];
  materialRequestId?: string;
}

export async function createAndSendRfq(input: SendRfqInput, user: SessionUser) {
  const [project, material, template] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: input.projectId } }),
    db.material.findUniqueOrThrow({ where: { id: input.materialId } }),
    db.rFQTemplate.findFirst({ where: { isActive: true }, orderBy: { version: "desc" } }),
  ]);
  const vendors = await db.vendor.findMany({ where: { id: { in: input.vendorIds }, status: { not: "BLACKLISTED" }, deletedAt: notDeleted } });
  if (!vendors.length) throw new Error("Select at least one eligible vendor");
  const pvs = await db.projectVendor.findMany({ where: { projectId: project.id, vendorId: { in: vendors.map((v) => v.id) } } });
  if (pvs.some((pv) => pv.isBlacklisted)) throw new Error("A selected vendor is blacklisted for this project");

  const tokens = new Map<string, string>();
  const rfq = await db.$transaction(async (tx) => {
    const number = await nextRfqNumber(project.code, tx);
    const created = await tx.rFQ.create({
      data: {
        number,
        projectId: project.id,
        status: "SENT",
        expectedDeliveryDate: input.expectedDeliveryDate,
        deadline: input.deadline,
        deliveryAddress: input.deliveryAddress,
        notes: input.notes,
        paymentTermsPref: input.paymentTermsPref,
        templateId: template?.id,
        attachments: (input.attachments ?? []) as never,
        createdById: user.id,
        items: { create: { materialId: material.id, quantity: input.quantity, unit: material.unit, spec: material.spec } },
        vendors: {
          create: vendors.map((v) => {
            const t = newToken();
            tokens.set(v.id, t);
            return {
              vendorId: v.id,
              tokenHash: hashToken(t),
              tokenCipher: encrypt(t),
              tokenExpiresAt: rfqLinkExpiry(input.deadline),
              deadline: input.deadline,
              distanceKm: pvs.find((p) => p.vendorId === v.id)?.distanceKm ?? null,
            };
          }),
        },
      },
      include: { vendors: true },
    });
    if (input.materialRequestId)
      await tx.materialRequest.update({ where: { id: input.materialRequestId }, data: { status: "RFQ_CREATED", rfqId: created.id } });
    await audit(user, "RFQ", created.id, "CREATED_AND_SENT", { after: { number, vendors: vendors.length, quantity: input.quantity }, projectId: project.id }, tx);
    return created;
  });

  await renderRfqDocuments(rfq.id);
  for (const rv of rfq.vendors) await emailRfqVendor(rv.id, "invite", tokens.get(rv.vendorId));
  return rfq;
}

type EmailKind = "invite" | "reminder" | "extension" | "negotiation" | "not_selected";

/** Send an RFQ-related email to one vendor. Idempotent per (rfqVendor, kind, discriminator). */
export async function emailRfqVendor(rfqVendorId: string, kind: EmailKind, token?: string, extra?: { message?: string; discriminator?: string }) {
  const rv = await db.rFQVendor.findUniqueOrThrow({
    where: { id: rfqVendorId },
    include: { vendor: true, rfq: { include: { project: true, items: { include: { material: true } } } } },
  });
  const t = token ?? decrypt(rv.tokenCipher);
  const link = rfqVendorLink(t);
  const item = rv.rfq.items[0];
  const details = kv([
    ["RFQ number", rv.rfq.number],
    ["Material", `${item.material.name}${item.spec ? ` — ${item.spec}` : ""}`],
    ["Quantity", fmtQty(num(item.quantity), item.unit)],
    ["Required delivery date", fmtDate(rv.rfq.expectedDeliveryDate)],
    ["Delivery address", rv.rfq.deliveryAddress],
    ["Quotation deadline", fmtDateTime(rv.deadline)],
  ]);
  const name = rv.vendor.contactPerson || rv.vendor.name;
  const content: Record<EmailKind, { subject: string; title: string; body: string }> = {
    invite: {
      subject: `RFQ ${rv.rfq.number}: ${item.material.name} for ${rv.rfq.project.name}`,
      title: "Request for Quotation",
      body: `${p(`Dear ${name},`)}${p(`NYATI invites you to quote for the requirement below. The RFQ document is attached.`)}${details}${button(link, "Submit Quotation")}`,
    },
    reminder: {
      subject: `Reminder: RFQ ${rv.rfq.number} closes ${fmtDateTime(rv.deadline)}`,
      title: "Quotation deadline approaching",
      body: `${p(`Dear ${name},`)}${p("We have not yet received your quotation for the RFQ below. Please submit before the deadline, or decline if you cannot supply.")}${details}${button(link, "Submit Quotation")}`,
    },
    extension: {
      subject: `Deadline extended: RFQ ${rv.rfq.number}`,
      title: "Quotation deadline extended",
      body: `${p(`Dear ${name},`)}${p(`The quotation deadline has been extended to ${fmtDateTime(rv.deadline)}.`)}${details}${button(link, "Submit Quotation")}`,
    },
    negotiation: {
      subject: `RFQ ${rv.rfq.number}: request to revise your quotation`,
      title: "Can you improve your offer?",
      body: `${p(`Dear ${name},`)}${p("Thank you for your quotation. We would like to request a revision:")}${p(extra?.message ?? "Please review your price and delivery commitment.")}${p("You can submit a revised quotation through the same secure link.")}${details}${button(link, "Revise Quotation")}`,
    },
    not_selected: {
      subject: `RFQ ${rv.rfq.number}: outcome`,
      title: "Thank you for your quotation",
      body: `${p(`Dear ${name},`)}${p(`Thank you for responding to RFQ ${rv.rfq.number} (${item.material.name}). After evaluation, we have decided to proceed with another supplier on this occasion. We value your participation and look forward to working with you on future requirements.`)}`,
    },
  };
  const c = content[kind];
  const attachments: EmailAttachment[] = [];
  if (kind === "invite" && rv.rfq.pdfKey) attachments.push({ name: `${rv.rfq.number}.pdf`, key: rv.rfq.pdfKey, contentType: "application/pdf" });
  if (kind === "invite" && rv.rfq.docxKey)
    attachments.push({ name: `${rv.rfq.number}.docx`, key: rv.rfq.docxKey, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  if (!rv.vendor.emails.length) return null;
  const log = await queueEmail({
    idempotencyKey: `rfqv:${rv.id}:${kind}:${extra?.discriminator ?? (kind === "reminder" ? rv.remindersSent : "")}`,
    to: rv.vendor.emails,
    subject: c.subject,
    html: layout(c.title, c.body),
    attachments,
    relatedType: "RFQVendor",
    relatedId: rv.id,
    projectId: rv.rfq.projectId,
  });
  if (log.status === "DEMO" && kind === "invite")
    await db.rFQVendor.updateMany({ where: { id: rv.id, status: "QUEUED" }, data: { status: "SENT", sentAt: new Date() } });
  return log;
}

/**
 * Issue a new link for one vendor (e.g. the link was forwarded to the wrong person). The old link stops
 * working immediately; quotations already submitted are kept. Optionally re-emails the invitation.
 */
export async function regenerateRfqVendorLink(rfqVendorId: string, actor: SessionUser, resend: boolean) {
  const rv = await db.rFQVendor.findUniqueOrThrow({ where: { id: rfqVendorId }, include: { rfq: true } });
  const token = newToken();
  await db.rFQVendor.update({
    where: { id: rv.id },
    data: { tokenHash: hashToken(token), tokenCipher: encrypt(token), tokenExpiresAt: rfqLinkExpiry(rv.deadline) },
  });
  await audit(actor, "RFQVendor", rv.id, "LINK_REGENERATED", { after: { resend }, projectId: rv.rfq.projectId });
  if (resend) await emailRfqVendor(rv.id, "invite", token, { discriminator: `regen-${Date.now()}` });
  return rfqVendorLink(token);
}

/** Job: reminders to non-responders at the project's configured hours-before-deadline. */
export async function sendRfqReminders() {
  const open = await db.rFQVendor.findMany({
    where: { status: { in: ["SENT", "OPENED"] }, deadline: { gt: new Date() }, rfq: { status: { in: ["SENT", "PARTIALLY_RESPONDED"] } } },
    include: { rfq: { include: { project: { include: { settings: true } } } } },
  });
  let sent = 0;
  for (const rv of open) {
    const hours = [...(rv.rfq.project.settings?.reminderHoursBefore ?? [24, 3])].sort((a, b) => b - a);
    const hoursLeft = (rv.deadline.getTime() - Date.now()) / 3600_000;
    const due = hours.filter((h) => hoursLeft <= h).length; // how many reminder thresholds have passed
    if (due > rv.remindersSent) {
      await emailRfqVendor(rv.id, "reminder", undefined, { discriminator: String(due) });
      await db.rFQVendor.update({ where: { id: rv.id }, data: { remindersSent: due, lastReminderAt: new Date() } });
      sent++;
    }
  }
  return sent;
}

/** Job: after the deadline, mark silent vendors NO_RESPONSE and close quote collection. */
export async function closeExpiredRfqs() {
  const rfqs = await db.rFQ.findMany({ where: { status: { in: ["SENT", "PARTIALLY_RESPONDED"] }, deadline: { lt: new Date() } }, include: { vendors: true } });
  for (const r of rfqs) {
    const stillOpen = r.vendors.filter((v) => v.deadline > new Date());
    if (stillOpen.length) continue; // a per-vendor extension is still running
    await db.rFQVendor.updateMany({ where: { rfqId: r.id, status: { in: ["QUEUED", "SENT", "OPENED", "FAILED"] } }, data: { status: "NO_RESPONSE" } });
    await db.rFQ.update({ where: { id: r.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await audit({ label: "system" }, "RFQ", r.id, "QUOTE_COLLECTION_CLOSED", { projectId: r.projectId });
  }
  return rfqs.length;
}

export async function refreshRfqStatus(rfqId: string) {
  const rfq = await db.rFQ.findUniqueOrThrow({ where: { id: rfqId }, include: { vendors: true } });
  if (!["SENT", "PARTIALLY_RESPONDED"].includes(rfq.status)) return;
  const done = rfq.vendors.filter((v) => v.status === "RESPONDED" || v.status === "DECLINED").length;
  const anyResponded = rfq.vendors.some((v) => v.status === "RESPONDED");
  const status = done === rfq.vendors.length ? "CLOSED" : anyResponded ? "PARTIALLY_RESPONDED" : "SENT";
  if (status !== rfq.status) await db.rFQ.update({ where: { id: rfqId }, data: { status, closedAt: status === "CLOSED" ? new Date() : null } });
}

export type VendorCandidate = Awaited<ReturnType<typeof vendorCandidates>>[number];
export type { Vendor, RFQVendor };
