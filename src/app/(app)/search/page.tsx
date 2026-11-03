import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { accessibleProjects } from "@/lib/project-context";
import { db, notDeleted } from "@/lib/db";
import { num, inr, fmtDate } from "@/lib/utils";
import { Card, PageHeader, StatusBadge, EmptyState } from "@/components/ui/misc";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser();
  const q = (searchParams.q ?? "").trim();
  if (q.length < 2) return <EmptyState title="Type at least 2 characters" />;
  const projectIds = (await accessibleProjects(user)).map((p) => p.id);
  const contains = { contains: q, mode: "insensitive" as const };
  const [materials, vendors, rfqs, pos] = await Promise.all([
    db.material.findMany({ where: { deletedAt: notDeleted, OR: [{ name: contains }, { code: contains }, { spec: contains }] }, include: { category: true }, take: 10 }),
    db.vendor.findMany({ where: { deletedAt: notDeleted, OR: [{ name: contains }, { city: contains }, { gstin: contains }, { contactPerson: contains }] }, take: 10 }),
    db.rFQ.findMany({ where: { projectId: { in: projectIds }, OR: [{ number: contains }, { items: { some: { material: { name: contains } } } }] }, include: { items: { include: { material: true } }, project: true }, take: 10, orderBy: { createdAt: "desc" } }),
    db.purchaseOrder.findMany({ where: { projectId: { in: projectIds }, OR: [{ number: contains }, { vendor: { name: contains } }] }, include: { vendor: true, project: true }, take: 10, orderBy: { createdAt: "desc" } }),
  ]);
  const none = !materials.length && !vendors.length && !rfqs.length && !pos.length;
  return (
    <div className="space-y-4">
      <PageHeader title={`Results for “${q}”`} />
      {none && <EmptyState title="No results" description="Try a material name, vendor, GSTIN, RFQ or PO number." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {materials.length > 0 && (
          <Card title="Materials">
            <ul className="divide-y divide-border text-sm">{materials.map((m) => <li key={m.id} className="py-2"><Link href={`/procurement`} className="link">{m.name}</Link> <span className="text-xs text-muted">{m.code} · {m.category.name}</span></li>)}</ul>
          </Card>
        )}
        {vendors.length > 0 && (
          <Card title="Vendors">
            <ul className="divide-y divide-border text-sm">{vendors.map((v) => <li key={v.id} className="py-2"><Link href={`/vendors/${v.id}`} className="link">{v.name}</Link> <span className="text-xs text-muted">{v.city} · {v.gstin}</span></li>)}</ul>
          </Card>
        )}
        {rfqs.length > 0 && (
          <Card title="RFQs">
            <ul className="divide-y divide-border text-sm">{rfqs.map((r) => <li key={r.id} className="flex items-center gap-2 py-2"><Link href={`/rfqs/${r.id}`} className="link">{r.number}</Link> <span className="text-xs text-muted">{r.items[0]?.material.name} · {r.project.code} · {fmtDate(r.createdAt)}</span> <StatusBadge status={r.status} /></li>)}</ul>
          </Card>
        )}
        {pos.length > 0 && (
          <Card title="Purchase orders">
            <ul className="divide-y divide-border text-sm">{pos.map((p) => <li key={p.id} className="flex items-center gap-2 py-2"><Link href={`/purchase-orders/${p.id}`} className="link">{p.number}</Link> <span className="text-xs text-muted">{p.vendor.name} · {inr(num(p.total), false)}</span> <StatusBadge status={p.status} /></li>)}</ul>
          </Card>
        )}
      </div>
    </div>
  );
}
