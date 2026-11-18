import { requireUser, can } from "@/lib/auth";
import { db, notDeleted } from "@/lib/db";
import { numOrNull } from "@/lib/utils";
import { ratingGrade } from "@/lib/engine/rating";
import { PageHeader } from "@/components/ui/misc";
import { currentProject } from "@/lib/project-context";
import { VendorDirectory } from "./directory";
import { BulkUploadButton } from "./bulk-upload";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const user = await requireUser();
  const canEdit = can(user, "manageVendors");
  const [{ project, projects }, vendors, categories, materials] = await Promise.all([
    currentProject(user),
    db.vendor.findMany({
      where: { deletedAt: notDeleted },
      include: { categories: { include: { category: true } }, projects: { select: { projectId: true } } },
      orderBy: { name: "asc" },
    }),
    db.materialCategory.findMany({ orderBy: { name: "asc" } }),
    db.material.findMany({ where: { deletedAt: notDeleted }, select: { id: true, name: true, categoryId: true }, orderBy: { name: "asc" } }),
  ]);
  const rows = vendors.map((v) => {
    const rating = numOrNull(v.overallRating);
    return {
      id: v.id,
      name: v.name,
      contact: v.contactPerson,
      email: v.emails[0] ?? "",
      phone: v.phone,
      city: v.city,
      gstin: v.gstin,
      categories: v.categories.map((c) => c.category.name),
      categoryIds: v.categories.map((c) => c.categoryId),
      rating,
      completedOrders: v.completedOrders,
      grade: ratingGrade(rating, v.completedOrders).label,
      status: v.status,
      projects: v.projects.length,
      preferred: v.isPreferred,
    };
  });
  return (
    <div>
      <PageHeader
        title="Vendor directory"
        description="All vendors across projects. Per-project distance, notes and blacklists live in each project's vendor book."
        actions={canEdit && <BulkUploadButton projects={projects.map((p) => ({ id: p.id, name: p.name }))} currentProjectId={project?.id ?? null} />}
      />
      <VendorDirectory rows={rows} categories={categories.map((c) => ({ id: c.id, name: c.name }))} materials={materials} canEdit={canEdit} />
    </div>
  );
}
