import { requireUser, can } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db } from "@/lib/db";
import { num } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { DeliveriesView } from "./deliveries-view";

export const metadata = { title: "Deliveries & GRN" };

export default async function DeliveriesPage() {
  const user = await requireUser();
  const { project } = await currentProject(user);
  if (!project) return <EmptyState title="No project selected" />;
  const [incoming, grns, returns] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { projectId: project.id, status: { in: ["APPROVED", "SENT", "ACCEPTED", "CHANGE_REQUESTED", "PARTIALLY_DELIVERED"] } },
      include: { vendor: { select: { name: true } }, items: true, deliveryUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { expectedDeliveryDate: "asc" },
    }),
    db.gRN.findMany({ where: { projectId: project.id }, include: { po: { include: { vendor: { select: { name: true } } } }, items: { include: { material: true } }, qualityCheck: true }, orderBy: { receivedAt: "desc" } }),
    db.returnRequest.findMany({ where: { po: { projectId: project.id } }, include: { material: true, vendor: { select: { name: true } }, po: { select: { number: true, id: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Deliveries & GRN" description="Expected vs actual deliveries, goods receipt & inspection, returns." />
      <DeliveriesView
        canReceive={can(user, "receiveGoods")}
        incoming={incoming.map((p) => {
          const promised = p.promisedDeliveryDate ?? p.expectedDeliveryDate;
          const last = p.deliveryUpdates[0];
          return {
            po: {
              id: p.id,
              number: p.number,
              vendor: p.vendor.name,
              freight: num(p.freight) + num(p.otherCharges),
              items: p.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, quantity: num(i.quantity), acceptedQty: num(i.acceptedQty), receivedQty: num(i.receivedQty), unitRate: num(i.unitRate), gstPercent: num(i.gstPercent) })),
            },
            status: p.status,
            promised: promised.toISOString(),
            eta: last?.eta?.toISOString() ?? null,
            lastUpdate: last ? `${last.status.replace("_", " ").toLowerCase()}${last.vehicleNo ? ` · ${last.vehicleNo}` : ""}` : null,
            late: promised < new Date(),
          };
        })}
        grns={grns.map((g) => ({
          id: g.id,
          number: g.number,
          poId: g.poId,
          poNumber: g.po.number,
          vendor: g.po.vendor.name,
          material: g.items[0]?.material.name ?? "",
          unit: g.items[0]?.material.unit ?? "",
          delivered: g.items.reduce((s, i) => s + num(i.deliveredQty), 0),
          accepted: g.items.reduce((s, i) => s + num(i.acceptedQty), 0),
          rejected: g.items.reduce((s, i) => s + num(i.rejectedQty), 0),
          qcOk: !!g.qualityCheck && g.qualityCheck.specMatch && g.qualityCheck.noDamage,
          receivedAt: g.receivedAt.toISOString(),
        }))}
        returns={returns.map((r) => ({ id: r.id, poId: r.po.id, poNumber: r.po.number, vendor: r.vendor.name, material: r.material.name, qty: num(r.qty), unit: r.material.unit, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() }))}
      />
    </div>
  );
}
