import { db } from "../db";
import { num } from "../utils";

export async function projectDashboard(projectId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  const ninety = new Date(now.getTime() - 90 * 86_400_000);

  const [monthPos, openRfqs, pendingApprovals, dueDeliveries, lateDeliveries, stocks, ordered] = await Promise.all([
    db.purchaseOrder.findMany({ where: { projectId, createdAt: { gte: monthStart }, status: { not: "CANCELLED" } }, select: { total: true } }),
    db.rFQ.count({ where: { projectId, status: { in: ["SENT", "PARTIALLY_RESPONDED", "CLOSED"] } } }),
    db.approvalRequest.count({ where: { projectId, status: "PENDING" } }),
    db.purchaseOrder.count({ where: { projectId, status: { in: ["APPROVED", "SENT", "ACCEPTED", "PARTIALLY_DELIVERED"] }, expectedDeliveryDate: { lte: weekAhead } } }),
    db.purchaseOrder.count({ where: { projectId, status: { in: ["SENT", "ACCEPTED", "CHANGE_REQUESTED", "PARTIALLY_DELIVERED"] }, expectedDeliveryDate: { lt: now } } }),
    db.materialProjectStock.findMany({ where: { projectId }, select: { currentQty: true, reorderLevel: true } }),
    db.purchaseOrder.findMany({
      where: { projectId, createdAt: { gte: ninety }, rfqId: { isSet: true }, status: { not: "CANCELLED" } },
      select: { vendorId: true, total: true, rfq: { select: { comparisonRuns: { where: { isLatest: true }, select: { scores: { select: { landedCost: true } } } } } } },
    }),
  ]);

  let savings = 0;
  for (const po of ordered) {
    const scores = po.rfq?.comparisonRuns[0]?.scores ?? [];
    if (scores.length < 2) continue;
    const avg = scores.reduce((s, x) => s + num(x.landedCost), 0) / scores.length;
    savings += Math.max(0, avg - num(po.total));
  }

  return {
    spendThisMonth: monthPos.reduce((s, p) => s + num(p.total), 0),
    savings90d: savings,
    openRfqs,
    pendingApprovals,
    dueDeliveries,
    lateDeliveries,
    lowStock: stocks.filter((s) => num(s.reorderLevel) > 0 && num(s.currentQty) <= num(s.reorderLevel)).length,
    totalMaterials: stocks.length,
  };
}
