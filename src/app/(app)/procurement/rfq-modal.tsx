"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, FileText, Send, CheckCircle2, Search } from "lucide-react";
import { Dialog, DialogContent, ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Checkbox } from "@/components/ui/form";
import { Badge, Stars, Skeleton, EmptyState } from "@/components/ui/misc";
import { getRfqFormData, sendRfq } from "@/server/actions/procurement";
import { cn, inr, pct } from "@/lib/utils";
import type { MaterialRow, ProjectLite } from "./procurement-table";

type Candidate = Extract<Awaited<ReturnType<typeof getRfqFormData>>, { ok: true }>["data"][number];

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);

export function RfqModal({ row, project, onClose }: { row: MaterialRow | null; project: ProjectLite; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      {row && (
        <DialogContent title={`Request for Quotation — ${row.name}`} description="Step-by-step: request details, then vendors." wide>
          <RfqWizard row={row} project={project} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function RfqWizard({ row, project, onClose }: { row: MaterialRow; project: ProjectLite; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const suggested = Math.max(row.reorderLevel * 2 - row.currentQty, 0);
  const [form, setForm] = React.useState({
    quantity: String(suggested || ""),
    expected: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    deadline: toLocalInput(new Date(Date.now() + project.defaultDeadlineHours * 3600_000)),
    address: project.siteAddress,
    notes: "",
    payment: "",
  });
  const [files, setFiles] = React.useState<File[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [q, setQ] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<{ id: string; number: string } | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!(Number(form.quantity) > 0)) e.quantity = "Enter a quantity greater than 0";
    if (!form.expected || form.expected < today()) e.expected = "Expected delivery date cannot be in the past";
    if (!form.deadline || new Date(form.deadline) <= new Date()) e.deadline = "Deadline must be in the future";
    else if (form.expected && new Date(form.deadline) > new Date(`${form.expected}T23:59`)) e.deadline = "Deadline must be before the delivery date";
    if (form.address.trim().length < 5) e.address = "Delivery address is required";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const next = async () => {
    if (!validate()) return;
    setStep(2);
    setCandidates(null);
    const r = await getRfqFormData(project.id, row.materialId, form.expected);
    if (!r.ok) return toast.error(r.error);
    setCandidates(r.data);
    setSelected(new Set(r.data.filter((c) => c.status !== "BLACKLISTED" && c.emails.length).map((c) => c.vendorId)));
  };

  const previewUrl = `/api/rfq/preview?${new URLSearchParams({ projectId: project.id, materialId: row.materialId, quantity: form.quantity, expected: form.expected, deadline: new Date(form.deadline).toISOString(), address: form.address, notes: form.notes, payment: form.payment })}`;

  const send = async () => {
    setSending(true);
    const fd = new FormData();
    fd.set("projectId", project.id);
    fd.set("materialId", row.materialId);
    fd.set("quantity", form.quantity);
    fd.set("expectedDeliveryDate", form.expected);
    fd.set("deadline", new Date(form.deadline).toISOString());
    fd.set("deliveryAddress", form.address);
    fd.set("notes", form.notes);
    fd.set("paymentTermsPref", form.payment);
    if (row.request) fd.set("materialRequestId", row.request.id);
    selected.forEach((v) => fd.append("vendorIds", v));
    files.forEach((f) => fd.append("attachments", f));
    const r = await sendRfq(fd);
    setSending(false);
    setConfirm(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`${r.data.number} sent to ${selected.size} vendor${selected.size > 1 ? "s" : ""}`);
    setSent(r.data);
    setStep(3);
    router.refresh();
  };

  return (
    <div>
      <ol className="mb-4 flex items-center gap-2 text-xs font-medium" aria-label="Steps">
        {["Request details", "Select vendors", "Sent"].map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", step === i + 1 ? "text-brand-600" : step > i + 1 ? "text-brand-800" : "text-muted")}>
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step >= i + 1 ? "bg-brand-600 text-white" : "bg-slate-100")}>{i + 1}</span>
            {s}
            {i < 2 && <span className="h-px w-8 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Material"><Input value={row.name} readOnly className="bg-slate-50" /></Field>
          <Field label="Category"><Input value={row.category} readOnly className="bg-slate-50" /></Field>
          <Field label="Unit"><Input value={row.unit} readOnly className="bg-slate-50" /></Field>
          <Field label={`Quantity (${row.unit})`} error={errors.quantity} hint={`Suggested reorder qty: ${suggested} (2 × reorder level − current)`}>
            <Input type="number" step="any" min="0" value={form.quantity} onChange={set("quantity")} />
          </Field>
          <Field label="Expected delivery date" error={errors.expected}>
            <Input type="date" min={today()} value={form.expected} onChange={set("expected")} />
          </Field>
          <Field label="Quotation submission deadline" error={errors.deadline}>
            <Input type="datetime-local" value={form.deadline} onChange={set("deadline")} />
          </Field>
          <Field label="Delivery address" className="md:col-span-2" error={errors.address}>
            <Textarea rows={2} value={form.address} onChange={set("address")} />
          </Field>
          <Field label="Payment-terms preference (optional)">
            <Input value={form.payment} onChange={set("payment")} placeholder="e.g. 30 days credit" />
          </Field>
          <Field label="Special notes / specifications" className="md:col-span-2">
            <Textarea rows={2} value={form.notes} onChange={set("notes")} placeholder="Brand preference, grade, test certificates, unloading…" />
          </Field>
          <Field label="Attachments (drawings / specs)" hint="PDF, image or DOCX, max 10 MB each">
            <Input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx" className="py-1.5" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </Field>
          <div className="flex justify-end gap-2 md:col-span-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={next}>Next: select vendors <ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors…" className="pl-8" aria-label="Search vendors" />
            </div>
            <span className="text-sm text-muted">Sorted by fit: distance & lead-time feasibility + rating. {selected.size} selected.</span>
            <Link href="/project-settings?tab=vendors" className="link ml-auto text-sm">+ Add vendor</Link>
          </div>
          {!candidates ? (
            <Skeleton className="h-60" />
          ) : !candidates.length ? (
            <EmptyState title="No vendors for this material" description="Add vendors that supply this material or category to the project vendor book." action={<Link href="/project-settings?tab=vendors" className="link">Open vendor book</Link>} />
          ) : (
            <div className="scrollbar-thin max-h-[45vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th w-8">
                      <Checkbox
                        aria-label="Select all"
                        checked={selected.size === candidates.filter((c) => c.status !== "BLACKLISTED" && c.emails.length).length}
                        onChange={(e) => setSelected(new Set(e.target.checked ? candidates.filter((c) => c.status !== "BLACKLISTED" && c.emails.length).map((c) => c.vendorId) : []))}
                      />
                    </th>
                    <th className="th">Vendor</th>
                    <th className="th">City</th>
                    <th className="th text-right">Distance</th>
                    <th className="th">Est. delivery</th>
                    <th className="th">Rating</th>
                    <th className="th text-right">On-time</th>
                    <th className="th text-right">Last rate</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates
                    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.city.toLowerCase().includes(q.toLowerCase()))
                    .map((c, i) => {
                      const disabled = c.status === "BLACKLISTED" || !c.emails.length;
                      return (
                        <tr key={c.vendorId} className={cn(disabled && "opacity-50", i === 0 && !q && "bg-brand-100/40")}>
                          <td className="td">
                            <Checkbox
                              aria-label={`Select ${c.name}`}
                              disabled={disabled}
                              checked={selected.has(c.vendorId)}
                              onChange={(e) => {
                                const s = new Set(selected);
                                e.target.checked ? s.add(c.vendorId) : s.delete(c.vendorId);
                                setSelected(s);
                              }}
                            />
                          </td>
                          <td className="td">
                            <div className="font-medium text-brand-800">{c.name}</div>
                            <div className="flex gap-1">
                              {i === 0 && !q && <Badge tone="brand">Best fit</Badge>}
                              {c.preferred && <Badge tone="success">Preferred</Badge>}
                              {!c.emails.length && <Badge tone="danger">No email</Badge>}
                            </div>
                          </td>
                          <td className="td">{c.city}</td>
                          <td className="td text-right tabular-nums">
                            {c.distanceKm !== null ? `${Math.round(c.distanceKm)} km` : "—"}
                            {!c.withinRadius && <div className="text-xs text-danger">outside {c.serviceRadiusKm} km radius</div>}
                          </td>
                          <td className="td">
                            {c.etaDays} day{c.etaDays > 1 ? "s" : ""}
                            <div className={cn("text-xs", c.canMeetDate ? "text-success" : "text-warning")}>{c.canMeetDate ? "Meets date" : "May be late"}</div>
                          </td>
                          <td className="td">
                            {c.isNew ? <Badge>New</Badge> : <Stars value={c.rating} />}
                          </td>
                          <td className="td text-right">{c.onTimePct !== null ? pct(c.onTimePct, 0) : "—"}</td>
                          <td className="td text-right tabular-nums">{c.lastRate ? inr(c.lastRate) : "—"}</td>
                          <td className="td">
                            <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "ON_HOLD" ? "warning" : "danger"}>{c.status === "ON_HOLD" ? "On hold" : c.status === "ACTIVE" ? "Active" : "Blacklisted"}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" /> Back</Button>
            <div className="flex gap-2">
              <Button variant="secondary" asChild>
                <a href={previewUrl} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" /> Preview RFQ PDF</a>
              </Button>
              <Button onClick={() => setConfirm(true)} disabled={!selected.size}>
                <Send className="h-4 w-4" /> Send RFQ
              </Button>
            </div>
          </div>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={`Send to ${selected.size} vendor${selected.size > 1 ? "s" : ""}?`}
            description="Each vendor receives a branded email with the RFQ PDF and a unique, expiring quotation link."
            confirmLabel="Send RFQ"
            loading={sending}
            onConfirm={send}
          >
            <ul className="space-y-1 text-sm">
              <li><strong>{form.quantity} {row.unit}</strong> of {row.name}</li>
              <li>Deliver by <strong>{form.expected}</strong> to {form.address}</li>
              <li>Quotation deadline <strong>{new Date(form.deadline).toLocaleString("en-IN")}</strong></li>
              <li className="text-muted">{candidates?.filter((c) => selected.has(c.vendorId)).map((c) => c.name).join(", ")}</li>
            </ul>
          </ConfirmDialog>
        </div>
      )}

      {step === 3 && sent && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <div className="text-lg font-semibold text-brand-800">{sent.number} sent</div>
          <p className="max-w-md text-sm text-muted">Track per-vendor delivery status (Sent → Opened → Quotation received), resend or extend the deadline from the RFQ page. Reminders go out automatically before the deadline.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button asChild><Link href={`/rfqs/${sent.id}`}>Open RFQ</Link></Button>
          </div>
        </div>
      )}
    </div>
  );
}
