import { db, notDeleted } from "../db";
import { fmtDate, inr, num } from "../utils";
import type { SessionUser } from "../auth";

/**
 * Read-only data tools the copilot (Gemini function calling) can use. Every query is limited to the
 * projects the signed-in user can access. Results are compact, with ₹ amounts pre-formatted and an app
 * `link` for each record so answers can point to the right page.
 */

export interface ToolCtx {
  user: SessionUser;
  projectIds: string[];
  projects: { id: string; code: string; name: string }[];
  currentProjectId: string | null;
}

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const int = (v: unknown, d: number, max = 50) => Math.min(max, Math.max(1, Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== "" ? Math.round(Number(v)) : d));
const ci = (s: string) => ({ contains: s, mode: "insensitive" as const });
const d = (x: Date | null | undefined) => (x ? fmtDate(x) : null);

/** Resolve an optional project name/code argument to project ids within the user's access. */
function scope(ctx: ToolCtx, project: unknown): string[] {
  const p = str(project);
  if (!p) return ctx.projectIds;
  const q = p.toLowerCase();
  if (q === "current" && ctx.currentProjectId) return [ctx.currentProjectId];
  const hits = ctx.projects.filter((x) => x.code.toLowerCase() === q || x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()));
  return hits.length ? hits.map((x) => x.id) : ["__none__"];
}

const projName = (ctx: ToolCtx, id: string) => ctx.projects.find((p) => p.id === id)?.name ?? id;

// ───────────────────────────── declarations (sent to Gemini) ─────────────────────────────

const projectParam = { type: "string", description: 'Project name or code (e.g. "Nyati Elenor", "ELN"), or "current". Omit for all the user\'s projects.' };
const limitParam = { type: "integer", description: "Maximum rows (default 15, max 50)." };

export const TOOL_DECLARATIONS = [
  {
    name: "get_overview",
    description: "Dashboard summary: open RFQs, RFQs awaiting approval, pending approvals, open POs, deliveries in transit/delayed/overdue, low-stock materials, open material requests (PRs) and this month's PO value.",
    parametersJsonSchema: { type: "object", properties: { project: projectParam } },
  },
  {
    name: "search_materials",
    description: "Find materials with their stock per project: current quantity, reorder level, last purchase rate, unit, category, GST %. Use for stock levels and 'what is low on stock'.",
    parametersJsonSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Material name, code or category (partial match)." }, project: projectParam, low_stock_only: { type: "boolean" }, limit: limitParam },
    },
  },
  {
    name: "list_rfqs",
    description: "List RFQs (requests for quotation) with material, quantity, status, deadline and how many vendors responded.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        project: projectParam,
        status: { type: "string", enum: ["DRAFT", "SENT", "PARTIALLY_RESPONDED", "CLOSED", "AWAITING_APPROVAL", "APPROVED", "ORDERED", "CANCELLED"] },
        material: { type: "string", description: "Filter by material name (partial)." },
        limit: limitParam,
      },
    },
  },
  {
    name: "get_rfq",
    description: "Full details of one RFQ: items, invited vendors and their response status, each quotation (rate, landed cost, delivery, payment terms, deviations), the comparison ranking and recommendation with its explanation, approval status and resulting POs.",
    parametersJsonSchema: { type: "object", properties: { number: { type: "string", description: "RFQ number, e.g. RFQ-ELN-2026-0001 (partial is fine)." } }, required: ["number"] },
  },
  {
    name: "list_purchase_orders",
    description: "List purchase orders with vendor, total, status and expected/promised delivery dates.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        project: projectParam,
        status: { type: "string", enum: ["DRAFT", "APPROVED", "SENT", "ACCEPTED", "CHANGE_REQUESTED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED", "CANCELLED"] },
        vendor: { type: "string", description: "Vendor name (partial)." },
        material: { type: "string", description: "Material name (partial)." },
        limit: limitParam,
      },
    },
  },
  {
    name: "get_purchase_order",
    description: "Full details of one PO: items with ordered/received/accepted quantities, delivery updates, GRNs, returns and the vendor rating for it.",
    parametersJsonSchema: { type: "object", properties: { number: { type: "string", description: "PO number (partial is fine)." } }, required: ["number"] },
  },
  {
    name: "list_vendors",
    description: "Search the vendor directory: rating, completed orders, categories, city, status, preferred flag, lead time, payment terms.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Vendor name (partial)." },
        category: { type: "string", description: "Material category, e.g. Cement, Steel." },
        city: { type: "string" },
        min_rating: { type: "number", description: "Minimum star rating 0-5." },
        status: { type: "string", enum: ["ACTIVE", "ON_HOLD", "BLACKLISTED"] },
        limit: limitParam,
      },
    },
  },
  {
    name: "get_vendor",
    description: "One vendor's profile with contact details, categories, projects, recent POs, recent ratings and recent quoted/purchase rates.",
    parametersJsonSchema: { type: "object", properties: { name: { type: "string", description: "Vendor name (partial)." } }, required: ["name"] },
  },
  {
    name: "get_rate_history",
    description: "Purchase rate history for a material (from POs): date, vendor, project, rate and quantity, plus average/min/max and the latest market-rate snapshot if one was fetched.",
    parametersJsonSchema: {
      type: "object",
      properties: { material: { type: "string", description: "Material name (partial)." }, project: projectParam, vendor: { type: "string" }, limit: limitParam },
      required: ["material"],
    },
  },
  {
    name: "list_approvals",
    description: "Approval requests (vendor selection approvals) with amount, recommended vs selected vendor, current step and approver. Default: pending ones.",
    parametersJsonSchema: {
      type: "object",
      properties: { project: projectParam, status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED", "RE_RFQ", "CANCELLED"] }, mine_only: { type: "boolean", description: "Only steps waiting for the current user." }, limit: limitParam },
    },
  },
  {
    name: "list_deliveries",
    description: "Open POs being delivered: latest delivery update (dispatched/in transit/delayed/arrived, vehicle, ETA), expected date and whether overdue.",
    parametersJsonSchema: { type: "object", properties: { project: projectParam, overdue_only: { type: "boolean" }, limit: limitParam } },
  },
  {
    name: "list_material_requests",
    description: "Material requests / purchase requisitions (PRs) raised by site or auto low-stock, with status and linked RFQ.",
    parametersJsonSchema: { type: "object", properties: { project: projectParam, status: { type: "string", enum: ["OPEN", "RFQ_CREATED", "CLOSED", "CANCELLED"] }, limit: limitParam } },
  },
  {
    name: "spend_summary",
    description: "Purchase spend from POs (excluding cancelled/draft) grouped by vendor, material, project or month, for an optional date range.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        project: projectParam,
        group_by: { type: "string", enum: ["vendor", "material", "project", "month"] },
        from: { type: "string", description: "Start date YYYY-MM-DD." },
        to: { type: "string", description: "End date YYYY-MM-DD." },
      },
      required: ["group_by"],
    },
  },
];

// ───────────────────────────── implementations ─────────────────────────────

async function getOverview(ctx: ToolCtx, a: Args) {
  const projectId = { in: scope(ctx, a.project) };
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [rfqs, approvals, pos, stocks, prs, monthPos] = await Promise.all([
    db.rFQ.groupBy({ by: ["status"], where: { projectId }, _count: true }),
    db.approvalRequest.count({ where: { projectId, status: "PENDING" } }),
    db.purchaseOrder.findMany({ where: { projectId, status: { in: ["APPROVED", "SENT", "ACCEPTED", "CHANGE_REQUESTED", "PARTIALLY_DELIVERED"] } }, select: { status: true, expectedDeliveryDate: true, promisedDeliveryDate: true, deliveryUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } } } }),
    db.materialProjectStock.findMany({ where: { projectId }, select: { currentQty: true, reorderLevel: true } }),
    db.materialRequest.count({ where: { projectId, status: "OPEN" } }),
    db.purchaseOrder.findMany({ where: { projectId, createdAt: { gte: monthStart }, status: { notIn: ["CANCELLED", "DRAFT"] } }, select: { total: true } }),
  ]);
  const byStatus = Object.fromEntries(rfqs.map((r) => [r.status, r._count]));
  return {
    projects: scope(ctx, a.project).map((id) => projName(ctx, id)),
    rfqs_open: (byStatus.SENT ?? 0) + (byStatus.PARTIALLY_RESPONDED ?? 0),
    rfqs_closed_awaiting_comparison_or_approval: (byStatus.CLOSED ?? 0) + (byStatus.AWAITING_APPROVAL ?? 0),
    rfqs_by_status: byStatus,
    approvals_pending: approvals,
    open_pos: pos.length,
    deliveries_in_transit: pos.filter((p) => ["DISPATCHED", "IN_TRANSIT"].includes(p.deliveryUpdates[0]?.status ?? "")).length,
    deliveries_delayed: pos.filter((p) => p.deliveryUpdates[0]?.status === "DELAYED").length,
    pos_overdue: pos.filter((p) => (p.promisedDeliveryDate ?? p.expectedDeliveryDate) < now).length,
    low_stock_materials: stocks.filter((s) => s.reorderLevel > 0 && s.currentQty <= s.reorderLevel).length,
    open_material_requests: prs,
    po_value_this_month: inr(monthPos.reduce((s, p) => s + num(p.total), 0), false),
    links: { procurement: "/procurement", rfqs: "/rfqs", purchase_orders: "/purchase-orders", deliveries: "/deliveries" },
  };
}

async function searchMaterials(ctx: ToolCtx, a: Args) {
  const q = str(a.query);
  const stocks = await db.materialProjectStock.findMany({
    where: {
      projectId: { in: scope(ctx, a.project) },
      material: { deletedAt: notDeleted, ...(q ? { OR: [{ name: ci(q) }, { code: ci(q) }, { category: { name: ci(q) } }] } : {}) },
    },
    include: { material: { include: { category: true } } },
    take: 300,
  });
  const rows = stocks
    .filter((s) => !a.low_stock_only || (s.reorderLevel > 0 && s.currentQty <= s.reorderLevel))
    .sort((x, y) => x.currentQty / (x.reorderLevel || 1) - y.currentQty / (y.reorderLevel || 1))
    .slice(0, int(a.limit, 15))
    .map((s) => ({
      material: s.material.name,
      code: s.material.code,
      category: s.material.category.name,
      project: projName(ctx, s.projectId),
      stock: `${s.currentQty} ${s.material.unit}`,
      reorder_level: `${s.reorderLevel} ${s.material.unit}`,
      low_stock: s.reorderLevel > 0 && s.currentQty <= s.reorderLevel,
      last_rate: s.lastRate ? `${inr(s.lastRate)}/${s.material.unit}` : null,
      last_rate_date: d(s.lastRateAt),
      gst_percent: s.material.gstPercent,
      spec: s.material.spec,
      link: "/procurement",
    }));
  return { count: rows.length, materials: rows };
}

async function listRfqs(ctx: ToolCtx, a: Args) {
  const m = str(a.material);
  const rfqs = await db.rFQ.findMany({
    where: { projectId: { in: scope(ctx, a.project) }, ...(str(a.status) ? { status: a.status as never } : {}), ...(m ? { items: { some: { material: { name: ci(m) } } } } : {}) },
    include: { items: { include: { material: true } }, vendors: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
    take: int(a.limit, 15),
  });
  return {
    count: rfqs.length,
    rfqs: rfqs.map((r) => ({
      number: r.number,
      project: projName(ctx, r.projectId),
      material: r.items.map((i) => `${i.material.name} — ${i.quantity} ${i.unit}`).join("; "),
      status: r.status,
      created: d(r.createdAt),
      quote_deadline: d(r.deadline),
      required_by: d(r.expectedDeliveryDate),
      vendors_invited: r.vendors.length,
      vendors_responded: r.vendors.filter((v) => v.status === "RESPONDED").length,
      link: `/rfqs/${r.id}`,
    })),
  };
}

async function getRfq(ctx: ToolCtx, a: Args) {
  const n = str(a.number) ?? "";
  const r = await db.rFQ.findFirst({
    where: { projectId: { in: ctx.projectIds }, number: ci(n) },
    include: {
      items: { include: { material: true } },
      vendors: { include: { vendor: { select: { name: true, city: true } }, quotation: { include: { activeVersion: true } } } },
      comparisonRuns: { where: { isLatest: true }, include: { scores: { orderBy: { totalScore: "desc" } } }, take: 1 },
      approvalRequests: { orderBy: { createdAt: "desc" }, take: 1, include: { steps: { include: { approver: { select: { name: true } } } } } },
      purchaseOrders: { select: { id: true, number: true, status: true, total: true, vendor: { select: { name: true } } } },
    },
  });
  if (!r) return { error: `No RFQ matching "${n}" in your projects.` };
  const vname = new Map(r.vendors.map((v) => [v.vendorId, v.vendor.name]));
  const run = r.comparisonRuns[0];
  const ap = r.approvalRequests[0];
  return {
    number: r.number,
    project: projName(ctx, r.projectId),
    status: r.status,
    items: r.items.map((i) => ({ material: i.material.name, quantity: `${i.quantity} ${i.unit}`, spec: i.spec ?? i.material.spec })),
    quote_deadline: d(r.deadline),
    required_by: d(r.expectedDeliveryDate),
    delivery_address: r.deliveryAddress,
    vendors: r.vendors.map((v) => {
      const q = v.quotation?.activeVersion;
      return {
        vendor: v.vendor.name,
        city: v.vendor.city,
        status: v.status,
        decline_reason: v.declineReason,
        quotation: q
          ? {
              unit_rate: q.unitRate ? inr(q.unitRate) : null,
              gst_percent: q.gstPercent,
              freight: inr(q.freight),
              landed_cost: q.landedCost ? inr(q.landedCost) : null,
              delivery_date: d(q.deliveryDate),
              delivery_days: q.deliveryDays,
              payment_terms: q.paymentTerms,
              validity_days: q.validityDays,
              deviations: q.deviations,
              parse_status: q.parseStatus,
            }
          : null,
      };
    }),
    comparison: run
      ? {
          recommended: run.recommendedVendorId ? vname.get(run.recommendedVendorId) : null,
          runner_up: run.runnerUpVendorId ? vname.get(run.runnerUpVendorId) : null,
          explanation: run.explanation,
          why_not_cheapest: run.whyNotCheapest,
          ranking: run.scores.map((s) => ({
            vendor: vname.get(s.vendorId),
            rank: s.rank,
            total_score: Math.round(s.totalScore * 10) / 10,
            landed_cost: inr(s.landedCost, false),
            scores: { price: Math.round(s.priceScore), delivery: Math.round(s.deliveryScore), proximity: Math.round(s.proximityScore), rating: Math.round(s.ratingScore), commercial: Math.round(s.commercialScore) },
            disqualified: s.disqualified ? s.disqualifyReason : false,
            badges: s.badges,
          })),
        }
      : null,
    approval: ap
      ? {
          status: ap.status,
          amount: inr(ap.amount, false),
          selected_vendor: ap.selectedVendorId ? vname.get(ap.selectedVendorId) : null,
          override_reason: ap.overrideReason,
          steps: ap.steps.map((s) => ({ level: s.level, label: s.label, approver: s.approver?.name, status: s.status, comment: s.comment, decided: d(s.decidedAt) })),
        }
      : null,
    purchase_orders: r.purchaseOrders.map((p) => ({ number: p.number, vendor: p.vendor.name, status: p.status, total: inr(p.total, false), link: `/purchase-orders/${p.id}` })),
    link: `/rfqs/${r.id}`,
  };
}

async function listPos(ctx: ToolCtx, a: Args) {
  const v = str(a.vendor);
  const m = str(a.material);
  const pos = await db.purchaseOrder.findMany({
    where: {
      projectId: { in: scope(ctx, a.project) },
      ...(str(a.status) ? { status: a.status as never } : {}),
      ...(v ? { vendor: { name: ci(v) } } : {}),
      ...(m ? { items: { some: { material: { name: ci(m) } } } } : {}),
    },
    include: { vendor: { select: { name: true } }, items: { include: { material: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: int(a.limit, 15),
  });
  return {
    count: pos.length,
    purchase_orders: pos.map((p) => ({
      number: p.number,
      project: projName(ctx, p.projectId),
      vendor: p.vendor.name,
      items: p.items.map((i) => `${i.material.name} ${i.quantity} ${i.unit} @ ${inr(i.unitRate)}`).join("; "),
      total: inr(p.total, false),
      status: p.status,
      created: d(p.createdAt),
      expected_delivery: d(p.expectedDeliveryDate),
      promised_delivery: d(p.promisedDeliveryDate),
      link: `/purchase-orders/${p.id}`,
    })),
  };
}

async function getPo(ctx: ToolCtx, a: Args) {
  const n = str(a.number) ?? "";
  const p = await db.purchaseOrder.findFirst({
    where: { projectId: { in: ctx.projectIds }, number: ci(n) },
    include: {
      vendor: { select: { name: true, phone: true, emails: true } },
      items: { include: { material: { select: { name: true } } } },
      deliveryUpdates: { orderBy: { createdAt: "desc" }, take: 5 },
      grns: { include: { items: { include: { material: { select: { name: true } } } } } },
      returnRequests: { include: { material: { select: { name: true } } } },
      rating: true,
      rfq: { select: { id: true, number: true } },
    },
  });
  if (!p) return { error: `No purchase order matching "${n}" in your projects.` };
  return {
    number: p.number,
    project: projName(ctx, p.projectId),
    vendor: p.vendor.name,
    vendor_contact: { phone: p.vendor.phone, email: p.vendor.emails[0] },
    status: p.status,
    rfq: p.rfq ? { number: p.rfq.number, link: `/rfqs/${p.rfq.id}` } : null,
    items: p.items.map((i) => ({ material: i.material.name, ordered: `${i.quantity} ${i.unit}`, received: i.receivedQty, accepted: i.acceptedQty, rate: inr(i.unitRate), gst_percent: i.gstPercent, amount: inr(i.amount, false) })),
    subtotal: inr(p.subtotal, false),
    gst: inr(p.gstTotal, false),
    freight: inr(p.freight, false),
    total: inr(p.total, false),
    payment_terms: p.paymentTerms,
    credit_days: p.creditDays,
    created: d(p.createdAt),
    sent: d(p.sentAt),
    accepted: d(p.acceptedAt),
    expected_delivery: d(p.expectedDeliveryDate),
    promised_delivery: d(p.promisedDeliveryDate),
    delivered: d(p.deliveredAt),
    change_request: p.changeRequestNote,
    delivery_updates: p.deliveryUpdates.map((u) => ({ status: u.status, at: d(u.createdAt), vehicle: u.vehicleNo, driver: u.driverName, eta: d(u.eta), note: u.note })),
    grns: p.grns.map((g) => ({ number: g.number, received: d(g.receivedAt), challan: g.challanNo, items: g.items.map((i) => `${i.material.name}: delivered ${i.deliveredQty}, accepted ${i.acceptedQty}, rejected ${i.rejectedQty}${i.rejectionReason ? ` (${i.rejectionReason})` : ""}`) })),
    returns: p.returnRequests.map((r) => ({ material: r.material.name, qty: r.qty, reason: r.reason, status: r.status })),
    rating: p.rating ? { stars: p.rating.stars, score: Math.round(p.rating.totalScore), feedback: p.rating.feedback } : null,
    link: `/purchase-orders/${p.id}`,
  };
}

async function listVendors(ctx: ToolCtx, a: Args) {
  const q = str(a.query);
  const c = str(a.category);
  const city = str(a.city);
  const vendors = await db.vendor.findMany({
    where: {
      deletedAt: notDeleted,
      ...(q ? { name: ci(q) } : {}),
      ...(city ? { city: ci(city) } : {}),
      ...(str(a.status) ? { status: a.status as never } : {}),
      ...(typeof a.min_rating === "number" ? { overallRating: { gte: a.min_rating } } : {}),
      ...(c ? { categories: { some: { category: { name: ci(c) } } } } : {}),
    },
    include: { categories: { include: { category: true } }, projects: { where: { projectId: { in: ctx.projectIds } }, select: { projectId: true, distanceKm: true, isBlacklisted: true } } },
    orderBy: [{ overallRating: "desc" }, { name: "asc" }],
    take: int(a.limit, 15),
  });
  return {
    count: vendors.length,
    vendors: vendors.map((v) => ({
      name: v.name,
      city: v.city,
      categories: v.categories.map((x) => x.category.name),
      rating: v.completedOrders < 3 ? "New (fewer than 3 rated orders)" : v.overallRating?.toFixed(1),
      completed_orders: v.completedOrders,
      status: v.status,
      preferred: v.isPreferred,
      lead_time_days: v.leadTimeDays,
      payment_terms: v.paymentTerms,
      in_project_vendor_books: v.projects.map((p) => `${projName(ctx, p.projectId)}${p.distanceKm ? ` (${Math.round(p.distanceKm)} km)` : ""}${p.isBlacklisted ? " — blacklisted" : ""}`),
      link: `/vendors/${v.id}`,
    })),
  };
}

async function getVendor(ctx: ToolCtx, a: Args) {
  const n = str(a.name) ?? "";
  const v = await db.vendor.findFirst({
    where: { deletedAt: notDeleted, name: ci(n) },
    include: {
      categories: { include: { category: true } },
      projects: { where: { projectId: { in: ctx.projectIds } } },
      purchaseOrders: { where: { projectId: { in: ctx.projectIds } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, number: true, status: true, total: true, createdAt: true, projectId: true } },
      ratings: { where: { projectId: { in: ctx.projectIds } }, orderBy: { createdAt: "desc" }, take: 5, select: { stars: true, totalScore: true, feedback: true, createdAt: true } },
      rateHistory: { where: { projectId: { in: ctx.projectIds } }, orderBy: { date: "desc" }, take: 10, include: { material: { select: { name: true, unit: true } } } },
    },
  });
  if (!v) return { error: `No vendor matching "${n}".` };
  return {
    name: v.name,
    contact_person: v.contactPerson,
    email: v.emails,
    phone: v.phone,
    whatsapp: v.whatsapp,
    gstin: v.gstin,
    address: [v.address, v.city, v.state, v.pincode].filter(Boolean).join(", "),
    categories: v.categories.map((x) => x.category.name),
    status: v.status,
    preferred: v.isPreferred,
    rating: v.overallRating?.toFixed(1) ?? null,
    completed_orders: v.completedOrders,
    service_radius_km: v.serviceRadiusKm,
    lead_time_days: v.leadTimeDays,
    payment_terms: v.paymentTerms,
    credit_days: v.creditDays,
    notes: v.notes,
    projects: v.projects.map((p) => ({ project: projName(ctx, p.projectId), distance_km: p.distanceKm ? Math.round(p.distanceKm) : null, blacklisted: p.isBlacklisted, preferred: p.isPreferred, project_rating: p.rating })),
    recent_pos: v.purchaseOrders.map((p) => ({ number: p.number, project: projName(ctx, p.projectId), status: p.status, total: inr(p.total, false), date: d(p.createdAt), link: `/purchase-orders/${p.id}` })),
    recent_ratings: v.ratings.map((r) => ({ stars: r.stars, score: Math.round(r.totalScore), feedback: r.feedback, date: d(r.createdAt) })),
    recent_rates: v.rateHistory.map((r) => ({ material: r.material.name, rate: `${inr(r.rate)}/${r.material.unit}`, qty: r.qty, date: d(r.date), po: r.poNumber })),
    link: `/vendors/${v.id}`,
  };
}

async function getRateHistory(ctx: ToolCtx, a: Args) {
  const m = str(a.material) ?? "";
  const v = str(a.vendor);
  const projectIds = scope(ctx, a.project);
  const rows = await db.rateHistory.findMany({
    where: { projectId: { in: projectIds }, material: { name: ci(m) }, ...(v ? { vendor: { name: ci(v) } } : {}) },
    include: { material: { select: { name: true, unit: true } }, vendor: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: int(a.limit, 20),
  });
  if (!rows.length) return { error: `No purchase history for a material matching "${m}".` };
  const rates = rows.map((r) => r.rate);
  const unit = rows[0].material.unit;
  const snap = await db.marketRateSnapshot.findFirst({ where: { projectId: { in: projectIds }, material: { name: ci(m) } }, orderBy: { fetchedAt: "desc" } });
  const market = snap ? ((snap.results as unknown as { supplier: string; normalisedRate: number | null; city: string | null }[]) ?? []).filter((x) => x.normalisedRate) : [];
  return {
    material: rows[0].material.name,
    unit,
    average: `${inr(rates.reduce((s, x) => s + x, 0) / rates.length)}/${unit}`,
    min: `${inr(Math.min(...rates))}/${unit}`,
    max: `${inr(Math.max(...rates))}/${unit}`,
    latest: `${inr(rates[0])}/${unit} from ${rows[0].vendor.name} on ${d(rows[0].date)}`,
    history: rows.map((r) => ({ date: d(r.date), vendor: r.vendor.name, project: projName(ctx, r.projectId), rate: inr(r.rate), qty: r.qty, po: r.poNumber })),
    market_snapshot: snap
      ? {
          fetched: d(snap.fetchedAt),
          source: snap.provider === "demo" ? "simulated demo data" : "online search",
          average: market.length ? `${inr(market.reduce((s, x) => s + (x.normalisedRate ?? 0), 0) / market.length)}/${unit}` : null,
          listings: market.slice(0, 6).map((x) => `${x.supplier}${x.city ? ` (${x.city})` : ""}: ${inr(x.normalisedRate)}`),
        }
      : "Not fetched yet — open Rate graph → Market rates on the Procurement page.",
  };
}

async function listApprovals(ctx: ToolCtx, a: Args) {
  const status = (str(a.status) ?? "PENDING") as never;
  const reqs = await db.approvalRequest.findMany({
    where: { projectId: { in: scope(ctx, a.project) }, status, ...(a.mine_only ? { steps: { some: { approverId: ctx.user.id, status: "PENDING" } } } : {}) },
    include: { rfq: { select: { id: true, number: true, items: { include: { material: { select: { name: true } } } } } }, steps: { include: { approver: { select: { name: true } } }, orderBy: { level: "asc" } }, requestedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: int(a.limit, 15),
  });
  const vendorIds = [...new Set(reqs.flatMap((r) => [r.recommendedVendorId, r.selectedVendorId]).filter((x): x is string => !!x))];
  const vendors = new Map((await db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
  return {
    count: reqs.length,
    approvals: reqs.map((r) => {
      const current = r.steps.find((s) => s.status === "PENDING");
      return {
        rfq: r.rfq.number,
        project: projName(ctx, r.projectId),
        material: r.rfq.items.map((i) => i.material.name).join(", "),
        amount: inr(r.amount, false),
        recommended_vendor: r.recommendedVendorId ? vendors.get(r.recommendedVendorId) : null,
        selected_vendor: r.selectedVendorId ? vendors.get(r.selectedVendorId) : null,
        override_reason: r.overrideReason,
        status: r.status,
        waiting_for: current ? `${current.label} — ${current.approver?.name ?? "unassigned"}` : null,
        requested_by: r.requestedBy?.name,
        requested: d(r.createdAt),
        link: `/rfqs/${r.rfq.id}`,
      };
    }),
  };
}

async function listDeliveries(ctx: ToolCtx, a: Args) {
  const now = new Date();
  const pos = await db.purchaseOrder.findMany({
    where: { projectId: { in: scope(ctx, a.project) }, status: { in: ["SENT", "ACCEPTED", "CHANGE_REQUESTED", "PARTIALLY_DELIVERED"] } },
    include: { vendor: { select: { name: true } }, deliveryUpdates: { orderBy: { createdAt: "desc" }, take: 1 }, items: { include: { material: { select: { name: true } } } } },
    orderBy: { expectedDeliveryDate: "asc" },
    take: 100,
  });
  const rows = pos
    .map((p) => {
      const due = p.promisedDeliveryDate ?? p.expectedDeliveryDate;
      const u = p.deliveryUpdates[0];
      return {
        po: p.number,
        project: projName(ctx, p.projectId),
        vendor: p.vendor.name,
        items: p.items.map((i) => `${i.material.name} ${i.receivedQty}/${i.quantity} ${i.unit} received`).join("; "),
        po_status: p.status,
        due: d(due),
        overdue_days: due < now ? Math.ceil((now.getTime() - due.getTime()) / 86_400_000) : 0,
        latest_update: u ? { status: u.status, at: d(u.createdAt), vehicle: u.vehicleNo, driver: u.driverName, driver_phone: u.driverPhone, eta: d(u.eta), note: u.note } : "No dispatch update yet",
        link: `/purchase-orders/${p.id}`,
      };
    })
    .filter((r) => !a.overdue_only || r.overdue_days > 0)
    .slice(0, int(a.limit, 15));
  return { count: rows.length, deliveries: rows, link: "/deliveries" };
}

async function listMaterialRequests(ctx: ToolCtx, a: Args) {
  const prs = await db.materialRequest.findMany({
    where: { projectId: { in: scope(ctx, a.project) }, ...(str(a.status) ? { status: a.status as never } : {}) },
    include: { material: { select: { name: true, unit: true } } },
    orderBy: { createdAt: "desc" },
    take: int(a.limit, 15),
  });
  const rfqIds = prs.map((p) => p.rfqId).filter((x): x is string => !!x);
  const rfqs = new Map((await db.rFQ.findMany({ where: { id: { in: rfqIds } }, select: { id: true, number: true } })).map((r) => [r.id, r.number]));
  return {
    count: prs.length,
    material_requests: prs.map((p) => ({
      material: p.material.name,
      qty: `${p.qty} ${p.material.unit}`,
      project: projName(ctx, p.projectId),
      status: p.status,
      source: p.source,
      note: p.note,
      raised: d(p.createdAt),
      rfq: p.rfqId ? { number: rfqs.get(p.rfqId), link: `/rfqs/${p.rfqId}` } : null,
    })),
  };
}

async function spendSummary(ctx: ToolCtx, a: Args) {
  const from = str(a.from) && !Number.isNaN(Date.parse(String(a.from))) ? new Date(String(a.from)) : undefined;
  const to = str(a.to) && !Number.isNaN(Date.parse(String(a.to))) ? new Date(new Date(String(a.to)).getTime() + 86_399_999) : undefined;
  const pos = await db.purchaseOrder.findMany({
    where: { projectId: { in: scope(ctx, a.project) }, status: { notIn: ["CANCELLED", "DRAFT"] }, ...(from || to ? { createdAt: { gte: from, lte: to } } : {}) },
    include: { vendor: { select: { name: true } }, items: { include: { material: { select: { name: true } } } } },
    take: 2000,
  });
  const groups = new Map<string, { total: number; orders: number }>();
  const add = (k: string, v: number) => {
    const g = groups.get(k) ?? { total: 0, orders: 0 };
    g.total += v;
    g.orders += 1;
    groups.set(k, g);
  };
  for (const p of pos) {
    if (a.group_by === "material") for (const i of p.items) add(i.material.name, num(i.amount) * (1 + i.gstPercent / 100));
    else if (a.group_by === "project") add(projName(ctx, p.projectId), num(p.total));
    else if (a.group_by === "month") add(p.createdAt.toISOString().slice(0, 7), num(p.total));
    else add(p.vendor.name, num(p.total));
  }
  const total = pos.reduce((s, p) => s + num(p.total), 0);
  const rows = [...groups.entries()].sort((x, y) => (a.group_by === "month" ? x[0].localeCompare(y[0]) : y[1].total - x[1].total)).slice(0, 30);
  return {
    period: `${from ? d(from) : "start"} – ${to ? d(to) : "today"}`,
    total_spend_incl_gst: inr(total, false),
    purchase_orders: pos.length,
    group_by: a.group_by,
    groups: rows.map(([k, g]) => ({ name: k, spend: inr(g.total, false), share: total ? `${Math.round((g.total / total) * 100)}%` : "0%", orders: g.orders })),
  };
}

const IMPL: Record<string, (ctx: ToolCtx, a: Args) => Promise<unknown>> = {
  get_overview: getOverview,
  search_materials: searchMaterials,
  list_rfqs: listRfqs,
  get_rfq: getRfq,
  list_purchase_orders: listPos,
  get_purchase_order: getPo,
  list_vendors: listVendors,
  get_vendor: getVendor,
  get_rate_history: getRateHistory,
  list_approvals: listApprovals,
  list_deliveries: listDeliveries,
  list_material_requests: listMaterialRequests,
  spend_summary: spendSummary,
};

export async function runTool(name: string, args: Args, ctx: ToolCtx): Promise<unknown> {
  const fn = IMPL[name];
  if (!fn) return { error: `Unknown tool ${name}` };
  try {
    return await fn(ctx, args ?? {});
  } catch (e) {
    console.error("[copilot tool]", name, e);
    return { error: `Could not read ${name.replace(/_/g, " ")}: ${(e as Error).message.slice(0, 200)}` };
  }
}
