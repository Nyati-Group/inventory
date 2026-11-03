import { requireUser, can } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db, notDeleted } from "@/lib/db";
import { plain, num } from "@/lib/utils";
import { estimatedDeliveryDays } from "@/lib/engine/geo";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ProjectSettingsView } from "./settings-view";

export const metadata = { title: "Project Settings" };

export default async function ProjectSettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const user = await requireUser();
  const { project } = await currentProject(user);
  if (!project) return <EmptyState title="No project selected" />;
  const [book, allVendors, categories, materials, approvers, rules] = await Promise.all([
    db.projectVendor.findMany({ where: { projectId: project.id }, include: { vendor: { include: { categories: { include: { category: true } } } } }, orderBy: { vendor: { name: "asc" } } }),
    db.vendor.findMany({ where: { deletedAt: notDeleted }, select: { id: true, name: true, city: true }, orderBy: { name: "asc" } }),
    db.materialCategory.findMany({ orderBy: { name: "asc" } }),
    db.material.findMany({ where: { deletedAt: notDeleted }, select: { id: true, name: true, categoryId: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { role: { in: ["APPROVER", "ADMIN"] }, isActive: true }, select: { id: true, name: true, role: true } }),
    db.approvalRule.findMany({ where: { projectId: project.id }, orderBy: { level: "asc" } }),
  ]);

  const vendorRows = book.map((pv) => ({
    vendorId: pv.vendorId,
    name: pv.vendor.name,
    city: pv.vendor.city,
    emails: pv.vendor.emails,
    gstin: pv.vendor.gstin,
    categories: pv.vendor.categories.map((c) => c.category.name),
    distanceKm: pv.distanceKm,
    distanceSource: pv.distanceSource,
    etaDays: estimatedDeliveryDays(pv.vendor.leadTimeDays, pv.transitHours),
    serviceRadiusKm: pv.vendor.serviceRadiusKm,
    rating: pv.ratedOrders >= 1 && pv.rating !== null ? num(pv.rating) : pv.vendor.overallRating !== null ? num(pv.vendor.overallRating) : null,
    projectRated: pv.ratedOrders,
    status: pv.vendor.status,
    isPreferred: pv.isPreferred,
    isBlacklisted: pv.isBlacklisted,
    notes: pv.notes,
  }));

  return (
    <div>
      <PageHeader title="Project Settings" description={`${project.name} (${project.code}) — profile, approvals, scoring and the project vendor book.`} />
      <ProjectSettingsView
        tab={searchParams.tab ?? "profile"}
        project={plain(project)}
        canEdit={can(user, "manageProject")}
        vendors={vendorRows}
        directory={allVendors.filter((v) => !book.some((b) => b.vendorId === v.id))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        materials={materials}
        approvers={approvers}
        rules={rules.map((r) => ({ userId: r.userId, label: r.label, minAmount: num(r.minAmount) }))}
      />
    </div>
  );
}
