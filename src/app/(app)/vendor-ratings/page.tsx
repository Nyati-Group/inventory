import { requireUser, can } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db } from "@/lib/db";
import { numOrNull } from "@/lib/utils";
import { ratingGrade } from "@/lib/engine/rating";
import { getSettings } from "@/lib/settings";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { RatingsView } from "./ratings-view";

export const metadata = { title: "Vendor Ratings" };

export default async function VendorRatingsPage() {
  const user = await requireUser();
  const { project } = await currentProject(user);
  if (!project) return <EmptyState title="No project selected" />;
  const [ratings, book, settings] = await Promise.all([
    db.vendorRating.findMany({
      include: { criteria: true, vendor: { select: { id: true, name: true, overallRating: true, completedOrders: true, status: true } }, po: { select: { id: true, number: true } }, project: { select: { id: true, code: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.projectVendor.findMany({ where: { projectId: project.id }, select: { vendorId: true, rating: true, ratedOrders: true } }),
    getSettings(),
  ]);

  const byVendor = new Map<string, typeof ratings>();
  for (const r of ratings) byVendor.set(r.vendorId, [...(byVendor.get(r.vendorId) ?? []), r]);

  const league = [...byVendor.entries()].map(([vendorId, rs]) => {
    const v = rs[0].vendor;
    const pv = book.find((b) => b.vendorId === vendorId);
    const overall = numOrNull(v.overallRating);
    const avg = (key: string, list = rs) => {
      const xs = list.flatMap((r) => r.criteria.filter((c) => c.key === key).map((c) => c.finalScore));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    const keys = ["PRICE", "DELIVERY", "QUALITY", "RESPONSIVENESS", "COMPLIANCE"];
    return {
      vendorId,
      name: v.name,
      status: v.status,
      overall,
      completedOrders: v.completedOrders,
      projectRating: pv?.ratedOrders ? numOrNull(pv.rating) : null,
      projectOrders: pv?.ratedOrders ?? 0,
      inProject: !!pv,
      grade: ratingGrade(overall, v.completedOrders),
      criteria: keys.map((k) => ({ key: k, score: avg(k) })),
      projectCriteria: keys.map((k) => ({ key: k, score: avg(k, rs.filter((r) => r.projectId === project.id)) })),
      onTime: (() => { const d = rs.flatMap((r) => r.criteria.filter((c) => c.key === "DELIVERY")); return d.length ? (d.filter((c) => c.autoScore >= 99.9).length / d.length) * 100 : null; })(),
      trend: [...rs].reverse().map((r) => ({ date: r.createdAt.toISOString(), stars: r.stars })),
    };
  });

  return (
    <div>
      <PageHeader title="Vendor Ratings" description="Automatic 5-pointer rating on every closed order; rolling rating (recent orders weigh more) feeds RFQ vendor ordering and 20% of the recommendation score." />
      <RatingsView
        projectName={project.name}
        canAdjust={can(user, "manageVendors")}
        weights={settings.ratingWeights}
        league={league}
        orders={ratings.map((r) => ({
          id: r.id,
          vendorId: r.vendorId,
          vendor: r.vendor.name,
          poId: r.po.id,
          poNumber: r.po.number,
          project: r.project.code,
          projectId: r.projectId,
          date: r.createdAt.toISOString(),
          stars: r.stars,
          totalScore: r.totalScore,
          adjusted: !!r.overriddenById,
          feedback: r.feedback,
          criteria: r.criteria.map((c) => ({ key: c.key, weight: c.weight, autoScore: c.autoScore, adjustment: c.adjustment, finalScore: c.finalScore, comment: c.comment })),
        }))}
      />
    </div>
  );
}
