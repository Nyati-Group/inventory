import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { notifyRoles } from "@/lib/notifications";
import { addDeliveryUpdate } from "@/lib/services/orders";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("change"), note: z.string().min(5).max(1000) }),
  z.object({
    action: z.literal("dispatch"),
    status: z.enum(["DISPATCHED", "IN_TRANSIT", "DELAYED", "ARRIVED"]),
    vehicleNo: z.string().max(30).optional(),
    driverName: z.string().max(60).optional(),
    driverPhone: z.string().max(20).optional(),
    eta: z.string().optional(),
    note: z.string().max(500).optional(),
  }),
]);

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  if (!rateLimit(`vpo:${ip}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const po = params.token.length >= 20 ? await db.purchaseOrder.findFirst({ where: { vendorTokenHash: hashToken(params.token) }, include: { vendor: true } }) : null;
  if (!po || (po.tokenExpiresAt && po.tokenExpiresAt < new Date())) return NextResponse.json({ error: "This link is not valid or has expired." }, { status: 404 });
  if (["CANCELLED", "CLOSED"].includes(po.status)) return NextResponse.json({ error: "This purchase order is closed." }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please check the values you entered." }, { status: 400 });
  const b = parsed.data;
  const actor = { label: `vendor: ${po.vendor.name}` };

  if (b.action === "accept") {
    if (!["SENT", "CHANGE_REQUESTED"].includes(po.status)) return NextResponse.json({ error: "This PO is not awaiting acceptance." }, { status: 400 });
    await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), changeRequestNote: null } });
    await audit(actor, "PurchaseOrder", po.id, "ACCEPTED_BY_VENDOR", { before: { status: po.status }, ip, projectId: po.projectId });
    await notifyRoles(po.projectId, ["PROCUREMENT_MANAGER", "SITE_ENGINEER"], { type: "PO_ACCEPTED", title: `${po.vendor.name} accepted ${po.number}`, link: `/purchase-orders/${po.id}` });
  } else if (b.action === "change") {
    if (!["SENT", "ACCEPTED"].includes(po.status)) return NextResponse.json({ error: "Changes can't be requested at this stage." }, { status: 400 });
    await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "CHANGE_REQUESTED", changeRequestNote: b.note } });
    await audit(actor, "PurchaseOrder", po.id, "CHANGE_REQUESTED", { after: { note: b.note }, ip, projectId: po.projectId });
    await notifyRoles(po.projectId, ["PROCUREMENT_MANAGER"], { type: "PO_CHANGE", title: `${po.vendor.name} requested a change to ${po.number}`, body: b.note, link: `/purchase-orders/${po.id}` });
  } else {
    if (!["SENT", "ACCEPTED", "PARTIALLY_DELIVERED"].includes(po.status)) return NextResponse.json({ error: "Dispatch updates are not open for this PO." }, { status: 400 });
    await addDeliveryUpdate(po.id, "VENDOR", { status: b.status, vehicleNo: b.vehicleNo, driverName: b.driverName, driverPhone: b.driverPhone, eta: b.eta ? new Date(b.eta) : null, note: b.note });
  }
  return NextResponse.json({ ok: true });
}
