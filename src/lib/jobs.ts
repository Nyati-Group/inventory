import { db } from "./db";
import { num, fmtDateTime } from "./utils";
import { processEmailQueue } from "./email/service";
import { sendRfqReminders, closeExpiredRfqs } from "./services/rfq";
import { processQuotationVersion } from "./quotation/process";
import { notifyRoles } from "./notifications";

/** DB-backed job queue. Swap for BullMQ/Redis when running multiple app instances. */
export async function enqueueJob(type: string, payload: Record<string, unknown>, opts: { runAt?: Date; dedupeKey?: string } = {}) {
  if (opts.dedupeKey) {
    const existing = await db.job.findFirst({ where: { dedupeKey: opts.dedupeKey } });
    if (existing) return existing;
  }
  return db.job.create({ data: { type, payload: payload as never, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey } });
}

const HANDLERS: Record<string, (payload: Record<string, unknown>) => Promise<void>> = {
  PARSE_QUOTATION: async (p) => processQuotationVersion(String(p.versionId)),
};

async function runQueuedJobs() {
  const jobs = await db.job.findMany({ where: { status: "PENDING", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, take: 10 });
  for (const job of jobs) {
    const claimed = await db.job.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      await HANDLERS[job.type]?.(job.payload as Record<string, unknown>);
      await db.job.update({ where: { id: job.id }, data: { status: "DONE", doneAt: new Date() } });
    } catch (e) {
      const retry = job.attempts + 1 < 3;
      await db.job.update({
        where: { id: job.id },
        data: { status: retry ? "PENDING" : "FAILED", lastError: (e as Error).message.slice(0, 1000), runAt: new Date(Date.now() + 60_000 * (job.attempts + 1)) },
      });
    }
  }
  return jobs.length;
}

/** Stock ≤ reorder level → automatic material request + alert (once per open request). */
async function lowStockAlerts() {
  const stocks = await db.materialProjectStock.findMany({ include: { material: true, project: true } });
  let created = 0;
  for (const s of stocks) {
    if (num(s.currentQty) > num(s.reorderLevel) || num(s.reorderLevel) <= 0 || s.project.deletedAt) continue;
    const open = await db.materialRequest.findFirst({ where: { projectId: s.projectId, materialId: s.materialId, status: { in: ["OPEN", "RFQ_CREATED"] } } });
    const openRfq = await db.rFQ.findFirst({
      where: { projectId: s.projectId, items: { some: { materialId: s.materialId } }, status: { in: ["SENT", "PARTIALLY_RESPONDED", "CLOSED", "AWAITING_APPROVAL", "APPROVED"] } },
    });
    if (open || openRfq) continue;
    const q = Math.max(num(s.reorderLevel) * 2 - num(s.currentQty), 0);
    await db.materialRequest.create({ data: { projectId: s.projectId, materialId: s.materialId, qty: q, source: "AUTO", note: "Stock at or below reorder level" } });
    await notifyRoles(s.projectId, ["PROCUREMENT_MANAGER", "SITE_ENGINEER"], {
      type: "LOW_STOCK",
      title: `Low stock: ${s.material.name}`,
      body: `${num(s.currentQty)} ${s.material.unit} left (reorder level ${num(s.reorderLevel)}). One-click RFQ available.`,
      link: `/procurement?lowStock=1`,
    });
    created++;
  }
  return created;
}

/** Deadline approaching (≤ 6 h) and late deliveries — one notification each. */
async function deadlineAndDelayAlerts() {
  const soon = await db.rFQ.findMany({
    where: { status: { in: ["SENT", "PARTIALLY_RESPONDED"] }, deadline: { gt: new Date(), lt: new Date(Date.now() + 6 * 3600_000) } },
  });
  for (const r of soon) {
    const job = await enqueueJob("NOTICE", {}, { dedupeKey: `deadline:${r.id}` });
    if (job.status !== "PENDING" || job.attempts > 0) continue;
    await db.job.update({ where: { id: job.id }, data: { status: "DONE", doneAt: new Date() } });
    await notifyRoles(r.projectId, ["PROCUREMENT_MANAGER"], {
      type: "DEADLINE",
      title: `RFQ ${r.number} closes soon`,
      body: `Deadline ${fmtDateTime(r.deadline)}`,
      link: `/rfqs/${r.id}`,
    });
  }
  const late = await db.purchaseOrder.findMany({ where: { status: { in: ["SENT", "ACCEPTED", "PARTIALLY_DELIVERED"] }, expectedDeliveryDate: { lt: new Date() } } });
  for (const po of late) {
    const day = new Date().toISOString().slice(0, 10);
    const job = await enqueueJob("NOTICE", {}, { dedupeKey: `late:${po.id}:${day}` });
    if (job.status !== "PENDING" || job.attempts > 0) continue;
    await db.job.update({ where: { id: job.id }, data: { status: "DONE", doneAt: new Date() } });
    await notifyRoles(po.projectId, ["PROCUREMENT_MANAGER", "SITE_ENGINEER"], {
      type: "DELIVERY_DELAYED",
      title: `Delivery overdue — ${po.number}`,
      body: "Expected delivery date has passed without full receipt.",
      link: `/purchase-orders/${po.id}`,
    });
  }
}

let running = false;
/** One sweep of all background work. Called every minute by instrumentation and by /api/cron. */
export async function runDueJobs() {
  if (running) return { skipped: true };
  running = true;
  try {
    const out = {
      jobs: await runQueuedJobs(),
      emails: await processEmailQueue(),
      reminders: await sendRfqReminders(),
      closed: await closeExpiredRfqs(),
      lowStock: await lowStockAlerts(),
    };
    await deadlineAndDelayAlerts();
    return out;
  } finally {
    running = false;
  }
}
