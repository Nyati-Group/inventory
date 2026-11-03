import { requireUser, can } from "@/lib/auth";
import { db, notDeleted } from "@/lib/db";
import { numOrNull } from "@/lib/utils";
import { ratingGrade } from "@/lib/engine/rating";
import { PageHeader } from "@/components/ui/misc";
import { VendorDirectory } from "./directory";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const user = await requireUser();
  const [vendors, categories, materials] = await Promise.all([
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
      <PageHeader title="Vendor directory" description="All vendors across projects. Per-project distance, notes and blacklists live in each project's vendor book." />
      <VendorDirectory rows={rows} categories={categories.map((c) => ({ id: c.id, name: c.name }))} materials={materials} canEdit={can(user, "manageVendors")} />
    </div>
  );
}
