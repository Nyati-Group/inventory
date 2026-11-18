import { db, notDeleted } from "./db";
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
  // Batched: a fixed handful of queries per sweep, however many materials there are.
  const all = await db.materialProjectStock.findMany({ select: { projectId: true, materialId: true, currentQty: true, reorderLevel: true } });
  const low = all.filter((s) => num(s.reorderLevel) > 0 && num(s.currentQty) <= num(s.reorderLevel));
  if (!low.length) return 0;
  const projectIds = [...new Set(low.map((s) => s.projectId))];
  const materialIds = [...new Set(low.map((s) => s.materialId))];
  const [liveProjects, openRequests, openRfqs] = await Promise.all([
    db.project.findMany({ where: { id: { in: projectIds }, deletedAt: notDeleted }, select: { id: true } }),
    db.materialRequest.findMany({ where: { projectId: { in: projectIds }, materialId: { in: materialIds }, status: { in: ["OPEN", "RFQ_CREATED"] } }, select: { projectId: true, materialId: true } }),
    db.rFQ.findMany({
      where: { projectId: { in: projectIds }, status: { in: ["SENT", "PARTIALLY_RESPONDED", "CLOSED", "AWAITING_APPROVAL", "APPROVED"] } },
      select: { projectId: true, items: { select: { materialId: true } } },
    }),
  ]);
  const live = new Set(liveProjects.map((p) => p.id));
  const covered = new Set([
    ...openRequests.map((r) => `${r.projectId}:${r.materialId}`),
    ...openRfqs.flatMap((r) => r.items.map((i) => `${r.projectId}:${i.materialId}`)),
  ]);
  const todo = low.filter((s) => live.has(s.projectId) && !covered.has(`${s.projectId}:${s.materialId}`));
  if (!todo.length) return 0;
  const materials = new Map((await db.material.findMany({ where: { id: { in: todo.map((s) => s.materialId) } }, select: { id: true, name: true, unit: true } })).map((m) => [m.id, m]));
  let created = 0;
  for (const s of todo) {
    const m = materials.get(s.materialId);
    if (!m) continue;
    const q = Math.max(num(s.reorderLevel) * 2 - num(s.currentQty), 0);
    await db.materialRequest.create({ data: { projectId: s.projectId, materialId: s.materialId, qty: q, source: "AUTO", note: "Stock at or below reorder level" } });
    await notifyRoles(s.projectId, ["PROCUREMENT_MANAGER", "SITE_ENGINEER"], {
      type: "LOW_STOCK",
      title: `Low stock: ${m.name}`,
      body: `${num(s.currentQty)} ${m.unit} left (reorder level ${num(s.reorderLevel)}). One-click RFQ available.`,
      link: `/procurement?lowStock=1`,
    });
    created++;
  }
  return created;
}

/** Deadline approaching (≤ 6 h) and late deliveries — one notification each. */
/** Keys (from `keys`) that have not been notified yet; records them as done so each fires once. */
async function claimNotices(keys: string[]) {
  if (!keys.length) return new Set<string>();
  const existing = await db.job.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } });
  const seen = new Set(existing.map((j) => j.dedupeKey));
  const fresh = keys.filter((k) => !seen.has(k));
  if (fresh.length) await db.job.createMany({ data: fresh.map((k) => ({ type: "NOTICE", payload: {}, dedupeKey: k, status: "DONE" as const, doneAt: new Date() })) });
  return new Set(fresh);
}

async function deadlineAndDelayAlerts() {
  const day = new Date().toISOString().slice(0, 10);
  const [soon, late] = await Promise.all([
    db.rFQ.findMany({
      where: { status: { in: ["SENT", "PARTIALLY_RESPONDED"] }, deadline: { gt: new Date(), lt: new Date(Date.now() + 6 * 3600_000) } },
      select: { id: true, number: true, projectId: true, deadline: true },
    }),
    db.purchaseOrder.findMany({
      where: { status: { in: ["SENT", "ACCEPTED", "PARTIALLY_DELIVERED"] }, expectedDeliveryDate: { lt: new Date() } },
      select: { id: true, number: true, projectId: true },
    }),
  ]);
  const [newDeadlines, newLate] = await Promise.all([claimNotices(soon.map((r) => `deadline:${r.id}`)), claimNotices(late.map((po) => `late:${po.id}:${day}`))]);
  for (const r of soon) {
    if (!newDeadlines.has(`deadline:${r.id}`)) continue;
    await notifyRoles(r.projectId, ["PROCUREMENT_MANAGER"], {
      type: "DEADLINE",
      title: `RFQ ${r.number} closes soon`,
      body: `Deadline ${fmtDateTime(r.deadline)}`,
      link: `/rfqs/${r.id}`,
    });
  }
  for (const po of late) {
    if (!newLate.has(`late:${po.id}:${day}`)) continue;
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
