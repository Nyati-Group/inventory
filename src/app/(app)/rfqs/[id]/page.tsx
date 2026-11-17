import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { db } from "@/lib/db";
import { num, numOrNull, fmtDate, fmtDateTime, qty } from "@/lib/utils";
import { decrypt } from "@/lib/tokens";
import { rfqVendorLink, whatsappShareUrl } from "@/lib/vendor-links";
import { signedUrl } from "@/lib/storage";
import { comparisonInputs } from "@/lib/services/comparison";
import { marketStats, type MarketRate } from "@/lib/market-rates";
import { rfqStage } from "@/lib/stage";
import { PageHeader, Stepper, StatusBadge, Card } from "@/components/ui/misc";
import { RfqDetail } from "./rfq-detail";

export const metadata = { title: "RFQ" };

export default async function RfqPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const user = await requireUser();
  const rfq = await db.rFQ.findUnique({
    where: { id: params.id },
    include: {
      project: { include: { settings: true } },
      items: { include: { material: true } },
      createdBy: { select: { name: true } },
      vendors: { include: { vendor: true, quotation: { include: { versions: { orderBy: { versionNo: "desc" }, include: { documents: true } }, activeVersion: true } } }, orderBy: { vendor: { name: "asc" } } },
      approvalRequests: { include: { steps: { include: { approver: { select: { id: true, name: true } } }, orderBy: { level: "asc" } }, requestedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      purchaseOrders: { select: { id: true, number: true, status: true, vendorId: true } },
    },
  });
  if (!rfq) notFound();
  await assertProjectAccess(user, rfq.projectId);
  const canManage = can(user, "manageRfq");
  const item = rfq.items[0];
  const { quotes, ctx, weights } = await comparisonInputs(rfq.id);
  const [stock, snapshot, emails, auditRows] = await Promise.all([
    db.materialProjectStock.findUnique({ where: { projectId_materialId: { projectId: rfq.projectId, materialId: item.materialId } } }),
    db.marketRateSnapshot.findFirst({ where: { materialId: item.materialId, projectId: rfq.projectId }, orderBy: { fetchedAt: "desc" } }),
    db.emailLog.findMany({ where: { relatedType: "RFQVendor", relatedId: { in: rfq.vendors.map((v) => v.id) } }, orderBy: { createdAt: "desc" }, select: { relatedId: true, status: true, subject: true, createdAt: true, error: true } }),
    db.auditLog.findMany({ where: { OR: [{ entityId: rfq.id }, { entityId: { in: rfq.vendors.map((v) => v.id) } }, { entityId: { in: rfq.approvalRequests.map((a) => a.id) } }, { entityId: { in: rfq.vendors.flatMap((v) => v.quotation?.versions.map((x) => x.id) ?? []) } }] }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const market = snapshot ? marketStats(snapshot.results as unknown as MarketRate[]) : null;
  const responded = rfq.vendors.filter((v) => v.status === "RESPONDED").length;
  const po = rfq.purchaseOrders[0];

  const vendorRows = rfq.vendors.map((rv) => {
    const q = rv.quotation;
    const active = q?.activeVersion;
    return {
      id: rv.id,
      vendorId: rv.vendorId,
      name: rv.vendor.name,
      email: rv.vendor.emails[0] ?? "",
      status: rv.status,
      sentAt: rv.sentAt?.toISOString() ?? null,
      openedAt: rv.openedAt?.toISOString() ?? null,
      respondedAt: rv.respondedAt?.toISOString() ?? null,
      declineReason: rv.declineReason,
      deadline: rv.deadline.toISOString(),
      reminders: rv.remindersSent,
      distanceKm: rv.distanceKm,
      lastEmail: emails.find((e) => e.relatedId === rv.id) ? { status: emails.find((e) => e.relatedId === rv.id)!.status, error: emails.find((e) => e.relatedId === rv.id)!.error } : null,
      portalLink: canManage ? rfqVendorLink(decrypt(rv.tokenCipher)) : null,
      linkExpiresAt: rv.tokenExpiresAt.toISOString(),
      whatsappUrl:
        canManage && (rv.vendor.whatsapp || rv.vendor.phone)
          ? whatsappShareUrl(rv.vendor.whatsapp ?? rv.vendor.phone, `NYATI RFQ ${rfq.number} — ${item.material.name}, ${qty(num(item.quantity), item.unit)}. Please submit your quotation before ${fmtDateTime(rv.deadline)}: ${rfqVendorLink(decrypt(rv.tokenCipher))}`)
          : null,
      quotation: q
        ? {
            referenceNo: q.referenceNo,
            active: active
              ? {
                  id: active.id,
                  versionNo: active.versionNo,
                  method: active.method,
                  parseStatus: active.parseStatus,
                  confidence: active.confidence,
                  parseNotes: active.parseNotes,
                  unitRate: numOrNull(active.unitRate),
                  quantity: numOrNull(active.quantity),
                  gstPercent: numOrNull(active.gstPercent),
                  freight: num(active.freight) + num(active.loading) + num(active.otherCharges),
                  landedCost: numOrNull(active.landedCost),
                  statedTotal: numOrNull(active.statedTotal),
                  totalMismatch: active.totalMismatch,
                  deliveryDate: active.deliveryDate?.toISOString() ?? null,
                  paymentTerms: active.paymentTerms,
                  validityDays: active.validityDays,
                  warranty: active.warranty,
                  deviations: active.deviations,
                }
              : null,
            versions: q.versions.map((v) => ({
              id: v.id,
              versionNo: v.versionNo,
              method: v.method,
              submittedAt: v.submittedAt.toISOString(),
              landedCost: numOrNull(v.landedCost),
              parseStatus: v.parseStatus,
              source: v.source,
              docs: v.documents.map((d) => ({ name: d.fileName, url: signedUrl(d.fileKey, 3600, d.fileName) })),
            })),
          }
        : null,
    };
  });

  const pending = rfq.approvalRequests.find((a) => a.status === "PENDING");
  const currentStep = pending?.steps.find((s) => s.status === "PENDING");
  const vendorName = (id: string | null) => rfq.vendors.find((v) => v.vendorId === id)?.vendor.name ?? "—";

  return (
    <div className="space-y-4">
      <PageHeader
        title={rfq.number}
        crumbs={<Link href="/rfqs" className="text-xs text-muted hover:text-brand-600">← RFQs & Quotations</Link>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={rfq.status} /> {item.material.name} · {qty(num(item.quantity), item.unit)} · need by {fmtDate(rfq.expectedDeliveryDate)} · deadline {fmtDateTime(rfq.deadline)}
          </span>
        }
        actions={
          <>
            {rfq.pdfKey && <a className="link text-sm" href={signedUrl(rfq.pdfKey, 3600, `${rfq.number}.pdf`)} target="_blank" rel="noreferrer">RFQ PDF</a>}
            {rfq.docxKey && <a className="link text-sm" href={signedUrl(rfq.docxKey, 3600, `${rfq.number}.docx`)}>DOCX</a>}
            {po && <Link className="link text-sm" href={`/purchase-orders/${po.id}`}>{po.number} →</Link>}
          </>
        }
      />
      <Card bodyClassName="py-3">
        <Stepper current={rfqStage(rfq.status, responded)} />
      </Card>
      <RfqDetail
        tab={searchParams.tab ?? (rfq.status === "AWAITING_APPROVAL" ? "approval" : responded ? "comparison" : "vendors")}
        rfq={{
          id: rfq.id,
          number: rfq.number,
          status: rfq.status,
          deadline: rfq.deadline.toISOString(),
          projectId: rfq.projectId,
          material: item.material.name,
          unit: item.unit,
          quantity: num(item.quantity),
          deliveryAddress: rfq.deliveryAddress,
          notes: rfq.notes,
          createdBy: rfq.createdBy?.name ?? "",
          createdAt: rfq.createdAt.toISOString(),
        }}
        vendors={vendorRows}
        comparison={{ quotes, ctx, weights, ourLastRate: numOrNull(stock?.lastRate), marketAvg: market?.avg ?? null }}
        approvals={rfq.approvalRequests.map((a) => ({
          id: a.id,
          status: a.status,
          amount: num(a.amount),
          selected: vendorName(a.selectedVendorId),
          selectedVendorId: a.selectedVendorId,
          recommended: vendorName(a.recommendedVendorId),
          isOverride: a.selectedVendorId !== a.recommendedVendorId,
          overrideReason: a.overrideReason,
          split: (a.splitAward as { vendorId: string; quantity: number }[] | null)?.map((s) => ({ ...s, name: vendorName(s.vendorId) })) ?? null,
          note: a.note,
          requestedBy: a.requestedBy?.name ?? "",
          createdAt: a.createdAt.toISOString(),
          steps: a.steps.map((s) => ({ id: s.id, level: s.level, label: s.label, approver: s.approver?.name ?? "—", status: s.status, comment: s.comment, decidedAt: s.decidedAt?.toISOString() ?? null })),
        }))}
        canManage={canManage}
        canDecide={!!currentStep && (currentStep.approverId === user.id || user.role === "ADMIN")}
        audit={auditRows.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), actor: a.actorLabel, action: a.action, entity: a.entityType }))}
      />
    </div>
  );
}
