"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { audit } from "@/lib/audit";
import { saveFile, validateUpload, guessMime } from "@/lib/storage";
import { sendPo, addDeliveryUpdate, recordGrn, renderPo } from "@/lib/services/orders";
import { run } from "../action-result";

async function poFor(poId: string, user: Awaited<ReturnType<typeof requireRole>>) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  await assertProjectAccess(user, po.projectId);
  return po;
}

async function upload(fd: FormData, field: string, prefix: string) {
  const keys: string[] = [];
  for (const f of fd.getAll(field)) {
    if (!(f instanceof File) || !f.size) continue;
    const mime = f.type || guessMime(f.name);
    const err = validateUpload({ size: f.size, type: mime, name: f.name }, "document");
    if (err) throw new Error(`${f.name}: ${err}`);
    keys.push(await saveFile(prefix, f.name, Buffer.from(await f.arrayBuffer()), mime));
  }
  return keys;
}

export async function sendPurchaseOrder(poId: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await poFor(poId, user);
    await sendPo(poId, user);
    revalidatePath(`/purchase-orders/${poId}`);
    return undefined;
  });
}

export async function regeneratePoPdf(poId: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await poFor(poId, user);
    await renderPo(poId);
    revalidatePath(`/purchase-orders/${poId}`);
    return undefined;
  });
}

export async function cancelPurchaseOrder(poId: string, reason: string) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER", "APPROVER");
    const po = await poFor(poId, user);
    if (reason.trim().length < 3) throw new Error("Reason is required");
    if (!["DRAFT", "APPROVED", "SENT", "ACCEPTED", "CHANGE_REQUESTED"].includes(po.status)) throw new Error("Only orders without deliveries can be cancelled");
    await db.purchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await audit(user, "PurchaseOrder", poId, "CANCELLED", { before: { status: po.status }, after: { reason }, projectId: po.projectId });
    revalidatePath(`/purchase-orders/${poId}`);
    return undefined;
  });
}

export async function buyerDeliveryUpdate(poId: string, d: { status: "DISPATCHED" | "IN_TRANSIT" | "DELAYED" | "ARRIVED"; eta?: string; note?: string; vehicleNo?: string }) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER", "SITE_ENGINEER");
    await poFor(poId, user);
    await addDeliveryUpdate(poId, "BUYER", { status: d.status, eta: d.eta ? new Date(d.eta) : null, note: d.note, vehicleNo: d.vehicleNo });
    revalidatePath(`/purchase-orders/${poId}`);
    return undefined;
  });
}

const GrnSchema = z.object({
  poId: z.string(),
  receivedAt: z.coerce.date(),
  challanNo: z.string().optional(),
  remarks: z.string().optional(),
  items: z.array(z.object({ poItemId: z.string(), deliveredQty: z.number().min(0), acceptedQty: z.number().min(0), rejectionReason: z.string().optional() })).min(1),
  specMatch: z.boolean(),
  noDamage: z.boolean(),
  packagingOk: z.boolean(),
  testCertProvided: z.boolean(),
  qcNotes: z.string().optional(),
});

/** Multipart: "data" (JSON) + challan / cert / photos files. */
export async function recordGrnAction(fd: FormData) {
  return run(async () => {
    const user = await requireRole("SITE_ENGINEER", "PROCUREMENT_MANAGER");
    const d = GrnSchema.parse(JSON.parse(String(fd.get("data"))));
    const po = await poFor(d.poId, user);
    if (!d.items.some((i) => i.deliveredQty > 0)) throw new Error("Enter the received quantity");
    if (d.receivedAt > new Date(Date.now() + 3600_000)) throw new Error("Receipt date cannot be in the future");
    const prefix = `grn/${po.id}`;
    const [challan] = await upload(fd, "challan", prefix);
    const [cert] = await upload(fd, "cert", prefix);
    const photos = await upload(fd, "photos", prefix);
    if (d.testCertProvided && !cert) throw new Error("Upload the test certificate (or untick 'test certificate provided')");
    const grn = await recordGrn(
      {
        poId: d.poId,
        receivedAt: d.receivedAt,
        challanNo: d.challanNo,
        challanKey: challan,
        remarks: d.remarks,
        items: d.items.filter((i) => i.deliveredQty > 0),
        qc: { specMatch: d.specMatch, noDamage: d.noDamage, packagingOk: d.packagingOk, testCertProvided: d.testCertProvided, certKey: cert, photoKeys: photos, notes: d.qcNotes },
      },
      user,
    );
    revalidatePath(`/purchase-orders/${d.poId}`);
    revalidatePath("/deliveries");
    revalidatePath("/procurement");
    return { id: grn.id, number: grn.number };
  });
}

export async function resolveReturn(returnId: string, status: "REPLACED" | "CREDITED" | "CLOSED") {
  return run(async () => {
    const user = await requireRole("SITE_ENGINEER", "PROCUREMENT_MANAGER");
    const r = await db.returnRequest.findUniqueOrThrow({ where: { id: returnId }, include: { po: true } });
    await assertProjectAccess(user, r.po.projectId);
    await db.returnRequest.update({ where: { id: returnId }, data: { status, resolvedAt: new Date() } });
    await audit(user, "ReturnRequest", returnId, status, { before: { status: r.status }, projectId: r.po.projectId });
    revalidatePath(`/purchase-orders/${r.poId}`);
    revalidatePath("/deliveries");
    return undefined;
  });
}
