import { requireUser } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db } from "@/lib/db";
import { num } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { RfqList } from "./rfq-list";

export const metadata = { title: "RFQs & Quotations" };

export default async function RfqsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const user = await requireUser();
  const { project } = await currentProject(user);
  if (!project) return <EmptyState title="No project selected" />;
  const [rfqs, approvals] = await Promise.all([
    db.rFQ.findMany({
      where: { projectId: project.id },
      include: { items: { include: { material: true } }, vendors: { select: { status: true } }, comparisonRuns: { where: { isLatest: true }, select: { recommendedVendorId: true, scores: { select: { vendorId: true, landedCost: true, rank: true } } } }, quotations: { select: { activeVersion: { select: { parseStatus: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    db.approvalRequest.findMany({
      where: { projectId: project.id, status: "PENDING" },
      include: { rfq: { include: { items: { include: { material: true } } } }, steps: { include: { approver: { select: { name: true, id: true } } }, orderBy: { level: "asc" } }, requestedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const vendorNames = new Map((await db.vendor.findMany({ select: { id: true, name: true } })).map((v) => [v.id, v.name]));

  const rows = rfqs.map((r) => {
    const run = r.comparisonRuns[0];
    const best = run?.scores.find((s) => s.vendorId === run.recommendedVendorId);
    return {
      id: r.id,
      number: r.number,
      material: r.items[0]?.material.name ?? "",
      quantity: num(r.items[0]?.quantity),
      unit: r.items[0]?.unit ?? "",
      status: r.status,
      invited: r.vendors.length,
      responded: r.vendors.filter((v) => v.status === "RESPONDED").length,
      declined: r.vendors.filter((v) => v.status === "DECLINED").length,
      needsReview: r.quotations.filter((q) => q.activeVersion?.parseStatus === "NEEDS_REVIEW").length,
      deadline: r.deadline.toISOString(),
      expected: r.expectedDeliveryDate.toISOString(),
      createdAt: r.createdAt.toISOString(),
      recommended: run?.recommendedVendorId ? vendorNames.get(run.recommendedVendorId) ?? null : null,
      bestLanded: best ? num(best.landedCost) : null,
    };
  });
  const approvalRows = approvals.map((a) => {
    const step = a.steps.find((s) => s.status === "PENDING");
    return {
      id: a.id,
      rfqId: a.rfqId,
      number: a.rfq.number,
      material: a.rfq.items[0]?.material.name ?? "",
      amount: num(a.amount),
      vendor: a.selectedVendorId ? vendorNames.get(a.selectedVendorId) ?? "" : "",
      isRecommended: a.selectedVendorId === a.recommendedVendorId,
      step: step ? `L${step.level} ${step.label} — ${step.approver?.name ?? "unassigned"}` : "",
      mine: step?.approver?.id === user.id || user.role === "ADMIN",
      requestedBy: a.requestedBy?.name ?? "",
      createdAt: a.createdAt.toISOString(),
    };
  });
  return (
    <div>
      <PageHeader title="RFQs & Quotations" description={`${project.name} — track invitations, parsed quotations, comparisons and approvals.`} />
      <RfqList rows={rows} approvals={approvalRows} tab={searchParams.tab ?? "all"} />
    </div>
  );
}
