import { requireUser } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db } from "@/lib/db";
import { num } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { PoList } from "./po-list";

export const metadata = { title: "Purchase Orders" };

export default async function PurchaseOrdersPage() {
  const user = await requireUser();
  const { project } = await currentProject(user);
  if (!project) return <EmptyState title="No project selected" />;
  const pos = await db.purchaseOrder.findMany({
    where: { projectId: project.id },
    include: { vendor: { select: { name: true } }, items: { include: { material: { select: { name: true } } } }, rfq: { select: { number: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rows = pos.map((p) => ({
    id: p.id,
    number: p.number,
    vendor: p.vendor.name,
    material: p.items[0]?.material.name ?? "",
    quantity: num(p.items[0]?.quantity),
    received: num(p.items[0]?.acceptedQty),
    unit: p.items[0]?.unit ?? "",
    total: num(p.total),
    status: p.status,
    expected: (p.promisedDeliveryDate ?? p.expectedDeliveryDate).toISOString(),
    late: !["DELIVERED", "CLOSED", "CANCELLED"].includes(p.status) && (p.promisedDeliveryDate ?? p.expectedDeliveryDate) < new Date(),
    rfq: p.rfq?.number ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
  return (
    <div>
      <PageHeader title="Purchase Orders" description={`${project.name} — generated from approved quotations. Draft → Approved → Sent → Accepted → Delivered → Closed.`} />
      <PoList rows={rows} />
    </div>
  );
}
