import { headers } from "next/headers";
import { rfqVendorByToken, portalState, recordOpen } from "@/lib/services/vendor-portal";
import { signedUrl } from "@/lib/storage";
import { num, qty, fmtDate, fmtDateTime } from "@/lib/utils";
import { Card, StatusBadge, Badge } from "@/components/ui/misc";
import { VendorQuoteForm } from "./quote-form";

export const dynamic = "force-dynamic";

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

export default async function VendorRfqPage({ params }: { params: { token: string } }) {
  const rv = await rfqVendorByToken(params.token);
  if (!rv) return <Notice title="Link not valid" body="This quotation link is not valid. Please use the exact link from the RFQ email, or contact the NYATI procurement team." />;
  const h = headers();
  await recordOpen(rv.id, h.get("x-forwarded-for")?.split(",")[0] ?? null, h.get("user-agent"));
  const state = portalState(rv);
  const item = rv.rfq.items[0];
  const attachments = (rv.rfq.attachments as { name: string; key: string }[]) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Request for quotation</div>
        <h1 className="text-xl font-semibold">{rv.rfq.number}</h1>
        <p className="text-sm text-muted">For {rv.vendor.name}</p>
      </div>
      <Card title="Requirement">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Material</dt><dd className="font-semibold text-brand-800">{item.material.name}</dd></div>
          <div><dt className="text-xs text-muted">Specification</dt><dd>{item.spec ?? item.material.spec ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Quantity</dt><dd className="font-semibold">{qty(num(item.quantity), item.unit)}</dd></div>
          <div><dt className="text-xs text-muted">Required delivery date</dt><dd>{fmtDate(rv.rfq.expectedDeliveryDate)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted">Delivery address</dt><dd>{rv.rfq.deliveryAddress}</dd></div>
          {rv.rfq.project.receivingHours && <div><dt className="text-xs text-muted">Receiving hours</dt><dd>{rv.rfq.project.receivingHours}</dd></div>}
          {rv.rfq.project.unloadingConstraints && <div><dt className="text-xs text-muted">Unloading constraints</dt><dd>{rv.rfq.project.unloadingConstraints}</dd></div>}
          {rv.rfq.paymentTermsPref && <div><dt className="text-xs text-muted">Preferred payment terms</dt><dd>{rv.rfq.paymentTermsPref}</dd></div>}
          {rv.rfq.notes && <div className="sm:col-span-2"><dt className="text-xs text-muted">Notes</dt><dd>{rv.rfq.notes}</dd></div>}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
          <span>Deadline: <strong>{fmtDateTime(rv.deadline)}</strong></span>
          {state === "open" && <Countdown deadline={rv.deadline.toISOString()} />}
          {rv.rfq.pdfKey && <a className="link" href={signedUrl(rv.rfq.pdfKey, 7 * 86400, `${rv.rfq.number}.pdf`)} target="_blank" rel="noreferrer">Download RFQ PDF</a>}
          {attachments.map((a) => <a key={a.key} className="link" href={signedUrl(a.key, 7 * 86400, a.name)} target="_blank" rel="noreferrer">{a.name}</a>)}
        </div>
      </Card>

      {rv.quotation && rv.quotation.versions.length > 0 && (
        <Card title={`Your submissions — reference ${rv.quotation.referenceNo}`}>
          <ul className="space-y-1 text-sm">
            {rv.quotation.versions.map((v, i) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <strong>Version {v.versionNo}</strong> · {fmtDateTime(v.submittedAt)} · {v.method.toLowerCase()} {i === 0 && <Badge tone="success">active</Badge>}
                {v.documents.map((d) => <span key={d.id} className="text-xs text-muted">{d.fileName}</span>)}
              </li>
            ))}
          </ul>
          {state === "open" && <p className="mt-2 text-xs text-muted">You can submit a revised quotation below until the deadline. The latest version is the one evaluated.</p>}
        </Card>
      )}

      {state === "open" ? (
        <VendorQuoteForm token={params.token} unit={item.unit} quantity={num(item.quantity)} isRevision={!!rv.quotation?.versions.length} />
      ) : state === "declined" ? (
        <Notice title="You declined this RFQ" body={`Reason: ${rv.declineReason ?? "—"}. Thank you for letting us know.`} />
      ) : state === "expired" ? (
        <Notice title="The deadline has passed" body="This RFQ is no longer accepting quotations. If you need more time, please contact the NYATI procurement team." />
      ) : (
        <Notice title="This RFQ is closed" body="Quotation collection for this request has ended. Thank you for your interest." />
      )}
      <p className="text-center text-xs text-muted">Status: <StatusBadge status={rv.status} /></p>
    </div>
  );
}

function Countdown({ deadline }: { deadline: string }) {
  const ms = new Date(deadline).getTime() - Date.now();
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return <Badge tone={h < 6 ? "warning" : "brand"}>{h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h left` : `${h} h ${m} min left`}</Badge>;
}
