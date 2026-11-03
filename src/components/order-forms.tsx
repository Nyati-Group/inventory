"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "./ui/dialog";
import { Field, Input, Textarea, Checkbox } from "./ui/form";
import { Button } from "./ui/button";
import { recordGrnAction } from "@/server/actions/orders";
import { qty, round2 } from "@/lib/utils";

export type PoForForms = {
  id: string;
  number: string;
  vendor: string;
  freight: number;
  items: { id: string; description: string; unit: string; quantity: number; acceptedQty: number; receivedQty: number; unitRate: number; gstPercent: number }[];
};

export function GrnDialog({ po, open, onOpenChange }: { po: PoForForms | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [lines, setLines] = React.useState<Record<string, { delivered: string; accepted: string; reason: string }>>({});
  const [qc, setQc] = React.useState({ specMatch: true, noDamage: true, packagingOk: true, testCertProvided: false });
  const [pending, start] = React.useTransition();
  React.useEffect(() => {
    if (!po) return;
    setLines(Object.fromEntries(po.items.map((i) => { const rem = Math.max(0, i.quantity - i.acceptedQty); return [i.id, { delivered: String(rem), accepted: String(rem), reason: "" }]; })));
  }, [po]);
  if (!po) return null;

  const submit = (fd: FormData) =>
    start(async () => {
      const data = {
        poId: po.id,
        receivedAt: String(fd.get("receivedAt")),
        challanNo: String(fd.get("challanNo") ?? "") || undefined,
        remarks: String(fd.get("remarks") ?? "") || undefined,
        items: po.items.map((i) => ({ poItemId: i.id, deliveredQty: Number(lines[i.id]?.delivered || 0), acceptedQty: Number(lines[i.id]?.accepted || 0), rejectionReason: lines[i.id]?.reason || undefined })),
        ...qc,
        qcNotes: String(fd.get("qcNotes") ?? "") || undefined,
      };
      fd.set("data", JSON.stringify(data));
      const r = await recordGrnAction(fd);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.number} recorded — stock updated`);
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Goods receipt & inspection — ${po.number}`} description={`${po.vendor}. Accepted quantity is added to stock; rejected quantity raises a return/replacement request to the vendor.`} wide>
        <form action={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Received on"><Input name="receivedAt" type="datetime-local" required defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} /></Field>
            <Field label="Delivery challan no."><Input name="challanNo" /></Field>
            <Field label="Challan (scan/photo)"><Input name="challan" type="file" accept=".pdf,.png,.jpg,.jpeg" className="py-1.5" /></Field>
          </div>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Item</th><th className="th text-right">Ordered</th><th className="th text-right">Accepted so far</th><th className="th">Delivered now</th><th className="th">Accepted</th><th className="th">Rejected</th><th className="th">Rejection reason</th></tr></thead>
            <tbody>
              {po.items.map((i) => {
                const l = lines[i.id] ?? { delivered: "0", accepted: "0", reason: "" };
                const rej = round2(Number(l.delivered || 0) - Number(l.accepted || 0));
                const set = (k: "delivered" | "accepted" | "reason", v: string) => setLines({ ...lines, [i.id]: { ...l, [k]: v, ...(k === "delivered" && Number(l.accepted) > Number(v) ? { accepted: v } : {}) } });
                return (
                  <tr key={i.id}>
                    <td className="td">{i.description}</td>
                    <td className="td text-right">{qty(i.quantity, i.unit)}</td>
                    <td className="td text-right">{qty(i.acceptedQty, i.unit)}</td>
                    <td className="td"><Input type="number" step="any" min="0" value={l.delivered} onChange={(e) => set("delivered", e.target.value)} className="w-28" aria-label="Delivered quantity" /></td>
                    <td className="td"><Input type="number" step="any" min="0" max={l.delivered} value={l.accepted} onChange={(e) => set("accepted", e.target.value)} className="w-28" aria-label="Accepted quantity" /></td>
                    <td className="td tabular-nums">{rej > 0 ? <span className="font-semibold text-danger">{qty(rej, i.unit)}</span> : "—"}</td>
                    <td className="td"><Input value={l.reason} onChange={(e) => set("reason", e.target.value)} disabled={rej <= 0} placeholder={rej > 0 ? "Required" : ""} aria-label="Rejection reason" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-brand-800">Quality checklist</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              {([["specMatch", "Spec / grade matches"], ["noDamage", "No damage"], ["packagingOk", "Packaging OK"], ["testCertProvided", "Test certificate provided"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><Checkbox checked={qc[k]} onChange={(e) => setQc({ ...qc, [k]: e.target.checked })} /> {label}</label>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Test certificate"><Input name="cert" type="file" accept=".pdf,.png,.jpg,.jpeg" className="py-1.5" /></Field>
              <Field label="Photos"><Input name="photos" type="file" multiple accept="image/*" className="py-1.5" /></Field>
              <Field label="Inspection notes" className="sm:col-span-2"><Textarea name="qcNotes" rows={2} /></Field>
            </div>
          </fieldset>
          <Field label="Remarks"><Textarea name="remarks" rows={2} /></Field>
          <div className="flex justify-end"><Button type="submit" loading={pending}>Record GRN</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
