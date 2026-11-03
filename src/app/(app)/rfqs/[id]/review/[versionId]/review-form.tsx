"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { computeLanded } from "@/lib/engine/landed-cost";
import { confirmQuotationReview } from "@/server/actions/rfq";
import { inr } from "@/lib/utils";

type Init = {
  versionId: string;
  unitRate: number | null;
  quantity: number;
  gstPercent: number;
  freight: number;
  loading: number;
  otherCharges: number;
  statedTotal: number | null;
  deliveryDate: string | null;
  deliveryDays: number | null;
  paymentTerms: string | null;
  validityDays: number | null;
  warranty: string | null;
  deviations: string[];
};

export function ReviewForm({ initial, unit, rfqId, readOnly }: { initial: Init; unit: string; rfqId: string; readOnly: boolean }) {
  const router = useRouter();
  const [f, setF] = React.useState({
    unitRate: String(initial.unitRate ?? ""),
    quantity: String(initial.quantity),
    gstPercent: String(initial.gstPercent),
    freight: String(initial.freight),
    loading: String(initial.loading),
    otherCharges: String(initial.otherCharges),
    statedTotal: String(initial.statedTotal ?? ""),
    deliveryDate: initial.deliveryDate ?? "",
    deliveryDays: String(initial.deliveryDays ?? ""),
    paymentTerms: initial.paymentTerms ?? "",
    validityDays: String(initial.validityDays ?? ""),
    warranty: initial.warranty ?? "",
    deviations: initial.deviations.join("\n"),
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const n = (s: string) => (s.trim() === "" ? null : Number(s));
  const live = n(f.unitRate)
    ? computeLanded({ items: [{ quantity: n(f.quantity) ?? 0, unitRate: n(f.unitRate)!, gstPercent: n(f.gstPercent) ?? 0 }], freight: n(f.freight) ?? 0, loading: n(f.loading) ?? 0, other: n(f.otherCharges) ?? 0, statedTotal: n(f.statedTotal) })
    : null;

  const submit = () =>
    start(async () => {
      const r = await confirmQuotationReview({
        versionId: initial.versionId,
        unitRate: n(f.unitRate) ?? 0,
        quantity: n(f.quantity) ?? 0,
        gstPercent: n(f.gstPercent) ?? 0,
        freight: n(f.freight) ?? 0,
        loading: n(f.loading) ?? 0,
        otherCharges: n(f.otherCharges) ?? 0,
        statedTotal: n(f.statedTotal),
        deliveryDate: f.deliveryDate || null,
        deliveryDays: n(f.deliveryDays),
        paymentTerms: f.paymentTerms || null,
        validityDays: n(f.validityDays),
        warranty: f.warranty || null,
        deviations: f.deviations.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Confirmed — landed cost ${inr(r.data.landedCost, false)}. Comparison updated.`);
      router.push(`/rfqs/${rfqId}?tab=comparison`);
      router.refresh();
    });

  return (
    <fieldset disabled={readOnly} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Unit rate (₹/${unit}, pre-tax)`}><Input type="number" step="any" value={f.unitRate} onChange={set("unitRate")} /></Field>
        <Field label={`Quantity offered (${unit})`}><Input type="number" step="any" value={f.quantity} onChange={set("quantity")} /></Field>
        <Field label="GST %"><Input type="number" step="any" value={f.gstPercent} onChange={set("gstPercent")} /></Field>
        <Field label="Freight / transport (₹)"><Input type="number" step="any" value={f.freight} onChange={set("freight")} /></Field>
        <Field label="Loading / unloading (₹)"><Input type="number" step="any" value={f.loading} onChange={set("loading")} /></Field>
        <Field label="Other charges (₹)"><Input type="number" step="any" value={f.otherCharges} onChange={set("otherCharges")} /></Field>
        <Field label="Vendor's stated total (₹)"><Input type="number" step="any" value={f.statedTotal} onChange={set("statedTotal")} /></Field>
        <Field label="Promised delivery date"><Input type="date" value={f.deliveryDate} onChange={set("deliveryDate")} /></Field>
        <Field label="…or delivery days"><Input type="number" value={f.deliveryDays} onChange={set("deliveryDays")} /></Field>
        <Field label="Payment terms" className="sm:col-span-2"><Input value={f.paymentTerms} onChange={set("paymentTerms")} /></Field>
        <Field label="Validity (days)"><Input type="number" value={f.validityDays} onChange={set("validityDays")} /></Field>
        <Field label="Warranty" className="sm:col-span-3"><Input value={f.warranty} onChange={set("warranty")} /></Field>
        <Field label="Deviations / exclusions (one per line)" className="sm:col-span-3"><Textarea rows={3} value={f.deviations} onChange={set("deviations")} /></Field>
      </div>
      <div className="rounded-lg bg-brand-100 px-3 py-2 text-sm">
        {live ? (
          <>
            Sub-total {inr(live.subtotal, false)} + GST {inr(live.gstTotal, false)} + charges {inr(live.charges, false)} = <strong>landed {inr(live.landedCost, false)}</strong>
            {live.mismatch && <span className="block text-danger">Vendor's total differs by {inr(live.mismatchAmount, false)} — check the document.</span>}
          </>
        ) : (
          "Enter the unit rate to compute landed cost."
        )}
      </div>
      {!readOnly && (
        <Button onClick={submit} loading={pending} disabled={!n(f.unitRate)}>
          <CheckCircle2 className="h-4 w-4" /> Confirm & update comparison
        </Button>
      )}
    </fieldset>
  );
}
