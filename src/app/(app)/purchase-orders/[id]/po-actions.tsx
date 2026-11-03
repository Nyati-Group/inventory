"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, FileDown, PackageCheck, Truck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { GrnDialog, type PoForForms } from "@/components/order-forms";
import { sendPurchaseOrder, cancelPurchaseOrder, buyerDeliveryUpdate, resolveReturn } from "@/server/actions/orders";

export function PoActions(p: {
  po: PoForForms;
  status: string;
  pdfUrl: string | null;
  canManage: boolean;
  canReceive: boolean;
  returns: { id: string; status: string }[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [sendOpen, setSendOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [grn, setGrn] = React.useState(false);
  const [delivery, setDelivery] = React.useState(false);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
      after?.();
      router.refresh();
    });
  const s = p.status;
  const openReturn = p.returns.find((r) => r.status === "OPEN");

  return (
    <>
      {p.pdfUrl && <Button variant="secondary" asChild><a href={p.pdfUrl} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" /> PO PDF</a></Button>}
      {p.canManage && ["APPROVED", "CHANGE_REQUESTED"].includes(s) && <Button onClick={() => setSendOpen(true)}><Send className="h-4 w-4" /> {s === "CHANGE_REQUESTED" ? "Re-send PO" : "Send PO to vendor"}</Button>}
      {p.canReceive && ["SENT", "ACCEPTED", "PARTIALLY_DELIVERED"].includes(s) && <Button variant="secondary" onClick={() => setDelivery(true)}><Truck className="h-4 w-4" /> Delivery update</Button>}
      {p.canReceive && ["SENT", "ACCEPTED", "PARTIALLY_DELIVERED", "APPROVED"].includes(s) && <Button onClick={() => setGrn(true)}><PackageCheck className="h-4 w-4" /> Record GRN</Button>}
      {p.canReceive && openReturn && <Button variant="secondary" loading={pending} onClick={() => act(() => resolveReturn(openReturn.id, "REPLACED"), "Replacement received")}>Mark replacement received</Button>}
      {p.canManage && ["APPROVED", "SENT", "ACCEPTED", "CHANGE_REQUESTED"].includes(s) && <Button variant="ghost" onClick={() => setCancelOpen(true)}><XCircle className="h-4 w-4" /> Cancel</Button>}

      <ConfirmDialog open={sendOpen} onOpenChange={setSendOpen} title="Email this PO to the vendor?" description="The vendor receives the PO PDF with a secure link to accept / request changes and post dispatch details." confirmLabel="Send PO" loading={pending} onConfirm={() => act(() => sendPurchaseOrder(p.po.id), "PO sent", () => setSendOpen(false))} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel this purchase order?" confirmLabel="Cancel PO" danger loading={pending} onConfirm={() => act(() => cancelPurchaseOrder(p.po.id, reason), "PO cancelled", () => setCancelOpen(false))}>
        <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <GrnDialog po={grn ? p.po : null} open={grn} onOpenChange={setGrn} />
      <Dialog open={delivery} onOpenChange={setDelivery}>
        <DialogContent title="Delivery update" description="Delays and late ETAs alert procurement and site.">
          <form action={(fd) => act(() => buyerDeliveryUpdate(p.po.id, { status: String(fd.get("status")) as "DELAYED", eta: String(fd.get("eta") || "") || undefined, note: String(fd.get("note") || "") || undefined, vehicleNo: String(fd.get("vehicleNo") || "") || undefined }), "Update saved", () => setDelivery(false))} className="space-y-3">
            <Field label="Status"><Select name="status"><option value="DISPATCHED">Dispatched</option><option value="IN_TRANSIT">In transit</option><option value="DELAYED">Delayed</option><option value="ARRIVED">Arrived at site</option></Select></Field>
            <Field label="ETA"><Input type="datetime-local" name="eta" /></Field>
            <Field label="Vehicle no."><Input name="vehicleNo" /></Field>
            <Field label="Note"><Textarea name="note" rows={2} /></Field>
            <div className="flex justify-end"><Button type="submit" loading={pending}>Save</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
