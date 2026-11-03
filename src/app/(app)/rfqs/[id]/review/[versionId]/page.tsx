import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { db } from "@/lib/db";
import { num, numOrNull, qty, fmtDate, fmtDateTime } from "@/lib/utils";
import { signedUrl } from "@/lib/storage";
import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/misc";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Review quotation" };

export default async function ReviewPage({ params }: { params: { id: string; versionId: string } }) {
  const user = await requireUser();
  const v = await db.quotationVersion.findUnique({
    where: { id: params.versionId },
    include: { documents: true, quotation: { include: { vendor: true, rfq: { include: { items: { include: { material: true } } } } } } },
  });
  if (!v || v.quotation.rfqId !== params.id) notFound();
  await assertProjectAccess(user, v.quotation.rfq.projectId);
  const rfq = v.quotation.rfq;
  const item = rfq.items[0];
  const doc = v.documents[0];
  const docUrl = doc ? signedUrl(doc.fileKey, 3600, doc.fileName) : null;
  const vendorFields = (v.vendorFields ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Review quotation — ${v.quotation.vendor.name}`}
        crumbs={<Link href={`/rfqs/${rfq.id}?tab=quotations`} className="text-xs text-muted hover:text-brand-600">← {rfq.number}</Link>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            v{v.versionNo} · {v.method.toLowerCase()} · submitted {fmtDateTime(v.submittedAt)} · <StatusBadge status={v.parseStatus} />
            {v.confidence !== null && <Badge tone={v.confidence >= 0.7 ? "success" : "warning"}>confidence {(v.confidence * 100).toFixed(0)}%</Badge>}
            · RFQ: {qty(num(item.quantity), item.unit)} {item.material.name}, need by {fmtDate(rfq.expectedDeliveryDate)}
          </span>
        }
      />
      {v.parseNotes && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{v.parseNotes}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Original document" actions={docUrl && <a href={docUrl} target="_blank" rel="noreferrer" className="link text-sm">Open in new tab</a>} bodyClassName="p-0">
          {doc?.mimeType === "application/pdf" ? (
            <iframe src={docUrl!} title="Original quotation" className="h-[75vh] w-full rounded-b-card" />
          ) : doc?.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={docUrl!} alt="Quotation" className="w-full" />
          ) : (
            <pre className="scrollbar-thin max-h-[75vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">{v.rawText || "No text could be extracted. Download the original to review."}</pre>
          )}
          {Object.keys(vendorFields).length > 0 && (
            <div className="border-t border-border p-4 text-xs">
              <div className="mb-1 font-semibold text-brand-800">Fields typed by vendor in the portal</div>
              <dl className="grid grid-cols-2 gap-1">
                {Object.entries(vendorFields).filter(([, val]) => val !== null && val !== "").map(([k, val]) => (
                  <div key={k}><dt className="inline text-muted">{k}: </dt><dd className="inline">{String(val)}</dd></div>
                ))}
              </dl>
            </div>
          )}
        </Card>
        <Card title="Extracted fields (editable)">
          <ReviewForm
            rfqId={rfq.id}
            unit={item.unit}
            readOnly={!can(user, "manageRfq")}
            initial={{
              versionId: v.id,
              unitRate: numOrNull(v.unitRate),
              quantity: numOrNull(v.quantity) ?? num(item.quantity),
              gstPercent: numOrNull(v.gstPercent) ?? num(item.material.gstPercent),
              freight: num(v.freight),
              loading: num(v.loading),
              otherCharges: num(v.otherCharges),
              statedTotal: numOrNull(v.statedTotal),
              deliveryDate: v.deliveryDate?.toISOString().slice(0, 10) ?? null,
              deliveryDays: v.deliveryDays,
              paymentTerms: v.paymentTerms,
              validityDays: v.validityDays,
              warranty: v.warranty,
              deviations: v.deviations,
            }}
          />
        </Card>
      </div>
    </div>
  );
}
