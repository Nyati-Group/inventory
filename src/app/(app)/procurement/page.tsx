import { requireUser, can } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db, notDeleted } from "@/lib/db";
import { num, inrCompact } from "@/lib/utils";
import { projectDashboard } from "@/lib/services/dashboard";
import { Kpi, EmptyState } from "@/components/ui/misc";
import { ProcurementTable, type MaterialRow } from "./procurement-table";

export const metadata = { title: "Procurement" };

export default async function ProcurementPage({ searchParams }: { searchParams: { lowStock?: string } }) {
  const user = await requireUser();
  const { project } = await currentProject(user);
  if (!project) return <EmptyState title="No project selected" description="Create a project from the project selector to get started." />;

  const [stocks, categories, openRfqItems, requests, dash] = await Promise.all([
    db.materialProjectStock.findMany({
      where: { projectId: project.id, material: { deletedAt: notDeleted } },
      include: { material: { include: { category: true } } },
      orderBy: { material: { name: "asc" } },
    }),
    db.materialCategory.findMany({ orderBy: { name: "asc" } }),
    db.rFQItem.findMany({
      where: { rfq: { projectId: project.id, status: { in: ["SENT", "PARTIALLY_RESPONDED", "CLOSED", "AWAITING_APPROVAL", "APPROVED"] } } },
      select: { materialId: true, rfqId: true, rfq: { select: { number: true } } },
    }),
    db.materialRequest.findMany({ where: { projectId: project.id, status: "OPEN" }, select: { id: true, materialId: true, qty: true, source: true } }),
    projectDashboard(project.id),
  ]);

  const rows: MaterialRow[] = stocks.map((s, i) => {
    const current = num(s.currentQty);
    const reorder = num(s.reorderLevel);
    const openRfq = openRfqItems.find((r) => r.materialId === s.materialId);
    const req = requests.find((r) => r.materialId === s.materialId);
    return {
      sr: i + 1,
      materialId: s.materialId,
      name: s.material.name,
      code: s.material.code,
      spec: s.material.spec,
      category: s.material.category.name,
      categoryId: s.material.categoryId,
      unit: s.material.unit,
      currentQty: current,
      reorderLevel: reorder,
      rate: s.lastRate ? num(s.lastRate) : null,
      rateAt: s.lastRateAt?.toISOString() ?? null,
      status: reorder > 0 && current <= reorder ? "low" : reorder > 0 && current <= reorder * 1.2 ? "soon" : "ok",
      openRfq: openRfq ? { id: openRfq.rfqId, number: openRfq.rfq.number } : null,
      request: req ? { id: req.id, qty: num(req.qty), source: req.source } : null,
    };
  });
  const low = rows.filter((r) => r.status === "low").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Spend this month" value={inrCompact(dash.spendThisMonth)} />
        <Kpi label="Savings vs avg. quote" value={inrCompact(dash.savings90d)} sub="Last 90 days" tone="success" />
        <Kpi label="Open RFQs" value={dash.openRfqs} />
        <Kpi label="Pending approvals" value={dash.pendingApprovals} tone={dash.pendingApprovals ? "warning" : undefined} />
        <Kpi label="Deliveries due (7 days)" value={dash.dueDeliveries} />
        <Kpi label="Late deliveries" value={dash.lateDeliveries} tone={dash.lateDeliveries ? "danger" : undefined} />
        <Kpi label="Low stock" value={low} tone={low ? "danger" : undefined} />
      </div>
      <ProcurementTable
        rows={rows}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        project={{ id: project.id, name: project.name, city: project.city, siteAddress: project.siteAddress, defaultDeadlineHours: project.settings?.defaultDeadlineHours ?? 48 }}
        summary={{ total: rows.length, low, openRfqs: dash.openRfqs, awaitingApproval: dash.pendingApprovals }}
        canRfq={can(user, "manageRfq")}
        canStock={can(user, "manageStock")}
        initialLowOnly={searchParams.lowStock === "1"}
      />
    </div>
  );
}
