"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, notDeleted } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { audit } from "@/lib/audit";
import { drivingDistance, geocode, CITY_COORDS } from "@/lib/geo";
import { saveFile, validateUpload, guessMime } from "@/lib/storage";
import { run } from "../action-result";

const VendorInput = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  contactPerson: z.string().optional(),
  emails: z.array(z.string().email()).min(1, "At least one email is required"),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  gstin: z
    .string()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Invalid GSTIN format")
    .optional()
    .or(z.literal("")),
  pan: z.string().optional(),
  address: z.string().optional(),
  city: z.string().min(2),
  state: z.string().optional(),
  pincode: z.string().optional(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  serviceRadiusKm: z.number().int().min(1).max(3000),
  leadTimeDays: z.number().int().min(0).max(180),
  paymentTerms: z.string().optional(),
  creditDays: z.number().int().min(0).max(365),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  categoryIds: z.array(z.string()),
  materialIds: z.array(z.string()),
  isPreferred: z.boolean(),
  notes: z.string().optional(),
  projectId: z.string().optional(), // when set, also add to this project's vendor book
});
export type VendorInputT = z.infer<typeof VendorInput>;

const mask = (acct?: string) => (acct ? `XXXXXX${acct.replace(/\D/g, "").slice(-4)}` : undefined);

async function locate(d: { address?: string; city: string; lat?: number | null; lng?: number | null }) {
  if (d.lat !== null && d.lat !== undefined && d.lng !== null && d.lng !== undefined) return { lat: d.lat, lng: d.lng };
  return (await geocode([d.address, d.city].filter(Boolean).join(", "))) ?? CITY_COORDS[d.city.toLowerCase()] ?? null;
}

/** Duplicate detection: same GSTIN or any shared email. */
export async function findDuplicateVendor(gstin: string | undefined, emails: string[], excludeId?: string) {
  const dup = await db.vendor.findFirst({
    where: {
      deletedAt: notDeleted,
      id: excludeId ? { not: excludeId } : undefined,
      OR: [...(gstin ? [{ gstin }] : []), { emails: { hasSome: emails.map((e) => e.toLowerCase()) } }],
    },
    select: { id: true, name: true },
  });
  return dup;
}

async function linkToProject(projectId: string, vendorId: string) {
  const [project, vendor] = await Promise.all([db.project.findUniqueOrThrow({ where: { id: projectId } }), db.vendor.findUniqueOrThrow({ where: { id: vendorId } })]);
  const dist =
    project.lat !== null && project.lng !== null && vendor.lat !== null && vendor.lng !== null
      ? await drivingDistance({ lat: project.lat, lng: project.lng }, { lat: vendor.lat, lng: vendor.lng })
      : null;
  await db.projectVendor.upsert({
    where: { projectId_vendorId: { projectId, vendorId } },
    create: { projectId, vendorId, distanceKm: dist?.km, transitHours: dist?.hours, distanceSource: dist?.source },
    update: { distanceKm: dist?.km, transitHours: dist?.hours, distanceSource: dist?.source },
  });
}

export async function saveVendor(input: VendorInputT) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = VendorInput.parse(input);
    const emails = d.emails.map((e) => e.toLowerCase());
    const dup = await findDuplicateVendor(d.gstin || undefined, emails, d.id);
    if (dup) throw new Error(`Possible duplicate of "${dup.name}" (same GSTIN or email). Open that vendor instead.`);
    const loc = await locate(d);
    const data = {
      name: d.name,
      contactPerson: d.contactPerson,
      emails,
      phone: d.phone,
      whatsapp: d.whatsapp,
      gstin: d.gstin || null,
      pan: d.pan,
      address: d.address,
      city: d.city,
      state: d.state,
      pincode: d.pincode,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      serviceRadiusKm: d.serviceRadiusKm,
      leadTimeDays: d.leadTimeDays,
      paymentTerms: d.paymentTerms,
      creditDays: d.creditDays,
      bankName: d.bankName,
      ...(d.bankAccount ? { bankAccountMasked: mask(d.bankAccount) } : {}),
      bankIfsc: d.bankIfsc,
      isPreferred: d.isPreferred,
      notes: d.notes,
    };
    const before = d.id ? await db.vendor.findUnique({ where: { id: d.id } }) : null;
    const vendor = await db.$transaction(async (tx) => {
      const v = d.id ? await tx.vendor.update({ where: { id: d.id }, data }) : await tx.vendor.create({ data });
      await tx.vendorCategory.deleteMany({ where: { vendorId: v.id, categoryId: { notIn: d.categoryIds } } });
      for (const categoryId of d.categoryIds) await tx.vendorCategory.upsert({ where: { vendorId_categoryId: { vendorId: v.id, categoryId } }, create: { vendorId: v.id, categoryId }, update: {} });
      await tx.vendorMaterial.deleteMany({ where: { vendorId: v.id, materialId: { notIn: d.materialIds } } });
      for (const materialId of d.materialIds) await tx.vendorMaterial.upsert({ where: { vendorId_materialId: { vendorId: v.id, materialId } }, create: { vendorId: v.id, materialId }, update: {} });
      return v;
    });
    if (d.projectId) {
      await assertProjectAccess(user, d.projectId);
      await linkToProject(d.projectId, vendor.id);
    } else if (before && (before.lat !== vendor.lat || before.lng !== vendor.lng)) {
      for (const pv of await db.projectVendor.findMany({ where: { vendorId: vendor.id } })) await linkToProject(pv.projectId, vendor.id);
    }
    await audit(user, "Vendor", vendor.id, d.id ? "UPDATED" : "CREATED", { before, after: data, projectId: d.projectId });
    revalidatePath("/vendors");
    revalidatePath("/project-settings");
    return { id: vendor.id };
  });
}

export async function addVendorToProject(projectId: string, vendorId: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await assertProjectAccess(user, projectId);
    await linkToProject(projectId, vendorId);
    await audit(user, "ProjectVendor", vendorId, "ADDED", { projectId });
    revalidatePath("/project-settings");
    return undefined;
  });
}

export async function updateProjectVendor(projectId: string, vendorId: string, d: { isPreferred?: boolean; isBlacklisted?: boolean; notes?: string }) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await assertProjectAccess(user, projectId);
    const before = await db.projectVendor.findUniqueOrThrow({ where: { projectId_vendorId: { projectId, vendorId } } });
    await db.projectVendor.update({ where: { id: before.id }, data: d });
    await audit(user, "ProjectVendor", before.id, "UPDATED", { before: { isPreferred: before.isPreferred, isBlacklisted: before.isBlacklisted, notes: before.notes }, after: d, projectId });
    revalidatePath("/project-settings");
    return undefined;
  });
}

export async function removeVendorFromProject(projectId: string, vendorId: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await assertProjectAccess(user, projectId);
    await db.projectVendor.delete({ where: { projectId_vendorId: { projectId, vendorId } } });
    await audit(user, "ProjectVendor", vendorId, "REMOVED", { projectId });
    revalidatePath("/project-settings");
    return undefined;
  });
}

export async function recalcDistances(projectId: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await assertProjectAccess(user, projectId);
    const pvs = await db.projectVendor.findMany({ where: { projectId } });
    for (const pv of pvs) await linkToProject(projectId, pv.vendorId);
    revalidatePath("/project-settings");
    return { count: pvs.length };
  });
}

export async function setVendorStatus(vendorId: string, status: "ACTIVE" | "ON_HOLD" | "BLACKLISTED", reason: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    if (status !== "ACTIVE" && reason.trim().length < 3) throw new Error("A reason is required");
    const before = await db.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    await db.vendor.update({ where: { id: vendorId }, data: { status } });
    await audit(user, "Vendor", vendorId, `STATUS_${status}`, { before: { status: before.status }, after: { status, reason } });
    revalidatePath("/vendors");
    revalidatePath(`/vendors/${vendorId}`);
    return undefined;
  });
}

/** CSV: name,contact_person,email,phone,gstin,city,state,address,categories(;-separated),service_radius_km,lead_time_days,payment_terms,credit_days */
export async function importVendorsCsv(projectId: string, csv: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await assertProjectAccess(user, projectId);
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    const header = lines.shift()?.toLowerCase().split(",").map((h) => h.trim()) ?? [];
    const col = (c: string[], h: string) => c[header.indexOf(h)]?.trim() ?? "";
    const cats = await db.materialCategory.findMany();
    let created = 0;
    let linked = 0;
    const skipped: string[] = [];
    for (const line of lines) {
      const c = line.split(",");
      const name = col(c, "name");
      const email = col(c, "email").toLowerCase();
      if (!name || !email) continue;
      const gstin = col(c, "gstin") || undefined;
      const dup = await findDuplicateVendor(gstin, [email]);
      let vendorId = dup?.id;
      if (!vendorId) {
        const city = col(c, "city") || "Unknown";
        const loc = await locate({ address: col(c, "address"), city });
        const v = await db.vendor.create({
          data: {
            name,
            contactPerson: col(c, "contact_person") || null,
            emails: [email],
            phone: col(c, "phone") || null,
            gstin: gstin ?? null,
            city,
            state: col(c, "state") || null,
            address: col(c, "address") || null,
            lat: loc?.lat,
            lng: loc?.lng,
            serviceRadiusKm: Number(col(c, "service_radius_km") || 100),
            leadTimeDays: Number(col(c, "lead_time_days") || 3),
            paymentTerms: col(c, "payment_terms") || null,
            creditDays: Number(col(c, "credit_days") || 0),
            categories: {
              create: col(c, "categories")
                .split(";")
                .map((n) => cats.find((x) => x.name.toLowerCase() === n.trim().toLowerCase()))
                .filter(Boolean)
                .map((x) => ({ categoryId: x!.id })),
            },
          },
        });
        vendorId = v.id;
        created++;
      } else skipped.push(`${name} (duplicate of ${dup!.name})`);
      await linkToProject(projectId, vendorId);
      linked++;
    }
    await audit(user, "Vendor", projectId, "CSV_IMPORT", { after: { created, linked, skipped }, projectId });
    revalidatePath("/project-settings");
    return { created, linked, skipped };
  });
}

export async function uploadVendorDocument(fd: FormData) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const vendorId = String(fd.get("vendorId"));
    const type = String(fd.get("type") || "Other");
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a file");
    const mime = file.type || guessMime(file.name);
    const err = validateUpload({ size: file.size, type: mime, name: file.name }, "document");
    if (err) throw new Error(err);
    const key = await saveFile(`vendors/${vendorId}`, file.name, Buffer.from(await file.arrayBuffer()), mime);
    const doc = await db.vendorDocument.create({ data: { vendorId, type, name: file.name, fileKey: key } });
    await audit(user, "VendorDocument", doc.id, "UPLOADED", { after: { type, name: file.name } });
    revalidatePath(`/vendors/${vendorId}`);
    return undefined;
  });
}
