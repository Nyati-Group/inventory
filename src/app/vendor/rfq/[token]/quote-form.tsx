"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, FileType, Type, Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { Field, Input, Textarea, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const METHODS = [
  { id: "TEXT", label: "Type / paste text", icon: Type, accept: "" },
  { id: "PDF", label: "Upload PDF", icon: FileText, accept: ".pdf,application/pdf" },
  { id: "DOCX", label: "Upload Word (.doc/.docx)", icon: FileType, accept: ".doc,.docx" },
  { id: "IMAGE", label: "Image / Excel", icon: ImageIcon, accept: ".png,.jpg,.jpeg,.xlsx" },
] as const;

const PREFILL_FIELDS = ["unitRate", "quantity", "gstPercent", "freight", "loading", "total", "deliveryDays", "deliveryDate", "validityDays", "paymentTerms", "warranty", "remarks"] as const;
type Prefill = { fields: Partial<Record<(typeof PREFILL_FIELDS)[number], string | number | null>>; confidence: number; method: "ai" | "rules" | "none"; notes: string[] };

const DECLINE =["Out of stock", "Cannot deliver to this location", "Price not workable", "Cannot meet the delivery date", "Other"];

export function VendorQuoteForm({ token, unit, quantity, isRevision }: { token: string; unit: string; quantity: number; isRevision: boolean }) {
  const router = useRouter();
  const [method, setMethod] = React.useState<(typeof METHODS)[number]["id"]>("TEXT");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ referenceNo: string; versionNo: number } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState(DECLINE[0]);
  const [declineOther, setDeclineOther] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);
  const [reading, setReading] = React.useState(false);
  const [prefill, setPrefill] = React.useState<{ filled: string[]; notes: string[]; confidence: number; method: Prefill["method"] } | null>(null);
  const autoFilled = React.useRef(new Set<string>());
  const readSeq = React.useRef(0);

  /** Read the quotation (file or pasted text) on the server and fill the key-figure fields. */
  async function readQuotation(src: { file?: File; text?: string }) {
    const form = formRef.current;
    if (!form) return;
    if (src.file && src.file.size > 10 * 1024 * 1024) return setError("File is larger than 10 MB.");
    const seq = ++readSeq.current;
    setReading(true);
    setPrefill(null);
    const fd = new FormData();
    if (src.file) fd.set("file", src.file);
    if (src.text) fd.set("text", src.text);
    const res = await fetch(`/api/vendor/rfq/${token}/prefill`, { method: "POST", body: fd }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as (Prefill & { error?: string }) | null;
    if (seq !== readSeq.current) return; // a newer file was chosen meanwhile
    setReading(false);
    if (!res?.ok || !j || j.error) return setPrefill({ filled: [], notes: [j?.error ?? "Could not read the quotation — please type the key figures."], confidence: 0, method: "none" });
    const filled: string[] = [];
    for (const name of PREFILL_FIELDS) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      const v = j.fields[name];
      if (!el || v === null || v === undefined || v === "") continue;
      // Never overwrite something the vendor typed themselves; do replace values we filled earlier.
      if (el.value && !autoFilled.current.has(name)) continue;
      el.value = String(v);
      autoFilled.current.add(name);
      filled.push(name);
    }
    setPrefill({ filled, notes: j.notes, confidence: j.confidence, method: j.method });
  }

  const af = (name: string) => (prefill?.filled.includes(name) ? "border-brand-600 bg-brand-100/60" : undefined);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (reading) return setError("Please wait — we're still reading your quotation.");
    const fd = new FormData(e.currentTarget);
    fd.set("method", method === "IMAGE" ? ((fd.get("file") as File)?.name?.toLowerCase().endsWith(".xlsx") ? "XLSX" : "IMAGE") : method);
    const file = fd.get("file") as File | null;
    if (file && file.size > 10 * 1024 * 1024) return setError("File is larger than 10 MB.");
    setSubmitting(true);
    const res = await fetch(`/api/vendor/rfq/${token}`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({ error: "Unexpected response" }));
    setSubmitting(false);
    if (!res.ok) return setError(j.error ?? "Submission failed");
    setDone({ referenceNo: j.referenceNo, versionNo: j.versionNo });
    router.refresh();
  }

  async function decline() {
    const fd = new FormData();
    fd.set("action", "decline");
    fd.set("reason", declineReason === "Other" ? `Other: ${declineOther}` : declineReason);
    const res = await fetch(`/api/vendor/rfq/${token}`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setDeclineOpen(false);
    if (!res.ok) return setError(j.error ?? "Could not decline");
    router.refresh();
  }

  if (done)
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <div className="text-lg font-semibold text-brand-800">Quotation submitted</div>
          <p className="text-sm">Reference <strong>{done.referenceNo}</strong> · version {done.versionNo}</p>
          <p className="max-w-md text-sm text-muted">A confirmation email has been sent. You can revise your quotation from this page until the deadline.</p>
          <Button variant="secondary" onClick={() => setDone(null)}>Submit a revision</Button>
        </div>
      </Card>
    );

  return (
    <Card title={isRevision ? "Submit a revised quotation" : "Submit your quotation"}>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        onInput={(e) => autoFilled.current.delete((e.target as HTMLInputElement).name)}
        className="space-y-5"
      >
        <div role="tablist" aria-label="Submission method" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METHODS.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={method === m.id}
              onClick={() => setMethod(m.id)}
              className={cn("flex flex-col items-center gap-1 rounded-lg border px-3 py-3 text-xs font-medium", method === m.id ? "border-brand-600 bg-brand-100 text-brand-600" : "border-border text-brand-800 hover:bg-slate-50")}
            >
              <m.icon className="h-5 w-5" />
              <span>{i + 1}. {m.label}</span>
            </button>
          ))}
        </div>

        {method === "TEXT" ? (
          <Field label="Your quotation" hint="Include rate, GST, freight, delivery time, payment terms and validity.">
            <Textarea
              name="text"
              rows={8}
              placeholder={`Rate: Rs. ___ per ${unit}\nGST @ __%\nFreight: Rs. ___\nDelivery within __ days\nPayment terms: ___\nValidity: __ days`}
              onBlur={(e) => e.target.value.trim().length >= 30 && readQuotation({ text: e.target.value })}
            />
          </Field>
        ) : (
          <Field label="Quotation file" hint="Maximum 10 MB. We'll read it and fill in the key figures below for you to check.">
            <Input
              key={method}
              name="file"
              type="file"
              required
              accept={METHODS.find((m) => m.id === method)!.accept}
              className="py-1.5"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readQuotation({ file: f });
              }}
            />
          </Field>
        )}

        {reading && (
          <p className="flex items-center gap-2 rounded-lg bg-brand-100 px-3 py-2 text-sm text-brand-800" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading your quotation and filling in the details…
          </p>
        )}
        {prefill && !reading && (
          <div className={cn("rounded-lg px-3 py-2 text-sm", prefill.filled.length ? "bg-brand-100 text-brand-800" : "bg-amber-50 text-amber-900")} role="status">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4" />
              {prefill.filled.length
                ? `Filled ${prefill.filled.length} field${prefill.filled.length === 1 ? "" : "s"} from your quotation (highlighted) — please check them before submitting.`
                : "We couldn't find the key figures automatically — please fill them in below."}
            </div>
            {prefill.filled.length > 0 && prefill.confidence > 0 && prefill.confidence < 0.7 && <p className="mt-1 text-xs">Some values were hard to read — check the unit rate and totals carefully.</p>}
            {prefill.notes.map((n) => <p key={n} className="mt-1 text-xs">{n}</p>)}
          </div>
        )}

        <div>
          <div className="mb-2 text-sm font-semibold text-brand-800">Key figures <span className="font-normal text-muted">(optional, but helps us process your quote correctly)</span></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Unit rate (₹ per ${unit}, excl. GST)`}><Input name="unitRate" type="number" step="any" min="0" inputMode="decimal" className={af("unitRate")} /></Field>
            <Field label={`Quantity you can supply (${unit})`}><Input name="quantity" type="number" step="any" min="0" placeholder={String(quantity)} className={af("quantity")} /></Field>
            <Field label="GST %"><Input name="gstPercent" type="number" step="any" min="0" max="28" className={af("gstPercent")} /></Field>
            <Field label="Freight / transport (₹)"><Input name="freight" type="number" step="any" min="0" className={af("freight")} /></Field>
            <Field label="Loading charges (₹)"><Input name="loading" type="number" step="any" min="0" className={af("loading")} /></Field>
            <Field label="Total price (₹, incl. all)"><Input name="total" type="number" step="any" min="0" className={af("total")} /></Field>
            <Field label="Delivery time (days)"><Input name="deliveryDays" type="number" min="0" className={af("deliveryDays")} /></Field>
            <Field label="…or promised delivery date"><Input name="deliveryDate" type="date" className={af("deliveryDate")} /></Field>
            <Field label="Validity (days)"><Input name="validityDays" type="number" min="0" className={af("validityDays")} /></Field>
            <Field label="Payment terms" className="sm:col-span-2"><Input name="paymentTerms" placeholder="e.g. 30 days credit" className={af("paymentTerms")} /></Field>
            <Field label="Warranty"><Input name="warranty" className={af("warranty")} /></Field>
            <Field label="Remarks" className="sm:col-span-3"><Textarea name="remarks" rows={2} className={af("remarks")} /></Field>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setDeclineOpen(true)}>Decline to quote</Button>
          <Button type="submit" size="lg" loading={submitting}>Submit Quotation</Button>
        </div>
      </form>
      <ConfirmDialog open={declineOpen} onOpenChange={setDeclineOpen} title="Decline to quote?" description="We'll let the procurement team know. You won't be able to submit for this RFQ afterwards." confirmLabel="Decline" danger onConfirm={decline}>
        <Field label="Reason">
          <Select value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}>{DECLINE.map((d) => <option key={d}>{d}</option>)}</Select>
        </Field>
        {declineReason === "Other" && <Field label="Details" className="mt-2"><Input value={declineOther} onChange={(e) => setDeclineOther(e.target.value)} /></Field>}
      </ConfirmDialog>
    </Card>
  );
}
