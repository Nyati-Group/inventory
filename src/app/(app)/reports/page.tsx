import { requireUser } from "@/lib/auth";
import { currentProject, accessibleProjects } from "@/lib/project-context";
import { db, notDeleted } from "@/lib/db";
import { num } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ReportsView } from "./reports-view";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: { scope?: string; months?: string } }) {
  const user = await requireUser();
  const { project } = await currentProject(user);
  if (!project) return <EmptyState title="No project selected" />;
  const all = searchParams.scope === "all";
  const months = Number(searchParams.months ?? 12);
  const since = new Date(Date.now() - months * 30 * 86_400_000);
  const projectIds = all ? (await accessibleProjects(user)).map((p) => p.id) : [project.id];

  const [pos, runs, rfqVendors, history, grns, materials] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { projectId: { in: projectIds }, status: { not: "CANCELLED" }, createdAt: { gte: since } },
      include: { vendor: { select: { name: true } }, project: { select: { code: true } }, items: { include: { material: { include: { category: true } } } } },
    }),
    db.purchaseOrder.findMany({
      where: { projectId: { in: projectIds }, status: { not: "CANCELLED" }, rfqId: { isSet: true }, createdAt: { gte: since } },
      select: { number: true, total: true, vendorId: true, vendor: { select: { name: true } }, rfq: { select: { number: true, comparisonRuns: { where: { isLatest: true }, select: { recommendedVendorId: true, scores: { select: { landedCost: true, vendorId: true } } } } } } },
    }),
    db.rFQVendor.findMany({ where: { rfq: { projectId: { in: projectIds }, createdAt: { gte: since } } }, include: { vendor: { select: { name: true } }, quotation: { select: { versions: { select: { submittedAt: true }, orderBy: { versionNo: "asc" }, take: 1 } } } } }),
    db.rateHistory.findMany({ where: { projectId: { in: projectIds }, date: { gte: since } }, select: { materialId: true, date: true, rate: true } }),
    db.gRN.findMany({ where: { projectId: { in: projectIds }, receivedAt: { gte: since } }, include: { po: { select: { number: true, promisedDeliveryDate: true, expectedDeliveryDate: true, vendor: { select: { name: true } } } } } }),
    db.material.findMany({ where: { deletedAt: notDeleted }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } }),
  ]);

  const sumBy = (key: (p: (typeof pos)[number]) => string) => {
    const m = new Map<string, number>();
    for (const p of pos) m.set(key(p), (m.get(key(p)) ?? 0) + num(p.total));
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const savings = runs
    .map((r) => {
      const scores = r.rfq?.comparisonRuns[0]?.scores ?? [];
      if (scores.length < 2) return null;
      const landed = scores.map((s) => num(s.landedCost));
      const awarded = scores.find((s) => s.vendorId === r.vendorId);
      const awardedLanded = awarded ? num(awarded.landedCost) : num(r.total);
      return {
        po: r.number,
        rfq: r.rfq!.number,
        vendor: r.vendor.name,
        followedRecommendation: r.rfq!.comparisonRuns[0]?.recommendedVendorId === r.vendorId,
        awarded: awardedLanded,
        highest: Math.max(...landed),
        average: landed.reduce((a, b) => a + b, 0) / landed.length,
        savingVsHighest: Math.max(...landed) - awardedLanded,
        savingVsAverage: landed.reduce((a, b) => a + b, 0) / landed.length - awardedLanded,
      };
    })
    .filter(Boolean) as { po: string; rfq: string; vendor: string; followedRecommendation: boolean; awarded: number; highest: number; average: number; savingVsHighest: number; savingVsAverage: number }[];

  const respMap = new Map<string, { vendor: string; invited: number; responded: number; declined: number; hours: number[] }>();
  for (const rv of rfqVendors) {
    const e = respMap.get(rv.vendorId) ?? { vendor: rv.vendor.name, invited: 0, responded: 0, declined: 0, hours: [] };
    e.invited++;
    if (rv.status === "RESPONDED") e.responded++;
    if (rv.status === "DECLINED") e.declined++;
    const first = rv.quotation?.versions[0]?.submittedAt;
    if (first && rv.sentAt) e.hours.push((first.getTime() - rv.sentAt.getTime()) / 3600_000);
    respMap.set(rv.vendorId, e);
  }

  const delays = grns.map((g) => {
    const promised = g.po.promisedDeliveryDate ?? g.po.expectedDeliveryDate;
    return { grn: g.number, po: g.po.number, vendor: g.po.vendor.name, promised: promised.toISOString(), received: g.receivedAt.toISOString(), daysLate: Math.max(0, Math.ceil((g.receivedAt.getTime() - promised.getTime()) / 86_400_000)) };
  });

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const trend: Record<string, { month: string; avg: number }[]> = {};
  const groups = new Map<string, Map<string, number[]>>();
  for (const h of history) {
    const g = groups.get(h.materialId) ?? new Map<string, number[]>();
    const k = monthKey(h.date);
    g.set(k, [...(g.get(k) ?? []), num(h.rate)]);
    groups.set(h.materialId, g);
  }
  for (const [mid, g] of groups) trend[mid] = [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rs]) => ({ month, avg: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100 }));

  const monthly = new Map<string, number>();
  for (const p of pos) monthly.set(monthKey(p.createdAt), (monthly.get(monthKey(p.createdAt)) ?? 0) + num(p.total));

  return (
    <div>
      <PageHeader title="Reports" description={`${all ? "All projects" : project.name} · last ${months} months. Every table exports to CSV; use Print / PDF for a PDF copy.`} />
      <ReportsView
        scope={all ? "all" : "project"}
        months={months}
        spendByVendor={sumBy((p) => p.vendor.name)}
        spendByMaterial={sumBy((p) => p.items[0]?.material.name ?? "—")}
        spendByCategory={sumBy((p) => p.items[0]?.material.category.name ?? "—")}
        spendByProject={sumBy((p) => p.project.code)}
        spendByMonth={[...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value }))}
        savings={savings}
        response={[...respMap.values()].map((e) => ({ vendor: e.vendor, invited: e.invited, responded: e.responded, declined: e.declined, rate: e.invited ? (e.responded / e.invited) * 100 : 0, avgHours: e.hours.length ? e.hours.reduce((a, b) => a + b, 0) / e.hours.length : null }))}
        delays={delays}
        materials={materials.filter((m) => trend[m.id]?.length)}
        trend={trend}
      />
    </div>
  );
}
