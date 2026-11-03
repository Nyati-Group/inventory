import { db } from "../db";
import { num, inr } from "../utils";
import { audit } from "../audit";
import { notifyRoles, notifyUser } from "../notifications";
import { queueEmail } from "../email/service";
import { layout, p, kv, button } from "../email/templates";
import { appUrl } from "../tokens";
import { createPurchaseOrders } from "./orders";
import type { SessionUser } from "../auth";

export interface ApprovalInput {
  rfqId: string;
  selectedVendorId?: string;
  overrideReason?: string;
  split?: { vendorId: string; quantity: number }[];
  note?: string;
}

/** Create a multi-level approval request for the chosen vendor (or split award). */
export async function requestApproval(d: ApprovalInput, user: SessionUser) {
  const rfq = await db.rFQ.findUniqueOrThrow({
    where: { id: d.rfqId },
    include: { items: true, comparisonRuns: { where: { isLatest: true }, include: { scores: true } }, quotations: { include: { activeVersion: true } } },
  });
  if (!["SENT", "PARTIALLY_RESPONDED", "CLOSED"].includes(rfq.status)) throw new Error(`RFQ is ${rfq.status.toLowerCase().replace("_", " ")}`);
  const run0 = rfq.comparisonRuns[0];
  if (!run0) throw new Error("No comparison available yet");
  const recommended = run0.recommendedVendorId;
  const needsReview = rfq.quotations.filter((q) => q.activeVersion?.parseStatus === "NEEDS_REVIEW");
  if (needsReview.length) throw new Error(`Review ${needsReview.length} quotation(s) marked "Needs review" first`);

  let amount = 0;
  let selected = d.selectedVendorId ?? recommended ?? undefined;
  if (d.split?.length) {
    for (const part of d.split) {
      const v = rfq.quotations.find((q) => q.vendorId === part.vendorId)?.activeVersion;
      if (!v?.landedCost || !v.quantity) throw new Error("Split vendor has no valid quotation");
      amount += (num(v.landedCost) / num(v.quantity)) * part.quantity;
    }
    const total = d.split.reduce((s, x) => s + x.quantity, 0);
    if (total + 1e-9 < num(rfq.items[0].quantity)) throw new Error("Split quantities must cover the RFQ quantity");
    selected = d.split[0].vendorId;
  } else {
    if (!selected) throw new Error("Choose a vendor");
    const score = run0.scores.find((s) => s.vendorId === selected);
    if (!score) throw new Error("Selected vendor has no scored quotation");
    if (score.disqualified && !d.overrideReason?.trim()) throw new Error(`This vendor is disqualified (${score.disqualifyReason}). A reason is required.`);
    amount = num(score.landedCost);
  }
  if (selected !== recommended && !d.split?.length && !d.overrideReason?.trim()) throw new Error("A reason is required when choosing a vendor other than the recommended one");

  const rules = await db.approvalRule.findMany({ where: { projectId: rfq.projectId }, orderBy: { level: "asc" } });
  const applicable = rules.filter((r) => amount >= num(r.minAmount));
  if (!applicable.length) throw new Error("No approver configured for this project (Project Settings → Approvals)");

  const req = await db.approvalRequest.create({
    data: {
      rfqId: rfq.id,
      projectId: rfq.projectId,
      comparisonRunId: run0.id,
      recommendedVendorId: recommended,
      selectedVendorId: selected,
      amount,
      requestedById: user.id,
      note: d.note,
      overrideReason: d.overrideReason,
      splitAward: (d.split ?? undefined) as never,
      steps: { create: applicable.map((r) => ({ level: r.level, label: r.label, approverId: r.userId })) },
    },
  });
  await db.rFQ.update({ where: { id: rfq.id }, data: { status: "AWAITING_APPROVAL" } });
  await audit(user, "ApprovalRequest", req.id, "REQUESTED", { after: { amount, selected, split: d.split, overrideReason: d.overrideReason }, projectId: rfq.projectId });
  await notifyApprover(req.id);
  return req;
}

async function notifyApprover(requestId: string) {
  const req = await db.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { steps: { orderBy: { level: "asc" }, include: { approver: true } }, rfq: { include: { items: { include: { material: true } } } } } });
  const step = req.steps.find((s) => s.status === "PENDING");
  if (!step?.approver) return;
  await notifyUser(step.approver.id, req.projectId, {
    type: "APPROVAL",
    title: `Approval needed — ${req.rfq.number}`,
    body: `${req.rfq.items[0].material.name}: ${inr(num(req.amount), false)} (${step.label})`,
    link: `/rfqs/${req.rfqId}?tab=approval`,
  });
  await queueEmail({
    idempotencyKey: `approval:${req.id}:step:${step.id}`,
    to: [step.approver.email],
    subject: `Approval needed: ${req.rfq.number} — ${inr(num(req.amount), false)}`,
    html: layout(
      "Purchase approval requested",
      `${p(`Hello ${step.approver.name},`)}${p("A vendor recommendation is waiting for your approval.")}${kv([
        ["RFQ", req.rfq.number],
        ["Material", req.rfq.items[0].material.name],
        ["Amount (landed)", inr(num(req.amount))],
        ["Your step", `Level ${step.level} — ${step.label}`],
      ])}${button(appUrl(`/rfqs/${req.rfqId}?tab=approval`), "Review & decide")}`,
    ),
    relatedType: "ApprovalRequest",
    relatedId: req.id,
    projectId: req.projectId,
  });
}

export interface DecisionInput {
  requestId: string;
  decision: "APPROVE" | "CHOOSE_OTHER" | "REJECT" | "RE_RFQ";
  vendorId?: string;
  comment?: string;
}

/** Record one approver's decision; the final approval generates the purchase order(s). */
export async function decideApprovalRequest(d: DecisionInput, user: SessionUser) {
  const req = await db.approvalRequest.findUniqueOrThrow({ where: { id: d.requestId }, include: { steps: { orderBy: { level: "asc" } }, rfq: { include: { comparisonRuns: { where: { isLatest: true }, include: { scores: true } } } } } });
  if (req.status !== "PENDING") throw new Error("This request has already been decided");
  const step = req.steps.find((s) => s.status === "PENDING");
  if (!step) throw new Error("No pending step");
  if (step.approverId !== user.id && user.role !== "ADMIN") throw new Error(`Waiting for level ${step.level} (${step.label}) approver`);
  if (d.decision !== "APPROVE" && !d.comment?.trim()) throw new Error("A reason is mandatory for this decision");

  if (d.decision === "REJECT" || d.decision === "RE_RFQ") {
    await db.$transaction([
      db.approvalStep.update({ where: { id: step.id }, data: { status: d.decision === "REJECT" ? "REJECTED" : "RE_RFQ", comment: d.comment, decidedAt: new Date(), approverId: user.id } }),
      db.approvalRequest.update({ where: { id: req.id }, data: { status: d.decision === "REJECT" ? "REJECTED" : "RE_RFQ", decidedAt: new Date() } }),
      db.rFQ.update({ where: { id: req.rfqId }, data: { status: d.decision === "REJECT" ? "CLOSED" : "CANCELLED" } }),
    ]);
    await audit(user, "ApprovalRequest", req.id, d.decision, { after: { comment: d.comment }, projectId: req.projectId });
    if (req.requestedById)
      await notifyUser(req.requestedById, req.projectId, {
        type: "APPROVAL_DECISION",
        title: `${req.rfq.number} ${d.decision === "REJECT" ? "rejected" : "sent back for re-RFQ"}`,
        body: d.comment,
        link: d.decision === "RE_RFQ" ? `/procurement` : `/rfqs/${req.rfqId}`,
      });
    return { status: d.decision as string, poIds: [] as string[] };
  }

  let selectedVendorId = req.selectedVendorId;
  let amount = num(req.amount);
  if (d.decision === "CHOOSE_OTHER") {
    const score = req.rfq.comparisonRuns[0]?.scores.find((s) => s.vendorId === d.vendorId);
    if (!d.vendorId || !score) throw new Error("Choose a vendor with a scored quotation");
    selectedVendorId = d.vendorId;
    amount = num(score.landedCost);
  }
  await db.approvalStep.update({ where: { id: step.id }, data: { status: "APPROVED", comment: d.comment, decidedAt: new Date(), approverId: user.id } });
  await db.approvalRequest.update({
    where: { id: req.id },
    data: {
      selectedVendorId,
      amount,
      overrideReason: d.decision === "CHOOSE_OTHER" ? `Approver (${user.name}): ${d.comment}` : req.overrideReason,
      ...(d.decision === "CHOOSE_OTHER" ? { splitAward: undefined } : {}),
    },
  });
  // If the approver picked a costlier vendor, higher approval levels may now apply.
  const rules = await db.approvalRule.findMany({ where: { projectId: req.projectId, level: { gt: step.level } } });
  for (const r of rules.filter((r) => amount >= num(r.minAmount) && !req.steps.some((s) => s.level === r.level)))
    await db.approvalStep.create({ data: { requestId: req.id, level: r.level, label: r.label, approverId: r.userId } });
  const remaining = await db.approvalStep.findMany({ where: { requestId: req.id, status: "PENDING", id: { not: step.id } } });
  await audit(user, "ApprovalRequest", req.id, d.decision === "CHOOSE_OTHER" ? "APPROVED_OTHER_VENDOR" : "STEP_APPROVED", {
    before: { selectedVendorId: req.selectedVendorId },
    after: { selectedVendorId, level: step.level, comment: d.comment },
    projectId: req.projectId,
  });
  if (remaining.length) {
    await notifyApprover(req.id);
    return { status: "NEXT_LEVEL", poIds: [] as string[] };
  }
  await db.approvalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedAt: new Date() } });
  await db.rFQ.update({ where: { id: req.rfqId }, data: { status: "APPROVED" } });
  const poIds = await createPurchaseOrders(req.id, user);
  if (req.requestedById)
    await notifyUser(req.requestedById, req.projectId, { type: "APPROVAL_DECISION", title: `${req.rfq.number} approved — PO created`, body: "Review and send the purchase order to the vendor.", link: `/purchase-orders/${poIds[0]}` });
  await notifyRoles(req.projectId, ["SITE_ENGINEER"], { type: "PO_CREATED", title: `PO created for ${req.rfq.number}`, link: `/purchase-orders/${poIds[0]}` });
  return { status: "APPROVED", poIds };
}
