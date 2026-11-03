"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser, requireRole } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { plain, num } from "@/lib/utils";
import { audit } from "@/lib/audit";
import { getMarketRates, marketStats, type MarketRate } from "@/lib/market-rates";
import { vendorCandidates, createAndSendRfq } from "@/lib/services/rfq";
import { saveFile, validateUpload, guessMime } from "@/lib/storage";
import { drivingDistance } from "@/lib/geo";
import { run } from "../action-result";

async function session() {
  const u = await getUser();
  if (!u) throw new Error("Not signed in");
  return u;
}

export async function getMaterialDetail(projectId: string, materialId: string) {
  return run(async () => {
    const user = await session();
    await assertProjectAccess(user, projectId);
    const [material, stock, ledger, vendors, purchases] = await Promise.all([
      db.material.findUniqueOrThrow({ where: { id: materialId }, include: { category: true } }),
      db.materialProjectStock.findUnique({ where: { projectId_materialId: { projectId, materialId } } }),
      db.stockLedger.findMany({ where: { projectId, materialId }, orderBy: { createdAt: "desc" }, take: 50 }),
      db.projectVendor.findMany({
        where: { projectId, vendor: { OR: [{ materials: { some: { materialId } } }, { categories: { some: { category: { materials: { some: { id: materialId } } } } } }] } },
        include: { vendor: { include: { materials: { where: { materialId } } } } },
      }),
      db.rateHistory.findMany({ where: { projectId, materialId }, orderBy: { date: "desc" }, take: 5, include: { vendor: { select: { name: true } } } }),
    ]);
    return plain({ material, stock, ledger, vendors, purchases });
  });
}

export async function getRateHistory(projectId: string, materialId: string, allProjects: boolean) {
  return run(async () => {
    const user = await session();
    await assertProjectAccess(user, projectId);
    const rows = await db.rateHistory.findMany({
      where: { materialId, ...(allProjects ? {} : { projectId }) },
      orderBy: { date: "asc" },
      include: { vendor: { select: { id: true, name: true } }, project: { select: { code: true } } },
    });
    return rows.map((r) => ({
      date: r.date.toISOString(),
      rate: num(r.rate),
      qty: num(r.qty),
      vendorId: r.vendor.id,
      vendor: r.vendor.name,
      poNumber: r.poNumber,
      project: r.project.code,
    }));
  });
}

export async function fetchMarketRates(projectId: string, materialId: string, force: boolean) {
  return run(async () => {
    const user = await session();
    await assertProjectAccess(user, projectId);
    const snap = await getMarketRates(materialId, projectId, force);
    const results = snap.results as unknown as MarketRate[];
    return {
      provider: snap.provider,
      isDemo: snap.provider === "demo",
      fetchedAt: snap.fetchedAt.toISOString(),
      error: snap.error,
      results,
      stats: marketStats(results),
    };
  });
}

const MaterialInput = z.object({
  projectId: z.string(),
  code: z.string().min(2).max(20),
  name: z.string().min(2),
  categoryId: z.string(),
  unit: z.string().min(1),
  spec: z.string().optional(),
  hsnCode: z.string().optional(),
  gstPercent: z.coerce.number().min(0).max(28),
  currentQty: z.coerce.number().min(0),
  reorderLevel: z.coerce.number().min(0),
});

export async function addMaterial(input: z.infer<typeof MaterialInput>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER", "SITE_ENGINEER");
    const d = MaterialInput.parse(input);
    await assertProjectAccess(user, d.projectId);
    const m = await db.material.create({ data: { code: d.code.toUpperCase(), name: d.name, categoryId: d.categoryId, unit: d.unit, spec: d.spec, hsnCode: d.hsnCode, gstPercent: d.gstPercent } });
    await db.materialProjectStock.create({ data: { projectId: d.projectId, materialId: m.id, currentQty: d.currentQty, reorderLevel: d.reorderLevel } });
    if (d.currentQty > 0)
      await db.stockLedger.create({ data: { projectId: d.projectId, materialId: m.id, type: "ADJUST", qty: d.currentQty, balanceAfter: d.currentQty, refType: "OPENING", note: "Opening balance", createdById: user.id } });
    await audit(user, "Material", m.id, "CREATED", { after: d, projectId: d.projectId });
    revalidatePath("/procurement");
    return { id: m.id };
  });
}

/** CSV columns: code,name,category,unit,spec,gst_percent,current_qty,reorder_level */
export async function importMaterialsCsv(projectId: string, csv: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER", "SITE_ENGINEER");
    await assertProjectAccess(user, projectId);
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    const header = lines.shift()?.toLowerCase().split(",").map((h) => h.trim()) ?? [];
    const idx = (h: string) => header.indexOf(h);
    if (idx("name") < 0 || idx("unit") < 0 || idx("category") < 0) throw new Error("CSV needs at least: code,name,category,unit");
    let created = 0;
    let updated = 0;
    for (const line of lines) {
      const c = line.split(",").map((s) => s.trim());
      const name = c[idx("name")];
      if (!name) continue;
      const catName = c[idx("category")] || "General";
      const cat = await db.materialCategory.upsert({ where: { name: catName }, create: { name: catName }, update: {} });
      const code = (c[idx("code")] || name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 16)).toUpperCase();
      const existing = await db.material.findUnique({ where: { code } });
      const m = existing ?? (await db.material.create({ data: { code, name, categoryId: cat.id, unit: c[idx("unit")], spec: c[idx("spec")] || null, gstPercent: Number(c[idx("gst_percent")] || 18) } }));
      const cur = Number(c[idx("current_qty")] || 0);
      const reorder = Number(c[idx("reorder_level")] || 0);
      await db.materialProjectStock.upsert({
        where: { projectId_materialId: { projectId, materialId: m.id } },
        create: { projectId, materialId: m.id, currentQty: cur, reorderLevel: reorder },
        update: { reorderLevel: reorder },
      });
      existing ? updated++ : created++;
    }
    await audit(user, "Material", projectId, "CSV_IMPORT", { after: { created, updated }, projectId });
    revalidatePath("/procurement");
    return { created, updated };
  });
}

const StockMove = z.object({
  projectId: z.string(),
  materialId: z.string(),
  type: z.enum(["OUT", "ADJUST", "IN"]),
  qty: z.coerce.number().positive(),
  note: z.string().min(2, "Add a short note"),
});

/** Site/store: record an issue to site (OUT), a manual receipt (IN) or a physical-count adjustment (ADJUST = new balance). */
export async function recordStockMovement(input: z.infer<typeof StockMove>) {
  return run(async () => {
    const user = await requireRole("SITE_ENGINEER", "PROCUREMENT_MANAGER");
    const d = StockMove.parse(input);
    await assertProjectAccess(user, d.projectId);
    const stock = await db.materialProjectStock.findUniqueOrThrow({ where: { projectId_materialId: { projectId: d.projectId, materialId: d.materialId } } });
    const before = num(stock.currentQty);
    const after = d.type === "OUT" ? before - d.qty : d.type === "IN" ? before + d.qty : d.qty;
    if (after < 0) throw new Error(`Cannot issue more than available stock (${before})`);
    await db.$transaction([
      db.materialProjectStock.update({ where: { id: stock.id }, data: { currentQty: after } }),
      db.stockLedger.create({
        data: { projectId: d.projectId, materialId: d.materialId, type: d.type, qty: d.type === "ADJUST" ? after - before : d.qty, balanceAfter: after, refType: "MANUAL", note: d.note, createdById: user.id },
      }),
    ]);
    await audit(user, "Stock", stock.id, `STOCK_${d.type}`, { before: { qty: before }, after: { qty: after, note: d.note }, projectId: d.projectId });
    revalidatePath("/procurement");
    return { balance: after };
  });
}

export async function updateReorderLevel(projectId: string, materialId: string, reorderLevel: number) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER", "SITE_ENGINEER");
    await assertProjectAccess(user, projectId);
    if (!(reorderLevel >= 0)) throw new Error("Reorder level must be ≥ 0");
    const s = await db.materialProjectStock.update({ where: { projectId_materialId: { projectId, materialId } }, data: { reorderLevel } });
    await audit(user, "Stock", s.id, "REORDER_LEVEL", { after: { reorderLevel }, projectId });
    revalidatePath("/procurement");
    return undefined;
  });
}

export async function raiseMaterialRequest(projectId: string, materialId: string, qty: number, note?: string) {
  return run(async () => {
    const user = await requireRole("SITE_ENGINEER", "PROCUREMENT_MANAGER");
    await assertProjectAccess(user, projectId);
    if (!(qty > 0)) throw new Error("Quantity must be positive");
    const r = await db.materialRequest.create({ data: { projectId, materialId, qty, note, source: "MANUAL", raisedById: user.id } });
    await audit(user, "MaterialRequest", r.id, "RAISED", { after: { qty, note }, projectId });
    revalidatePath("/procurement");
    return undefined;
  });
}

export async function getRfqFormData(projectId: string, materialId: string, expectedDate: string) {
  return run(async () => {
    const user = await session();
    await assertProjectAccess(user, projectId);
    const candidates = await vendorCandidates(projectId, materialId, new Date(expectedDate));
    return candidates;
  });
}

/** Multipart: fields + optional attachments (drawings/specs). */
export async function sendRfq(fd: FormData) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = z
      .object({
        projectId: z.string(),
        materialId: z.string(),
        quantity: z.coerce.number().positive("Quantity must be greater than 0"),
        expectedDeliveryDate: z.coerce.date(),
        deadline: z.coerce.date(),
        deliveryAddress: z.string().min(5),
        notes: z.string().optional(),
        paymentTermsPref: z.string().optional(),
        vendorIds: z.array(z.string()).min(1, "Select at least one vendor"),
        materialRequestId: z.string().optional(),
      })
      .parse({ ...Object.fromEntries(fd.entries()), vendorIds: fd.getAll("vendorIds") });
    await assertProjectAccess(user, d.projectId);
    const today = new Date(new Date().toDateString());
    if (d.expectedDeliveryDate < today) throw new Error("Expected delivery date cannot be in the past");
    if (d.deadline <= new Date()) throw new Error("Quotation deadline must be in the future");
    if (d.deadline > d.expectedDeliveryDate) throw new Error("Quotation deadline must be before the expected delivery date");
    const attachments = [];
    for (const f of fd.getAll("attachments")) {
      if (!(f instanceof File) || !f.size) continue;
      const err = validateUpload({ size: f.size, type: f.type || guessMime(f.name), name: f.name }, "document");
      if (err) throw new Error(`${f.name}: ${err}`);
      const key = await saveFile(`rfq-attachments/${d.projectId}`, f.name, Buffer.from(await f.arrayBuffer()), f.type || guessMime(f.name));
      attachments.push({ name: f.name, key, contentType: f.type || guessMime(f.name) });
    }
    const rfq = await createAndSendRfq({ ...d, materialRequestId: d.materialRequestId || undefined, attachments }, user);
    revalidatePath("/procurement");
    revalidatePath("/rfqs");
    return { id: rfq.id, number: rfq.number };
  });
}

const QuickVendor = z.object({
  projectId: z.string(),
  materialId: z.string(),
  name: z.string().min(2),
  email: z.string().email(),
  city: z.string().min(2),
  phone: z.string().optional(),
});

/** "Add to RFQ" from market rates: create a vendor (if new) and add to this project's vendor book. */
export async function addMarketVendor(input: z.infer<typeof QuickVendor>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = QuickVendor.parse(input);
    await assertProjectAccess(user, d.projectId);
    const dup = await db.vendor.findFirst({ where: { emails: { has: d.email.toLowerCase() } } });
    const material = await db.material.findUniqueOrThrow({ where: { id: d.materialId } });
    const project = await db.project.findUniqueOrThrow({ where: { id: d.projectId } });
    const { CITY_COORDS } = await import("@/lib/geo");
    const c = CITY_COORDS[d.city.toLowerCase()];
    const vendor =
      dup ??
      (await db.vendor.create({
        data: {
          name: d.name,
          emails: [d.email.toLowerCase()],
          phone: d.phone,
          city: d.city,
          lat: c?.lat,
          lng: c?.lng,
          notes: "Added from market-rate search",
          materials: { create: { materialId: material.id } },
          categories: { create: { categoryId: material.categoryId } },
        },
      }));
    const dist = c && project.lat && project.lng ? await drivingDistance({ lat: project.lat, lng: project.lng }, c) : null;
    await db.projectVendor.upsert({
      where: { projectId_vendorId: { projectId: d.projectId, vendorId: vendor.id } },
      create: { projectId: d.projectId, vendorId: vendor.id, distanceKm: dist?.km, transitHours: dist?.hours, distanceSource: dist?.source },
      update: {},
    });
    await audit(user, "Vendor", vendor.id, dup ? "ADDED_TO_PROJECT" : "CREATED_FROM_MARKET", { after: d, projectId: d.projectId });
    return { vendorId: vendor.id, existed: !!dup };
  });
}
