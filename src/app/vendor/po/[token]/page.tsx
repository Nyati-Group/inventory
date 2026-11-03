import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { signedUrl } from "@/lib/storage";
import { num, inr, qty, fmtDate, fmtDateTime } from "@/lib/utils";
import { Card, StatusBadge } from "@/components/ui/misc";
import { VendorPoForms } from "./po-forms";

export const dynamic = "force-dynamic";

export default async function VendorPoPage({ params }: { params: { token: string } }) {
  const po =
    params.token.length >= 20
      ? await db.purchaseOrder.findFirst({
          where: { vendorTokenHash: hashToken(params.token) },
          include: { vendor: true, project: true, items: true, deliveryUpdates: { orderBy: { createdAt: "desc" } } },
        })
      : null;
  if (!po || (po.tokenExpiresAt && po.tokenExpiresAt < new Date()))
    return <div className="card mx-auto max-w-lg p-8 text-center"><h1 className="text-lg font-semibold">Link not valid</h1><p className="mt-2 text-sm text-muted">Please use the exact link from the purchase order email.</p></div>;
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Purchase order</div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">{po.number} <StatusBadge status={po.status} /></h1>
        <p className="text-sm text-muted">For {po.vendor.name}</p>
      </div>
      <Card title="Order" actions={po.pdfKey && <a className="link text-sm" href={signedUrl(po.pdfKey, 7 * 86400, `${po.number}.pdf`)} target="_blank" rel="noreferrer">Download PO PDF</a>}>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Amount</th></tr></thead>
          <tbody>{po.items.map((i) => <tr key={i.id}><td className="td">{i.description}</td><td className="td text-right">{qty(num(i.quantity), i.unit)}</td><td className="td text-right">{inr(num(i.unitRate))}</td><td className="td text-right">{inr(num(i.amount), false)}</td></tr>)}</tbody>
        </table>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Order total (incl. GST & freight)</dt><dd className="font-semibold">{inr(num(po.total))}</dd></div>
          <div><dt className="text-xs text-muted">Deliver by</dt><dd>{fmtDate(po.promisedDeliveryDate ?? po.expectedDeliveryDate)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted">Delivery address</dt><dd>{po.deliveryAddress}</dd></div>
          {po.project.receivingHours && <div><dt className="text-xs text-muted">Receiving hours</dt><dd>{po.project.receivingHours}</dd></div>}
          {po.project.siteContactName && <div><dt className="text-xs text-muted">Site contact</dt><dd>{po.project.siteContactName} {po.project.siteContactPhone}</dd></div>}
          <div><dt className="text-xs text-muted">Payment terms</dt><dd>{po.paymentTerms}</dd></div>
        </dl>
      </Card>
      <VendorPoForms token={params.token} status={po.status} />
      {po.deliveryUpdates.length > 0 && (
        <Card title="Updates">
          <ul className="space-y-1 text-sm">{po.deliveryUpdates.map((d) => <li key={d.id}><StatusBadge status={d.status} /> {fmtDateTime(d.createdAt)} {d.vehicleNo && `· ${d.vehicleNo}`} {d.eta && `· ETA ${fmtDateTime(d.eta)}`} {d.note && `· ${d.note}`}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
