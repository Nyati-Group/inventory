import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { db, notDeleted } from "@/lib/db";
import { num, numOrNull, inr, fmtDate, qty, plain } from "@/lib/utils";
import { ratingGrade } from "@/lib/engine/rating";
import { signedUrl } from "@/lib/storage";
import { Card, Badge, Stars, StatusBadge, PageHeader, Kpi, EmptyState } from "@/components/ui/misc";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RatingBreakdown, RatingSparkline } from "@/components/rating-widgets";
import { VendorActions, VendorDocsUpload, EditVendorButton } from "./vendor-actions";

export default async function VendorProfile({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const v = await db.vendor.findUnique({
    where: { id: params.id },
    include: {
      categories: { include: { category: true } },
      materials: { include: { material: true } },
      documents: { orderBy: { uploadedAt: "desc" } },
      projects: { include: { project: true } },
      rfqVendors: { include: { rfq: { include: { items: { include: { material: true } }, project: true } }, quotation: { include: { activeVersion: true } } }, orderBy: { rfq: { createdAt: "desc" } }, take: 50 },
      purchaseOrders: { include: { project: true, items: true }, orderBy: { createdAt: "desc" }, take: 50 },
      ratings: { include: { criteria: true, po: { select: { number: true } }, project: { select: { code: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!v) notFound();
  const [allCategories, allMaterials] = await Promise.all([
    db.materialCategory.findMany({ orderBy: { name: "asc" } }),
    db.material.findMany({ where: { deletedAt: notDeleted }, select: { id: true, name: true, categoryId: true }, orderBy: { name: "asc" } }),
  ]);
  const rating = numOrNull(v.overallRating);
  const grade = ratingGrade(rating, v.completedOrders);
  const avgCriteria = ["PRICE", "DELIVERY", "QUALITY", "RESPONSIVENESS", "COMPLIANCE"].map((key) => {
    const list = v.ratings.flatMap((r) => r.criteria.filter((c) => c.key === key));
    return { key, score: list.length ? list.reduce((s, c) => s + c.finalScore, 0) / list.length : 0 };
  });
  const responded = v.rfqVendors.filter((r) => r.status === "RESPONDED").length;
  const spend = v.purchaseOrders.filter((p) => p.status !== "CANCELLED").reduce((s, p) => s + num(p.total), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={v.name}
        crumbs={<Link href="/vendors" className="text-xs text-muted hover:text-brand-600">← Vendor directory</Link>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {v.city}{v.state ? `, ${v.state}` : ""} · <StatusBadge status={v.status} /> {v.isPreferred && <Badge tone="success">Preferred</Badge>}
            <Badge tone={grade.tone}>{grade.label}</Badge>
          </span>
        }
        actions={
          can(user, "manageVendors") && (
            <>
              <EditVendorButton
                initial={{ ...plain(v), categoryIds: v.categories.map((c) => c.categoryId), materialIds: v.materials.map((m) => m.materialId) }}
                categories={allCategories.map((c) => ({ id: c.id, name: c.name }))}
                materials={allMaterials}
              />
              <VendorActions vendorId={v.id} status={v.status} />
            </>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Overall rating" value={v.completedOrders < 3 ? "New" : <Stars value={rating} size={16} />} sub={`${v.completedOrders} completed orders`} />
        <Kpi label="Total spend" value={inr(spend, false)} />
        <Kpi label="RFQs invited" value={v.rfqVendors.length} sub={`${responded} responded`} />
        <Kpi label="Lead time" value={`${v.leadTimeDays} days`} sub={`Service radius ${v.serviceRadiusKm} km`} />
        <Kpi label="Payment terms" value={v.paymentTerms ?? "—"} sub={`${v.creditDays} credit days`} />
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="materials">Materials & rates</TabsTrigger>
          <TabsTrigger value="rfqs">RFQ history</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="ratings">Ratings</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Company details">
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <dt className="text-muted">Contact</dt><dd>{v.contactPerson ?? "—"}</dd>
                <dt className="text-muted">Email(s)</dt><dd>{v.emails.join(", ")}</dd>
                <dt className="text-muted">Phone / WhatsApp</dt><dd>{v.phone ?? "—"}{v.whatsapp ? ` / ${v.whatsapp}` : ""}</dd>
                <dt className="text-muted">GSTIN / PAN</dt><dd className="font-mono text-xs">{v.gstin ?? "—"} / {v.pan ?? "—"}</dd>
                <dt className="text-muted">Address</dt><dd>{[v.address, v.city, v.state, v.pincode].filter(Boolean).join(", ")}</dd>
                <dt className="text-muted">Bank</dt><dd>{v.bankName ?? "—"} {v.bankAccountMasked} {v.bankIfsc}</dd>
                <dt className="text-muted">Categories</dt><dd>{v.categories.map((c) => c.category.name).join(", ") || "—"}</dd>
                <dt className="text-muted">Notes</dt><dd>{v.notes ?? "—"}</dd>
              </dl>
            </Card>
            <Card title="Projects (per-project distance & rating)">
              <table className="w-full text-sm">
                <thead><tr><th className="th">Project</th><th className="th text-right">Distance</th><th className="th">Rating here</th><th className="th">Flags</th></tr></thead>
                <tbody>
                  {v.projects.map((pv) => (
                    <tr key={pv.id}>
                      <td className="td">{pv.project.name}<div className="text-xs text-muted">{pv.project.city}</div></td>
                      <td className="td text-right">{pv.distanceKm !== null ? `${Math.round(pv.distanceKm)} km` : "—"}</td>
                      <td className="td">{pv.ratedOrders ? <Stars value={numOrNull(pv.rating)} /> : <span className="text-xs text-muted">No orders</span>}</td>
                      <td className="td">{pv.isBlacklisted && <Badge tone="danger">Blacklisted</Badge>}{pv.isPreferred && <Badge tone="success">Preferred</Badge>}{pv.notes && <div className="text-xs text-muted">{pv.notes}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!v.projects.length && <p className="py-4 text-sm text-muted">Not in any project vendor book yet.</p>}
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="materials">
          <Card>
            <table className="w-full text-sm">
              <thead><tr><th className="th">Material</th><th className="th">Unit</th><th className="th text-right">Last rate</th></tr></thead>
              <tbody>
                {v.materials.map((m) => (
                  <tr key={m.id}><td className="td">{m.material.name}</td><td className="td">{m.material.unit}</td><td className="td text-right">{m.lastRate ? inr(num(m.lastRate)) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
            {!v.materials.length && <EmptyState title="No specific materials" description="This vendor is matched to RFQs by category." />}
          </Card>
        </TabsContent>
        <TabsContent value="rfqs">
          <Card>
            <table className="w-full text-sm">
              <thead><tr><th className="th">RFQ</th><th className="th">Project</th><th className="th">Material</th><th className="th">Sent</th><th className="th">Status</th><th className="th text-right">Quoted landed</th></tr></thead>
              <tbody>
                {v.rfqVendors.map((r) => (
                  <tr key={r.id}>
                    <td className="td"><Link href={`/rfqs/${r.rfqId}`} className="link">{r.rfq.number}</Link></td>
                    <td className="td">{r.rfq.project.code}</td>
                    <td className="td">{r.rfq.items[0]?.material.name}</td>
                    <td className="td">{fmtDate(r.sentAt)}</td>
                    <td className="td"><StatusBadge status={r.status} />{r.declineReason && <div className="text-xs text-muted">{r.declineReason}</div>}</td>
                    <td className="td text-right">{r.quotation?.activeVersion?.landedCost ? inr(num(r.quotation.activeVersion.landedCost), false) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!v.rfqVendors.length && <EmptyState title="No RFQs yet" />}
          </Card>
        </TabsContent>
        <TabsContent value="orders">
          <Card>
            <table className="w-full text-sm">
              <thead><tr><th className="th">PO</th><th className="th">Project</th><th className="th">Date</th><th className="th text-right">Qty</th><th className="th text-right">Value</th><th className="th">Status</th></tr></thead>
              <tbody>
                {v.purchaseOrders.map((p) => (
                  <tr key={p.id}>
                    <td className="td"><Link href={`/purchase-orders/${p.id}`} className="link">{p.number}</Link></td>
                    <td className="td">{p.project.code}</td>
                    <td className="td">{fmtDate(p.createdAt)}</td>
                    <td className="td text-right">{qty(num(p.items[0]?.quantity), p.items[0]?.unit)}</td>
                    <td className="td text-right">{inr(num(p.total), false)}</td>
                    <td className="td"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!v.purchaseOrders.length && <EmptyState title="No orders yet" />}
          </Card>
        </TabsContent>
        <TabsContent value="ratings">
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <Card title="Average by pointer">
              {v.ratings.length ? <RatingBreakdown criteria={avgCriteria} /> : <p className="text-sm text-muted">No completed orders yet.</p>}
              <div className="mt-4 text-xs text-muted">Trend</div>
              <RatingSparkline points={[...v.ratings].reverse().map((r) => ({ date: r.createdAt.toISOString(), stars: r.stars }))} />
            </Card>
            <Card title="Order-by-order">
              <table className="w-full text-sm">
                <thead><tr><th className="th">Date</th><th className="th">PO</th><th className="th">Project</th><th className="th">Stars</th><th className="th">Price</th><th className="th">Delivery</th><th className="th">Quality</th><th className="th">Resp.</th><th className="th">Compl.</th></tr></thead>
                <tbody>
                  {v.ratings.map((r) => {
                    const c = (k: string) => r.criteria.find((x) => x.key === k)?.finalScore ?? 0;
                    return (
                      <tr key={r.id}>
                        <td className="td">{fmtDate(r.createdAt)}</td>
                        <td className="td text-xs">{r.po.number}</td>
                        <td className="td">{r.project.code}</td>
                        <td className="td"><Stars value={r.stars} />{r.overriddenById && <Badge className="ml-1">Adjusted</Badge>}</td>
                        {["PRICE", "DELIVERY", "QUALITY", "RESPONSIVENESS", "COMPLIANCE"].map((k) => <td key={k} className="td tabular-nums">{(c(k) / 20).toFixed(1)}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!v.ratings.length && <EmptyState title="No ratings yet" description="Ratings are computed automatically when an order is closed." />}
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="documents">
          <Card title="Documents" actions={can(user, "manageVendors") && <VendorDocsUpload vendorId={v.id} />}>
            <ul className="divide-y divide-border">
              {v.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                  <span><Badge>{d.type}</Badge> <a className="link" href={signedUrl(d.fileKey, 3600, d.name)} target="_blank" rel="noreferrer">{d.name}</a></span>
                  <span className="text-xs text-muted">{fmtDate(d.uploadedAt)}</span>
                </li>
              ))}
            </ul>
            {!v.documents.length && <EmptyState title="No documents" description="Upload GST certificate, licences, registration, etc." />}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
