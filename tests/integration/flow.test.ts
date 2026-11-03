// End-to-end procurement flow against the real database (seeded). Run: npm run test:flow
// Exercises the same services the UI and vendor portal call.
import { describe, it, expect, beforeAll } from "vitest";
import PizZip from "pizzip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/tokens";
import { num } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth";
import { vendorCandidates, createAndSendRfq } from "@/lib/services/rfq";
import { submitQuotation, rfqVendorByToken, portalState } from "@/lib/services/vendor-portal";
import { processQuotationVersion } from "@/lib/quotation/process";
import { recomputeComparison } from "@/lib/services/comparison";
import { requestApproval, decideApprovalRequest } from "@/lib/services/approval";
import { sendPo, recordGrn } from "@/lib/services/orders";

const asSession = (u: { id: string; name: string; email: string; role: SessionUser["role"] }): SessionUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function pdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 800 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}
function docx(lines: string[]) {
  const z = new PizZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${l}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return z.generate({ type: "nodebuffer" }) as Buffer;
}

const quote = (rate: number, qty: number, days: number, freight: number, terms: string) => {
  const total = Math.round((rate * qty * 1.28 + freight) * 100) / 100;
  return [
    `Quotation No: T-${rate}`,
    `Quantity: ${qty} bags`,
    `Unit Rate: Rs. ${rate} per bag`,
    "GST @ 28%",
    `Freight charges: Rs. ${freight}`,
    `Grand Total: Rs. ${total.toLocaleString("en-IN")}`,
    `Delivery within ${days} days`,
    `Payment terms: ${terms}`,
    "Validity: 15 days",
  ];
};

describe("procurement flow: RFQ → quotes → compare → approve → PO → GRN → rating", () => {
  let buyer: SessionUser, approver: SessionUser, finance: SessionUser, site: SessionUser;
  let projectId: string, materialId: string;

  beforeAll(async () => {
    const users = await db.user.findMany();
    const by = (e: string) => asSession(users.find((u) => u.email === e)!);
    buyer = by("buyer@nyati.in");
    approver = by("approver@nyati.in");
    finance = by("finance@nyati.in");
    site = by("site@nyati.in");
    projectId = (await db.project.findUniqueOrThrow({ where: { code: "PNQ1" } })).id;
    materialId = (await db.material.findUniqueOrThrow({ where: { code: "CEM-PPC" } })).id;
  });

  it("runs the whole cycle and the new rating feeds back into vendor ordering", async () => {
    const expected = new Date(Date.now() + 7 * 86_400_000);
    // 1. Vendors sorted by fit (proximity + feasibility + rating)
    const candidates = await vendorCandidates(projectId, materialId, expected);
    const eligible = candidates.filter((c) => c.status !== "BLACKLISTED" && c.emails.length);
    expect(eligible.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < eligible.length; i++) expect(eligible[i - 1].fitScore).toBeGreaterThanOrEqual(eligible[i].fitScore);
    const invited = eligible.slice(0, 3);

    // 2. Send RFQ (demo mode → outbox), tokenised links
    const rfq = await createAndSendRfq(
      { projectId, materialId, quantity: 2000, expectedDeliveryDate: expected, deadline: new Date(Date.now() + 48 * 3600_000), deliveryAddress: "Site gate 2, Kharadi, Pune", vendorIds: invited.map((c) => c.vendorId) },
      buyer,
    );
    expect(rfq.number).toMatch(/^RFQ-PNQ1-\d{4}-\d{4}$/);
    const rvs = await db.rFQVendor.findMany({ where: { rfqId: rfq.id } });
    expect(rvs.every((r) => r.status === "SENT")).toBe(true);
    const outbox = await db.emailLog.findMany({ where: { relatedType: "RFQVendor", relatedId: { in: rvs.map((r) => r.id) } } });
    expect(outbox).toHaveLength(3);
    expect(outbox[0].html).toContain("/vendor/rfq/");
    expect((await db.rFQ.findUniqueOrThrow({ where: { id: rfq.id } })).pdfKey).toBeTruthy();

    // 3. Vendors submit: typed text, PDF and DOCX
    const tok = (vendorId: string) => decrypt(rvs.find((r) => r.vendorId === vendorId)!.tokenCipher);
    const [a, b, c] = invited.map((x) => x.vendorId);
    const rv = await rfqVendorByToken(tok(a));
    expect(rv && portalState(rv)).toBe("open");
    const r1 = await submitQuotation(tok(a), { method: "TEXT", text: quote(352, 2000, 3, 9000, "30 days credit").join("\n"), fields: { unitRate: 352 } }, "127.0.0.1", "vitest");
    const r2 = await submitQuotation(tok(b), { method: "PDF", file: { name: "quote.pdf", type: "application/pdf", data: await pdf(quote(349, 2000, 4, 12000, "15 days credit")) }, fields: {} }, "127.0.0.1", "vitest");
    await submitQuotation(tok(c), { method: "DOCX", file: { name: "quote.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: docx(quote(361, 2000, 2, 6000, "45 days credit")) }, fields: {} }, "127.0.0.1", "vitest");
    expect(r1.referenceNo).toMatch(/^QT-/);
    // revision: vendor A improves the price → version 2 becomes active
    const r1b = await submitQuotation(tok(a), { method: "TEXT", text: quote(346, 2000, 3, 9000, "30 days credit").join("\n"), fields: { unitRate: 346 } }, "127.0.0.1", "vitest");
    expect(r1b.versionNo).toBe(2);
    expect(r2.versionNo).toBe(1);

    const quotations = await db.quotation.findMany({ where: { rfqId: rfq.id }, include: { activeVersion: true } });
    for (const q of quotations) await processQuotationVersion(q.activeVersionId!);
    const versions = await db.quotationVersion.findMany({ where: { id: { in: quotations.map((q) => q.activeVersionId!) } } });
    expect(versions.map((v) => v.parseStatus).sort()).toEqual(["PARSED", "PARSED", "PARSED"]);
    expect(versions.map((v) => v.method).sort()).toEqual(["DOCX", "PDF", "TEXT"]);
    const vA = versions.find((v) => v.method === "TEXT")!;
    expect(num(vA.unitRate)).toBe(346);
    expect(num(vA.landedCost)).toBeCloseTo(346 * 2000 * 1.28 + 9000, 0);
    expect((await db.rFQ.findUniqueOrThrow({ where: { id: rfq.id } })).status).toBe("CLOSED"); // all invited responded

    // 4. Comparison & recommendation
    const cmp = await recomputeComparison(rfq.id);
    expect(cmp.scored).toHaveLength(3);
    expect(cmp.recommended).toBeTruthy();
    expect(cmp.explanation).toMatch(/is recommended/);
    const winner = cmp.recommended!.vendorId;

    // 5. Approval: amount > ₹5 L → Project Head then Finance
    const req = await requestApproval({ rfqId: rfq.id }, buyer);
    const steps = await db.approvalStep.findMany({ where: { requestId: req.id }, orderBy: { level: "asc" } });
    expect(steps.map((s) => s.label)).toEqual(["Project Head", "Finance"]);
    await expect(decideApprovalRequest({ requestId: req.id, decision: "APPROVE" }, finance)).rejects.toThrow(/Waiting for level 1/);
    expect((await decideApprovalRequest({ requestId: req.id, decision: "APPROVE" }, approver)).status).toBe("NEXT_LEVEL");
    const final = await decideApprovalRequest({ requestId: req.id, decision: "APPROVE", comment: "OK" }, finance);
    expect(final.status).toBe("APPROVED");
    expect(final.poIds).toHaveLength(1);

    // 6. PO generated from the approved quotation, emailed, accepted by vendor
    const poId = final.poIds[0];
    let po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    expect(po.vendorId).toBe(winner);
    expect(po.pdfKey).toBeTruthy();
    expect((await db.materialProjectStock.findUniqueOrThrow({ where: { projectId_materialId: { projectId, materialId } } })).lastRate?.toString()).toBe(po.items[0].unitRate.toString());
    await sendPo(poId, buyer);
    await db.purchaseOrder.update({ where: { id: poId }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    const notSelected = await db.emailLog.count({ where: { relatedType: "RFQVendor", relatedId: { in: rvs.filter((r) => r.vendorId !== winner).map((r) => r.id) }, subject: { contains: "outcome" } } });
    expect(notSelected).toBe(2);

    // 7. GRN with partial rejection → stock increases by accepted qty, return request raised
    const stockBefore = num((await db.materialProjectStock.findUniqueOrThrow({ where: { projectId_materialId: { projectId, materialId } } })).currentQty);
    await recordGrn({ poId, receivedAt: new Date(), challanNo: "DC-1", items: [{ poItemId: po.items[0].id, deliveredQty: 2000, acceptedQty: 1980, rejectionReason: "Torn bags" }], qc: { specMatch: true, noDamage: false, packagingOk: true, testCertProvided: true, photoKeys: [] } }, site);
    const stockAfter = num((await db.materialProjectStock.findUniqueOrThrow({ where: { projectId_materialId: { projectId, materialId } } })).currentQty);
    expect(stockAfter - stockBefore).toBe(1980);
    expect(await db.returnRequest.count({ where: { poId } })).toBe(1);
    po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    expect(po.status).toBe("PARTIALLY_DELIVERED");
    await recordGrn({ poId, receivedAt: new Date(), challanNo: "DC-2", items: [{ poItemId: po.items[0].id, deliveredQty: 20, acceptedQty: 20 }], qc: { specMatch: true, noDamage: true, packagingOk: true, testCertProvided: true, photoKeys: [] } }, site);
    // 8. Full quantity accepted → PO closes automatically and the rating is computed
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe("CLOSED");

    // 9. Automatic 5-pointer rating and feedback into vendor ordering
    const rating = await db.vendorRating.findUniqueOrThrow({ where: { poId }, include: { criteria: true } });
    expect(rating.criteria).toHaveLength(5);
    expect(rating.stars).toBeGreaterThan(0);
    const compliance = rating.criteria.find((c) => c.key === "COMPLIANCE")!;
    expect(compliance.autoScore).toBeLessThan(100); // no challan scans uploaded at GRN
    const pv = await db.projectVendor.findUniqueOrThrow({ where: { projectId_vendorId: { projectId, vendorId: winner } } });
    const vendor = await db.vendor.findUniqueOrThrow({ where: { id: winner } });
    const after = (await vendorCandidates(projectId, materialId, expected)).find((x) => x.vendorId === winner)!;
    const expectedRating = pv.ratedOrders >= 3 ? num(pv.rating) : num(vendor.overallRating);
    expect(after.rating).toBeCloseTo(expectedRating, 2);
    expect(vendor.completedOrders).toBeGreaterThan(0);
  });
});
