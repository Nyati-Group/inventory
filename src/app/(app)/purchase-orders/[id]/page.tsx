import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { db } from "@/lib/db";
import { num, numOrNull, inr, fmtDate, fmtDateTime, qty } from "@/lib/utils";
import { signedUrl } from "@/lib/storage";
import { decrypt } from "@/lib/tokens";
import { poVendorLink, whatsappShareUrl } from "@/lib/vendor-links";
import { poStage } from "@/lib/stage";
import { PageHeader, Card, Stepper, StatusBadge, Badge, Stars, EmptyState } from "@/components/ui/misc";
import { RatingBreakdown } from "@/components/rating-widgets";
import { VendorLinkBox } from "@/components/vendor-link-box";
import { PoActions } from "./po-actions";

export const metadata = { title: "Purchase Order" };

export default async function PoPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const po = await db.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      vendor: true,
      project: true,
      rfq: { select: { id: true, number: true } },
      items: { include: { material: true } },
      deliveryUpdates: { orderBy: { createdAt: "desc" } },
      grns: { include: { items: true, qualityCheck: true, receivedBy: { select: { name: true } } }, orderBy: { receivedAt: "desc" } },
      returnRequests: { include: { material: true } },
      rating: { include: { criteria: true } },
      approvalRequest: { include: { steps: { include: { approver: { select: { name: true } } } } } },
      quotationVersion: { include: { quotation: true } },
    },
  });
  if (!po) notFound();
  await assertProjectAccess(user, po.projectId);
  const stage = poStage({ status: po.status, rated: !!po.rating });
  const promised = po.promisedDeliveryDate ?? po.expectedDeliveryDate;
  const late = !["DELIVERED", "CLOSED", "CANCELLED"].includes(po.status) && promised < new Date();
  const canManage = can(user, "manageRfq");
  const vendorLink = canManage && po.vendorTokenCipher ? poVendorLink(decrypt(po.vendorTokenCipher)) : null;
  const forForms = {
    id: po.id,
    number: po.number,
    vendor: po.vendor.name,
    freight: num(po.freight) + num(po.otherCharges),
    items: po.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, quantity: num(i.quantity), acceptedQty: num(i.acceptedQty), receivedQty: num(i.receivedQty), unitRate: num(i.unitRate), gstPercent: num(i.gstPercent) })),
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={po.number}
        crumbs={<Link href="/purchase-orders" className="text-xs text-muted hover:text-brand-600">← Purchase Orders</Link>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={po.status} /> {late && <Badge tone="danger">Delivery overdue</Badge>}
            <Link href={`/vendors/${po.vendorId}`} className="link">{po.vendor.name}</Link> · {inr(num(po.total), false)} · {po.project.name}
            {po.rfq && <> · <Link href={`/rfqs/${po.rfq.id}`} className="link">{po.rfq.number}</Link></>}
          </span>
        }
        actions={
          <PoActions
            po={forForms}
            status={po.status}
            pdfUrl={po.pdfKey ? signedUrl(po.pdfKey, 3600, `${po.number}.pdf`) : null}
            canManage={canManage}
            canReceive={can(user, "receiveGoods")}
            returns={po.returnRequests.map((r) => ({ id: r.id, status: r.status }))}
          />
        }
      />
      <Card bodyClassName="py-3"><Stepper current={stage} /></Card>

      {vendorLink && !["CLOSED", "CANCELLED"].includes(po.status) && (
        <VendorLinkBox
          title="Vendor PO link"
          description={`${po.vendor.name} uses this link to accept the PO, request a change and post dispatch details. Valid until ${fmtDate(po.tokenExpiresAt)}.`}
          link={vendorLink}
          whatsappUrl={po.vendor.whatsapp || po.vendor.phone ? whatsappShareUrl(po.vendor.whatsapp ?? po.vendor.phone, `NYATI Purchase Order ${po.number}: please accept and share dispatch details here: ${vendorLink}`) : null}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Order lines" className="xl:col-span-2" bodyClassName="p-0">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Item</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th><th className="th text-right">Accepted</th><th className="th text-right">Rate</th><th className="th text-right">GST</th><th className="th text-right">Amount</th></tr></thead>
            <tbody>
              {po.items.map((i) => (
                <tr key={i.id}>
                  <td className="td">{i.description}<div className="text-xs text-muted">HSN {i.material.hsnCode ?? "—"}</div></td>
                  <td className="td text-right">{qty(num(i.quantity), i.unit)}</td>
                  <td className="td text-right">{qty(num(i.receivedQty), i.unit)}</td>
                  <td className="td text-right">{qty(num(i.acceptedQty), i.unit)}</td>
                  <td className="td text-right">{inr(num(i.unitRate))}</td>
                  <td className="td text-right">{num(i.gstPercent)}%</td>
                  <td className="td text-right">{inr(num(i.amount), false)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <tr><td colSpan={6} className="td text-right text-muted">GST</td><td className="td text-right">{inr(num(po.gstTotal), false)}</td></tr>
              <tr><td colSpan={6} className="td text-right text-muted">Freight & other charges</td><td className="td text-right">{inr(num(po.freight) + num(po.otherCharges), false)}</td></tr>
              <tr><td colSpan={6} className="td text-right font-semibold">Total</td><td className="td text-right font-semibold">{inr(num(po.total), false)}</td></tr>
            </tfoot>
          </table>
        </Card>
        <Card title="Terms & delivery">
          <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Need by</dt><dd>{fmtDate(po.expectedDeliveryDate)}</dd>
            <dt className="text-muted">Vendor promised</dt><dd>{fmtDate(po.promisedDeliveryDate)}</dd>
            <dt className="text-muted">Deliver to</dt><dd>{po.deliveryAddress}</dd>
            <dt className="text-muted">Payment terms</dt><dd>{po.paymentTerms} ({po.creditDays} days)</dd>
            <dt className="text-muted">Sent</dt><dd>{fmtDateTime(po.sentAt)}</dd>
            <dt className="text-muted">Accepted</dt><dd>{fmtDateTime(po.acceptedAt)}</dd>
            {po.changeRequestNote && (<><dt className="text-muted">Change request</dt><dd className="text-warning">{po.changeRequestNote}</dd></>)}
            {po.quotationVersion && (<><dt className="text-muted">Quotation</dt><dd>{po.quotationVersion.quotation.referenceNo} v{po.quotationVersion.versionNo}</dd></>)}
            {po.approvalRequest && (<><dt className="text-muted">Approved by</dt><dd>{po.approvalRequest.steps.filter((s) => s.status === "APPROVED").map((s) => s.approver?.name).join(", ")}</dd></>)}
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Delivery tracking">
          <ol className="space-y-2">
            {po.deliveryUpdates.map((d) => (
              <li key={d.id} className="flex gap-3 text-sm">
                <StatusBadge status={d.status} />
                <div>
                  <div>{[d.vehicleNo && `Vehicle ${d.vehicleNo}`, d.driverName && `Driver ${d.driverName}`, d.driverPhone].filter(Boolean).join(" · ") || d.note || "Update"}</div>
                  <div className="text-xs text-muted">{d.source === "VENDOR" ? "Vendor" : "Buyer"} · {fmtDateTime(d.createdAt)}{d.eta && ` · ETA ${fmtDateTime(d.eta)}`}{d.note && d.vehicleNo ? ` · ${d.note}` : ""}</div>
                </div>
              </li>
            ))}
          </ol>
          {!po.deliveryUpdates.length && <p className="text-sm text-muted">No dispatch updates yet. The vendor can post them from the PO link.</p>}
        </Card>
        <Card title={`Goods receipts (${po.grns.length})`}>
          {po.grns.map((g) => (
            <div key={g.id} className="mb-3 rounded-lg border border-border p-3 text-sm last:mb-0">
              <div className="flex flex-wrap justify-between gap-2"><strong>{g.number}</strong><span className="text-xs text-muted">{fmtDateTime(g.receivedAt)} · {g.receivedBy?.name}</span></div>
              {g.items.map((i) => (
                <div key={i.id} className="text-xs">Delivered {num(i.deliveredQty)} · accepted {num(i.acceptedQty)}{num(i.rejectedQty) > 0 && <span className="text-danger"> · rejected {num(i.rejectedQty)} ({i.rejectionReason})</span>}</div>
              ))}
              {g.qualityCheck && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={g.qualityCheck.specMatch ? "success" : "danger"}>Spec {g.qualityCheck.specMatch ? "OK" : "mismatch"}</Badge>
                  <Badge tone={g.qualityCheck.noDamage ? "success" : "danger"}>{g.qualityCheck.noDamage ? "No damage" : "Damage"}</Badge>
                  <Badge tone={g.qualityCheck.packagingOk ? "success" : "warning"}>Packaging</Badge>
                  <Badge tone={g.qualityCheck.testCertProvided ? "success" : "warning"}>Test cert {g.qualityCheck.testCertProvided ? "✓" : "missing"}</Badge>
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {g.challanNo && <span>Challan {g.challanNo}</span>}
                {g.challanKey && <a className="link" href={signedUrl(g.challanKey, 3600)} target="_blank" rel="noreferrer">challan</a>}
                {g.qualityCheck?.certKey && <a className="link" href={signedUrl(g.qualityCheck.certKey, 3600)} target="_blank" rel="noreferrer">certificate</a>}
                {g.qualityCheck?.photoKeys.map((k, i) => <a key={k} className="link" href={signedUrl(k, 3600)} target="_blank" rel="noreferrer">photo {i + 1}</a>)}
              </div>
            </div>
          ))}
          {!po.grns.length && <EmptyState title="Nothing received yet" />}
          {po.returnRequests.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 text-xs font-semibold text-brand-800">Return / replacement requests</div>
              {po.returnRequests.map((r) => <div key={r.id} className="text-sm">{qty(num(r.qty), r.material.unit)} {r.material.name} — {r.reason} <StatusBadge status={r.status} /></div>)}
            </div>
          )}
        </Card>
        <Card title="Vendor rating for this order">
          {po.rating ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3"><Stars value={po.rating.stars} size={18} /><span className="text-sm text-muted">{po.rating.totalScore}/100 · computed automatically on closure</span></div>
              <RatingBreakdown criteria={po.rating.criteria.map((c) => ({ key: c.key, score: c.finalScore, weight: c.weight }))} />
              {po.rating.feedback && <p className="text-sm">“{po.rating.feedback}”</p>}
              <Link href="/vendor-ratings" className="link text-sm">Adjust in Vendor Ratings →</Link>
            </div>
          ) : (
            <p className="text-sm text-muted">The 5-pointer rating is computed when the order closes — as soon as the full quantity has been received and accepted at GRN.</p>
          )}
          {numOrNull(po.vendor.overallRating) !== null && <p className="mt-3 text-xs text-muted">Vendor overall: {num(po.vendor.overallRating).toFixed(2)}★ across {po.vendor.completedOrders} orders.</p>}
        </Card>
      </div>
    </div>
  );
}
