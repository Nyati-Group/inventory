import { db } from "../db";
import { num, inr, fmtDate, qty as fmtQty, round2 } from "../utils";
import { newToken, hashToken, encrypt, decrypt } from "../tokens";
import { poVendorLink, poLinkExpiry } from "../vendor-links";
import { saveFile } from "../storage";
import { queueEmail } from "../email/service";
import { layout, button, kv, p } from "../email/templates";
import { renderPoPdf } from "../pdf";
import { getSettings } from "../settings";
import { nextPoNumber, nextGrnNumber } from "../numbering";
import { audit } from "../audit";
import { notifyRoles } from "../notifications";
import { emailRfqVendor } from "./rfq";
import { computeRatingForPo } from "./rating";
import type { SessionUser } from "../auth";

type Actor = SessionUser | { label: string };

// ─────────────────────────── Purchase orders ───────────────────────────

/** Create PO(s) from an approved approval request. A split award creates one PO per vendor. */
export async function createPurchaseOrders(approvalRequestId: string, actor: Actor) {
  const req = await db.approvalRequest.findUniqueOrThrow({
    where: { id: approvalRequestId },
    include: {
      rfq: {
        include: {
          project: { include: { settings: true } },
          items: { include: { material: true } },
          quotations: { include: { activeVersion: true, vendor: true } },
          vendors: true,
        },
      },
    },
  });
  const rfq = req.rfq;
  const item = rfq.items[0];
  const settings = await getSettings();
  const split = (req.splitAward as { vendorId: string; quantity: number }[] | null) ?? null;
  const awards = split?.length ? split : [{ vendorId: req.selectedVendorId!, quantity: num(item.quantity) }];

  const poIds: string[] = [];
  for (const award of awards) {
    const q = rfq.quotations.find((x) => x.vendorId === award.vendorId);
    const v = q?.activeVersion;
    if (!q || !v || v.unitRate === null) throw new Error("Selected vendor has no valid quotation");
    const rate = num(v.unitRate);
    const gstPct = v.gstPercent !== null ? num(v.gstPercent) : num(item.material.gstPercent);
    const offered = v.quantity !== null ? num(v.quantity) : num(item.quantity);
    const share = offered > 0 ? Math.min(1, award.quantity / offered) : 1;
    const subtotal = round2(award.quantity * rate);
    const gst = round2((subtotal * gstPct) / 100);
    const charges = round2((num(v.freight) + num(v.loading) + num(v.otherCharges)) * share);
    const po = await db.$transaction(async (tx) => {
      const number = await nextPoNumber(rfq.project.code, tx);
      const created = await tx.purchaseOrder.create({
        data: {
          number,
          projectId: rfq.projectId,
          rfqId: rfq.id,
          vendorId: award.vendorId,
          quotationVersionId: v.id,
          approvalRequestId: req.id,
          status: "APPROVED",
          subtotal,
          gstTotal: gst,
          freight: charges,
          total: round2(subtotal + gst + charges),
          paymentTerms: v.paymentTerms ?? "As agreed",
          creditDays: v.creditDays ?? 0,
          expectedDeliveryDate: rfq.expectedDeliveryDate,
          promisedDeliveryDate: v.deliveryDate,
          deliveryAddress: rfq.deliveryAddress,
          terms: settings.poTerms,
          createdById: "id" in actor ? actor.id : null,
          items: {
            create: {
              materialId: item.materialId,
              description: `${item.material.name}${item.spec ? ` — ${item.spec}` : ""}`,
              quantity: award.quantity,
              unit: item.unit,
              unitRate: rate,
              gstPercent: gstPct,
              amount: subtotal,
            },
          },
        },
      });
      // Feedback loop: latest purchase rate + rate history
      await tx.rateHistory.create({
        data: { projectId: rfq.projectId, materialId: item.materialId, vendorId: award.vendorId, poId: created.id, poNumber: number, qty: award.quantity, rate, date: new Date() },
      });
      await tx.materialProjectStock.upsert({
        where: { projectId_materialId: { projectId: rfq.projectId, materialId: item.materialId } },
        create: { projectId: rfq.projectId, materialId: item.materialId, lastRate: rate, lastRateAt: new Date() },
        update: { lastRate: rate, lastRateAt: new Date() },
      });
      await tx.vendorMaterial.upsert({
        where: { vendorId_materialId: { vendorId: award.vendorId, materialId: item.materialId } },
        create: { vendorId: award.vendorId, materialId: item.materialId, lastRate: rate },
        update: { lastRate: rate },
      });
      await audit(actor, "PurchaseOrder", created.id, "CREATED", { after: { number, total: created.total, vendorId: award.vendorId }, projectId: rfq.projectId }, tx);
      return created;
    });
    await renderPo(po.id);
    poIds.push(po.id);
  }

  await db.rFQ.update({ where: { id: rfq.id }, data: { status: "ORDERED" } });

  // Polite "not selected" emails to the other responders
  const notify = settings.notifyNotSelected && (rfq.project.settings?.notifyNotSelected ?? true);
  if (notify) {
    const winners = new Set(awards.map((a) => a.vendorId));
    for (const rv of rfq.vendors.filter((x) => x.status === "RESPONDED" && !winners.has(x.vendorId)))
      await emailRfqVendor(rv.id, "not_selected").catch(() => undefined);
  }
  return poIds;
}

export async function renderPo(poId: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: { items: { include: { material: true } }, vendor: true, project: true, rfq: true, quotationVersion: { include: { quotation: true } } },
  });
  const s = await getSettings();
  const company = await db.company.findFirst();
  const pdf = await renderPoPdf({
    po_no: po.number,
    date: fmtDate(po.createdAt),
    company_name: company?.legalName ?? s.companyName,
    company_gstin: company?.gstin ?? "",
    project: `${po.project.name} (${po.project.code})`,
    vendor_name: po.vendor.name,
    vendor_address: [po.vendor.address, po.vendor.city].filter(Boolean).join(", "),
    vendor_gstin: po.vendor.gstin ?? "",
    rfq_no: po.rfq?.number ?? "-",
    quotation_ref: po.quotationVersion ? `${po.quotationVersion.quotation.referenceNo} v${po.quotationVersion.versionNo}` : "-",
    items: po.items.map((i) => ({
      description: i.description,
      hsn: i.material.hsnCode ?? "",
      qty: fmtQty(num(i.quantity)),
      unit: i.unit,
      rate: inr(num(i.unitRate)),
      gst: `${num(i.gstPercent)}%`,
      amount: inr(num(i.amount)),
    })),
    subtotal: inr(num(po.subtotal)),
    gst: inr(num(po.gstTotal)),
    freight: inr(num(po.freight) + num(po.otherCharges)),
    total: inr(num(po.total)),
    delivery_address: po.deliveryAddress,
    delivery_date: `${fmtDate(po.expectedDeliveryDate)}${po.promisedDeliveryDate ? ` (vendor committed ${fmtDate(po.promisedDeliveryDate)})` : ""}`,
    payment_terms: po.paymentTerms ?? "-",
    receiving: [po.project.receivingHours, po.project.unloadingConstraints].filter(Boolean).join(" · "),
    terms: po.terms ?? s.poTerms,
  });
  const key = await saveFile(`po/${po.id}`, `${po.number}.pdf`, pdf, "application/pdf");
  await db.purchaseOrder.update({ where: { id: po.id }, data: { pdfKey: key } });
  return key;
}

/** Email the PO with a secure Accept / Request change / dispatch-update link. */
export async function sendPo(poId: string, actor: Actor) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { vendor: true, project: true } });
  if (!["APPROVED", "SENT", "CHANGE_REQUESTED"].includes(po.status)) throw new Error(`PO cannot be sent in status ${po.status}`);
  let token: string;
  if (po.vendorTokenCipher) token = decrypt(po.vendorTokenCipher);
  else {
    token = newToken();
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { vendorTokenHash: hashToken(token), vendorTokenCipher: encrypt(token), tokenExpiresAt: poLinkExpiry() },
    });
  }
  const pdfKey = po.pdfKey ?? (await renderPo(po.id));
  const link = poVendorLink(token);
  await queueEmail({
    idempotencyKey: `po:${po.id}:send:${po.updatedAt.getTime()}`,
    to: po.vendor.emails,
    subject: `Purchase Order ${po.number} — ${po.project.name}`,
    html: layout(
      "Purchase Order",
      `${p(`Dear ${po.vendor.contactPerson || po.vendor.name},`)}${p("Please find our purchase order attached. Kindly accept it (or request a change) and share dispatch details through the link below.")}${kv([
        ["PO number", po.number],
        ["Order value", inr(num(po.total))],
        ["Delivery by", fmtDate(po.expectedDeliveryDate)],
        ["Delivery address", po.deliveryAddress],
      ])}${button(link, "Accept / Update PO")}`,
    ),
    attachments: [{ name: `${po.number}.pdf`, key: pdfKey, contentType: "application/pdf" }],
    relatedType: "PurchaseOrder",
    relatedId: po.id,
    projectId: po.projectId,
  });
  await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "SENT", sentAt: new Date() } });
  await audit(actor, "PurchaseOrder", po.id, "SENT", { before: { status: po.status }, after: { status: "SENT" }, projectId: po.projectId });
}

export async function addDeliveryUpdate(
  poId: string,
  source: "VENDOR" | "BUYER",
  d: { status: "DISPATCHED" | "IN_TRANSIT" | "DELAYED" | "ARRIVED"; vehicleNo?: string; driverName?: string; driverPhone?: string; eta?: Date | null; note?: string },
) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  await db.deliveryUpdate.create({ data: { poId, source, ...d, eta: d.eta ?? null } });
  const promised = po.promisedDeliveryDate ?? po.expectedDeliveryDate;
  if (d.status === "DELAYED" || (d.eta && d.eta.getTime() > promised.getTime() + 12 * 3600_000))
    await notifyRoles(po.projectId, ["PROCUREMENT_MANAGER", "SITE_ENGINEER"], {
      type: "DELIVERY_DELAYED",
      title: `Delivery delayed — ${po.number}`,
      body: d.eta ? `New ETA ${fmtDate(d.eta)} (promised ${fmtDate(promised)})` : d.note,
      link: `/purchase-orders/${po.id}`,
    });
  await audit({ label: source === "VENDOR" ? "vendor (portal)" : "buyer" }, "PurchaseOrder", poId, `DELIVERY_${d.status}`, { after: d, projectId: po.projectId });
}

// ─────────────────────────── GRN ───────────────────────────

export interface GrnInput {
  poId: string;
  receivedAt: Date;
  challanNo?: string;
  challanKey?: string;
  remarks?: string;
  items: { poItemId: string; deliveredQty: number; acceptedQty: number; rejectionReason?: string }[];
  qc: { specMatch: boolean; noDamage: boolean; packagingOk: boolean; testCertProvided: boolean; certKey?: string; photoKeys: string[]; notes?: string };
}

export async function recordGrn(input: GrnInput, user: SessionUser) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: input.poId }, include: { items: true, project: true, vendor: true } });
  if (!["SENT", "ACCEPTED", "PARTIALLY_DELIVERED", "APPROVED"].includes(po.status)) throw new Error(`Cannot receive goods for a PO in status ${po.status}`);
  for (const it of input.items) {
    if (it.acceptedQty < 0 || it.deliveredQty < 0 || it.acceptedQty > it.deliveredQty) throw new Error("Accepted quantity must be between 0 and delivered quantity");
    if (it.deliveredQty - it.acceptedQty > 0 && !it.rejectionReason) throw new Error("Rejection reason is required for rejected quantity");
  }
  const grn = await db.$transaction(async (tx) => {
    const number = await nextGrnNumber(po.project.code, tx);
    const g = await tx.gRN.create({
      data: {
        number,
        poId: po.id,
        projectId: po.projectId,
        receivedAt: input.receivedAt,
        challanNo: input.challanNo,
        challanKey: input.challanKey,
        remarks: input.remarks,
        receivedById: user.id,
        qualityCheck: { create: input.qc },
      },
    });
    for (const it of input.items) {
      const poItem = po.items.find((x) => x.id === it.poItemId);
      if (!poItem) throw new Error("Unknown PO line");
      const rejected = round2(it.deliveredQty - it.acceptedQty);
      await tx.gRNItem.create({
        data: { grnId: g.id, poItemId: poItem.id, materialId: poItem.materialId, deliveredQty: it.deliveredQty, acceptedQty: it.acceptedQty, rejectedQty: rejected, rejectionReason: it.rejectionReason },
      });
      await tx.pOItem.update({ where: { id: poItem.id }, data: { receivedQty: { increment: it.deliveredQty }, acceptedQty: { increment: it.acceptedQty } } });
      // Stock auto-increases for accepted quantity
      const stock = await tx.materialProjectStock.upsert({
        where: { projectId_materialId: { projectId: po.projectId, materialId: poItem.materialId } },
        create: { projectId: po.projectId, materialId: poItem.materialId, currentQty: it.acceptedQty },
        update: { currentQty: { increment: it.acceptedQty } },
      });
      if (it.acceptedQty > 0)
        await tx.stockLedger.create({
          data: { projectId: po.projectId, materialId: poItem.materialId, type: "IN", qty: it.acceptedQty, balanceAfter: stock.currentQty, refType: "GRN", refId: g.id, note: `${number} against ${po.number}`, createdById: user.id },
        });
      if (rejected > 0)
        await tx.returnRequest.create({
          data: { grnId: g.id, poId: po.id, vendorId: po.vendorId, materialId: poItem.materialId, qty: rejected, reason: it.rejectionReason ?? "Rejected at inspection" },
        });
    }
    const items = await tx.pOItem.findMany({ where: { poId: po.id } });
    const complete = items.every((i) => num(i.acceptedQty) + 1e-9 >= num(i.quantity));
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: complete ? "DELIVERED" : "PARTIALLY_DELIVERED", deliveredAt: complete ? new Date() : null },
    });
    await audit(user, "GRN", g.id, "RECORDED", { after: { number, po: po.number, items: input.items }, projectId: po.projectId }, tx);
    return g;
  });

  // Return / replacement request to the vendor
  const returns = await db.returnRequest.findMany({ where: { grnId: grn.id }, include: { material: true } });
  if (returns.length && po.vendor.emails.length)
    await queueEmail({
      idempotencyKey: `grn:${grn.id}:returns`,
      to: po.vendor.emails,
      subject: `Return / replacement request — ${po.number}`,
      html: layout(
        "Material rejected at inspection",
        `${p(`Dear ${po.vendor.contactPerson || po.vendor.name},`)}${p(`The following material delivered against ${po.number} (GRN ${grn.number}) was rejected at site inspection. Please arrange replacement at the earliest.`)}${kv(
          returns.map((r) => [r.material.name, `${fmtQty(num(r.qty), r.material.unit)} — ${r.reason}`]),
        )}`,
      ),
      relatedType: "GRN",
      relatedId: grn.id,
      projectId: po.projectId,
    });
  await tryClosePo(po.id);
  return grn;
}

// ─────────────────────────── Closing ───────────────────────────

/** A PO closes once the full quantity has been received and accepted at GRN. Closing triggers the vendor rating. */
export async function tryClosePo(poId: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  if (po.status !== "DELIVERED") return false;
  await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "CLOSED", closedAt: new Date() } });
  await audit({ label: "system" }, "PurchaseOrder", po.id, "CLOSED", { before: { status: "DELIVERED" }, after: { status: "CLOSED" }, projectId: po.projectId });
  await computeRatingForPo(po.id);
  return true;
}
