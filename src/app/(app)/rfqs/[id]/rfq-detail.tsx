"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, MailPlus, Clock, MessageSquare, MessageCircle, RotateCw, FileText, XCircle, ClipboardEdit, CheckCircle2, KeyRound } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, Badge, StatusBadge, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea, Select } from "@/components/ui/form";
import { resendRfqEmail, regenerateVendorLink, extendDeadline, sendNegotiation, cancelRfq, reparseQuotation, enterQuotationForVendor, decideApproval } from "@/server/actions/rfq";
import { cn, fmtDateTime, inr, qty } from "@/lib/utils";
import { Comparison, type ComparisonProps } from "./comparison";

export type VendorRow = {
  id: string;
  vendorId: string;
  name: string;
  email: string;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  deadline: string;
  reminders: number;
  distanceKm: number | null;
  lastEmail: { status: string; error: string | null } | null;
  portalLink: string | null;
  linkExpiresAt: string;
  whatsappUrl: string | null;
  quotation: {
    referenceNo: string;
    active: {
      id: string;
      versionNo: number;
      method: string;
      parseStatus: string;
      confidence: number | null;
      parseNotes: string | null;
      unitRate: number | null;
      quantity: number | null;
      gstPercent: number | null;
      freight: number;
      landedCost: number | null;
      statedTotal: number | null;
      totalMismatch: boolean;
      deliveryDate: string | null;
      paymentTerms: string | null;
      validityDays: number | null;
      warranty: string | null;
      deviations: string[];
    } | null;
    versions: { id: string; versionNo: number; method: string; submittedAt: string; landedCost: number | null; parseStatus: string; source: string; docs: { name: string; url: string }[] }[];
  } | null;
};

export type RfqLite = { id: string; number: string; status: string; deadline: string; projectId: string; material: string; unit: string; quantity: number; deliveryAddress: string; notes: string | null; createdBy: string; createdAt: string };

export type ApprovalView = {
  id: string;
  status: string;
  amount: number;
  selected: string;
  selectedVendorId: string | null;
  recommended: string;
  isOverride: boolean;
  overrideReason: string | null;
  split: { vendorId: string; quantity: number; name: string }[] | null;
  note: string | null;
  requestedBy: string;
  createdAt: string;
  steps: { id: string; level: number; label: string; approver: string; status: string; comment: string | null; decidedAt: string | null }[];
};

const OPEN = ["SENT", "PARTIALLY_RESPONDED", "CLOSED"];

export function RfqDetail(p: {
  tab: string;
  rfq: RfqLite;
  vendors: VendorRow[];
  comparison: Omit<ComparisonProps, "rfq" | "vendors" | "canManage">;
  approvals: ApprovalView[];
  canManage: boolean;
  canDecide: boolean;
  audit: { id: string; at: string; actor: string; action: string; entity: string }[];
}) {
  const responded = p.vendors.filter((v) => v.status === "RESPONDED").length;
  const review = p.vendors.filter((v) => v.quotation?.active?.parseStatus === "NEEDS_REVIEW").length;
  return (
    <Tabs defaultValue={p.tab}>
      <TabsList>
        <TabsTrigger value="vendors">Vendors & delivery ({p.vendors.length})</TabsTrigger>
        <TabsTrigger value="quotations">Quotations ({responded}){review ? ` · ${review} to review` : ""}</TabsTrigger>
        <TabsTrigger value="comparison">Comparison</TabsTrigger>
        <TabsTrigger value="approval">Approval{p.approvals.some((a) => a.status === "PENDING") ? " •" : ""}</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="vendors">
        <VendorsTab {...p} />
      </TabsContent>
      <TabsContent value="quotations">
        <QuotationsTab {...p} />
      </TabsContent>
      <TabsContent value="comparison">
        <Comparison {...p.comparison} rfq={p.rfq} vendors={p.vendors} canManage={p.canManage} />
      </TabsContent>
      <TabsContent value="approval">
        <ApprovalTab approvals={p.approvals} canDecide={p.canDecide} vendors={p.vendors} />
      </TabsContent>
      <TabsContent value="activity">
        <Card>
          <ul className="divide-y divide-border text-sm">
            {p.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-40 text-xs text-muted">{fmtDateTime(a.at)}</span>
                <span className="font-medium text-brand-800">{a.actor}</span>
                <span>{a.action.replace(/_/g, " ").toLowerCase()}</span>
                <Badge>{a.entity}</Badge>
              </li>
            ))}
          </ul>
          {!p.audit.length && <EmptyState title="No activity yet" />}
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
      after?.();
      router.refresh();
    });
  return { pending, act };
}

function VendorsTab({ rfq, vendors, canManage }: { rfq: RfqLite; vendors: VendorRow[]; canManage: boolean }) {
  const { pending, act } = useAct();
  const [regen, setRegen] = React.useState<VendorRow | null>(null);
  const [regenResend, setRegenResend] = React.useState(true);
  const [extend, setExtend] = React.useState(false);
  const [negotiate, setNegotiate] = React.useState<VendorRow | null>(null);
  const [enter, setEnter] = React.useState<VendorRow | null>(null);
  const [cancel, setCancel] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const open = OPEN.includes(rfq.status);
  return (
    <Card
      title={`Per-vendor status — ${vendors.filter((v) => v.status === "RESPONDED").length} of ${vendors.length} responded`}
      actions={
        canManage &&
        open && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setExtend(true)}><Clock className="h-4 w-4" /> Extend deadline</Button>
            <Button size="sm" variant="ghost" onClick={() => setCancel(true)}><XCircle className="h-4 w-4" /> Cancel RFQ</Button>
          </>
        )
      }
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Vendor</th>
              <th className="th">Status</th>
              <th className="th">Sent</th>
              <th className="th">Opened</th>
              <th className="th">Responded</th>
              <th className="th">Reminders</th>
              <th className="th">Deadline</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id}>
                <td className="td">
                  <Link href={`/vendors/${v.vendorId}`} className="link">{v.name}</Link>
                  <div className="text-xs text-muted">{v.email}{v.distanceKm !== null ? ` · ${Math.round(v.distanceKm)} km` : ""}</div>
                  {v.portalLink && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <a href={v.portalLink} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">Open vendor portal <ExternalLink className="h-3 w-3" /></a>
                      <button onClick={() => { navigator.clipboard.writeText(v.portalLink!); toast.success("Vendor link copied"); }} className="inline-flex items-center gap-1 text-muted hover:text-brand-600"><Copy className="h-3 w-3" /> Copy link</button>
                      {v.whatsappUrl && <a href={v.whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-brand-600"><MessageCircle className="h-3 w-3" /> WhatsApp</a>}
                      {canManage && v.status !== "DECLINED" && <button onClick={() => setRegen(v)} className="inline-flex items-center gap-1 text-muted hover:text-brand-600"><KeyRound className="h-3 w-3" /> New link</button>}
                      <span className="text-muted">valid till {fmtDateTime(v.linkExpiresAt)}</span>
                    </div>
                  )}
                </td>
                <td className="td">
                  <StatusBadge status={v.status} />
                  {v.declineReason && <div className="text-xs text-muted">{v.declineReason}</div>}
                  {v.lastEmail?.status === "FAILED" && <div className="text-xs text-danger">Email failed: {v.lastEmail.error}</div>}
                </td>
                <td className="td text-xs">{fmtDateTime(v.sentAt)}</td>
                <td className="td text-xs">{fmtDateTime(v.openedAt)}</td>
                <td className="td text-xs">{fmtDateTime(v.respondedAt)}</td>
                <td className="td text-center">{v.reminders}</td>
                <td className="td text-xs">{fmtDateTime(v.deadline)}</td>
                <td className="td">
                  {canManage && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {["QUEUED", "FAILED", "SENT", "OPENED", "NO_RESPONSE"].includes(v.status) && (
                        <Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => resendRfqEmail(v.id), `Email re-sent to ${v.name}`)}><MailPlus className="h-4 w-4" /> Resend</Button>
                      )}
                      {v.status === "RESPONDED" && open && (
                        <Button size="sm" variant="ghost" onClick={() => setNegotiate(v)}><MessageSquare className="h-4 w-4" /> Negotiate</Button>
                      )}
                      {open && v.status !== "DECLINED" && (
                        <Button size="sm" variant="ghost" onClick={() => setEnter(v)} title="Record a quotation received by email/phone"><ClipboardEdit className="h-4 w-4" /> Enter quote</Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!regen}
        onOpenChange={(o) => !o && setRegen(null)}
        title={`Issue a new link for ${regen?.name}?`}
        description="The current link stops working immediately (use this if it was forwarded to the wrong person). Quotations already submitted are kept."
        confirmLabel="Issue new link"
        loading={pending}
        onConfirm={() =>
          act(async () => {
            const r = await regenerateVendorLink(regen!.id, regenResend);
            if (r.ok) await navigator.clipboard.writeText(r.data.link).catch(() => undefined);
            return r;
          }, regenResend ? "New link issued, emailed and copied" : "New link issued and copied", () => setRegen(null))
        }
      >
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={regenResend} onChange={(e) => setRegenResend(e.target.checked)} className="h-4 w-4 accent-brand-600" /> Email the new link to the vendor</label>
      </ConfirmDialog>
      <Dialog open={extend} onOpenChange={setExtend}>
        <DialogContent title="Extend quotation deadline" description="All vendors who have not declined are emailed the new deadline; reminders restart.">
          <form action={(fd) => act(() => extendDeadline(rfq.id, new Date(String(fd.get("deadline"))).toISOString()), "Deadline extended", () => setExtend(false))} className="space-y-3">
            <Field label="New deadline"><Input type="datetime-local" name="deadline" required /></Field>
            <div className="flex justify-end"><Button type="submit" loading={pending}>Extend & notify</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!negotiate} onOpenChange={(o) => !o && setNegotiate(null)}>
        <DialogContent title={`Negotiate with ${negotiate?.name}`} description="Sent through the same secure portal link; a revised quotation re-triggers scoring.">
          <form action={(fd) => act(() => sendNegotiation(negotiate!.id, String(fd.get("message"))), "Counter-request sent", () => setNegotiate(null))} className="space-y-3">
            <Field label="Message">
              <Textarea name="message" rows={4} defaultValue={`Thank you for your offer. Our target landed price is lower than your current quote, and we need delivery by the required date. Can you improve your price and/or delivery commitment?`} />
            </Field>
            <div className="flex justify-end"><Button type="submit" loading={pending}>Send counter-request</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!enter} onOpenChange={(o) => !o && setEnter(null)}>
        <DialogContent title={`Enter quotation for ${enter?.name}`} description="Paste the quotation received by email or phone. It is parsed and compared like a portal submission (marked as buyer-entered).">
          <form action={(fd) => { fd.set("rfqVendorId", enter!.id); act(() => enterQuotationForVendor(fd), "Quotation recorded and parsed", () => setEnter(null)); }} className="space-y-3">
            <Textarea name="text" rows={8} placeholder={"Rate: Rs. 372 per bag\nGST @ 28%\nFreight: Rs. 8,000\nDelivery within 3 days\nPayment: 30 days credit\nValidity: 15 days"} required />
            <div className="flex justify-end"><Button type="submit" loading={pending}>Save quotation</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={cancel} onOpenChange={setCancel} title="Cancel this RFQ?" description="Vendors can no longer submit quotations. Pending approvals are cancelled." confirmLabel="Cancel RFQ" danger loading={pending} onConfirm={() => act(() => cancelRfq(rfq.id, reason), "RFQ cancelled", () => setCancel(false))}>
        <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </Card>
  );
}

function QuotationsTab({ rfq, vendors, canManage }: { rfq: RfqLite; vendors: VendorRow[]; canManage: boolean }) {
  const { pending, act } = useAct();
  const withQuotes = vendors.filter((v) => v.quotation);
  if (!withQuotes.length) return <Card><EmptyState title="No quotations yet" description="Quotations appear here as vendors submit through their secure links." /></Card>;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {withQuotes.map((v) => {
        const a = v.quotation!.active;
        return (
          <Card
            key={v.id}
            title={
              <div>
                <div className="font-semibold text-brand-800">{v.name}</div>
                <div className="text-xs text-muted">Ref {v.quotation!.referenceNo} · v{a?.versionNo} · {a?.method.toLowerCase()}</div>
              </div>
            }
            actions={
              a && (
                <>
                  <StatusBadge status={a.parseStatus} />
                  {a.confidence !== null && <Badge tone={a.confidence >= 0.7 ? "success" : "warning"}>conf. {(a.confidence * 100).toFixed(0)}%</Badge>}
                  {canManage && (
                    <Button size="sm" variant={a.parseStatus === "NEEDS_REVIEW" ? "primary" : "secondary"} asChild>
                      <Link href={`/rfqs/${rfq.id}/review/${a.id}`}>{a.parseStatus === "NEEDS_REVIEW" ? "Review now" : "Review / edit"}</Link>
                    </Button>
                  )}
                </>
              )
            }
          >
            {a ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <Item k="Unit rate" v={a.unitRate !== null ? `${inr(a.unitRate)}/${rfq.unit}` : "—"} />
                  <Item k="Quantity" v={qty(a.quantity, rfq.unit)} warn={a.quantity !== null && a.quantity < rfq.quantity} />
                  <Item k="GST" v={a.gstPercent !== null ? `${a.gstPercent}%` : "—"} />
                  <Item k="Freight & charges" v={inr(a.freight, false)} />
                  <Item k="Landed cost" v={inr(a.landedCost, false)} strong />
                  <Item k="Vendor's total" v={inr(a.statedTotal, false)} warn={a.totalMismatch} />
                  <Item k="Delivery" v={a.deliveryDate ? fmtDateTime(a.deliveryDate).slice(0, 12) : "—"} />
                  <Item k="Payment" v={a.paymentTerms ?? "—"} />
                  <Item k="Validity" v={a.validityDays ? `${a.validityDays} days` : "—"} />
                </dl>
                {a.totalMismatch && <p className="mt-2 text-xs text-danger">Vendor's stated total does not match the recomputed landed cost.</p>}
                {a.deviations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.deviations.map((d) => <Badge key={d} tone="warning">{d}</Badge>)}
                  </div>
                )}
                {a.parseNotes && <p className="mt-2 text-xs text-muted">{a.parseNotes}</p>}
              </>
            ) : (
              <p className="text-sm text-muted">Processing…</p>
            )}
            <details className="mt-3 text-sm" open={v.quotation!.versions.length > 1}>
              <summary className="cursor-pointer text-xs font-medium text-brand-600">Revision history ({v.quotation!.versions.length})</summary>
              <ul className="mt-2 space-y-1">
                {v.quotation!.versions.map((ver) => (
                  <li key={ver.id} className={cn("flex flex-wrap items-center gap-2 rounded px-2 py-1 text-xs", ver.id === a?.id && "bg-brand-100")}>
                    <strong>v{ver.versionNo}</strong> {fmtDateTime(ver.submittedAt)} · {ver.method.toLowerCase()} · {inr(ver.landedCost, false)} <StatusBadge status={ver.parseStatus} />
                    {ver.source === "BUYER_ENTRY" && <Badge>buyer-entered</Badge>}
                    {ver.id === a?.id && <Badge tone="brand">active</Badge>}
                    {ver.docs.map((d) => <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1"><FileText className="h-3 w-3" />{d.name}</a>)}
                  </li>
                ))}
              </ul>
            </details>
            {canManage && a && (
              <Button size="sm" variant="ghost" className="mt-2" loading={pending} onClick={() => act(() => reparseQuotation(a.id), "Re-parsed")}>
                <RotateCw className="h-4 w-4" /> Re-run extraction
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Item({ k, v, strong, warn }: { k: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={cn(strong && "font-semibold text-brand-800", warn && "text-danger")}>{v}</dd>
    </div>
  );
}

function ApprovalTab({ approvals, canDecide, vendors }: { approvals: ApprovalView[]; canDecide: boolean; vendors: VendorRow[] }) {
  const { pending, act } = useAct();
  const [mode, setMode] = React.useState<"APPROVE" | "CHOOSE_OTHER" | "REJECT" | "RE_RFQ" | null>(null);
  const [comment, setComment] = React.useState("");
  const [vendorId, setVendorId] = React.useState("");
  if (!approvals.length) return <Card><EmptyState title="Not sent for approval yet" description="Use “Send for approval” on the Comparison tab once you are happy with the recommendation." /></Card>;
  return (
    <div className="space-y-4">
      {approvals.map((a) => (
        <Card key={a.id} title={<div className="flex items-center gap-2"><span className="font-semibold">Approval request</span><StatusBadge status={a.status} /></div>} actions={<span className="text-xs text-muted">Requested by {a.requestedBy} · {fmtDateTime(a.createdAt)}</span>}>
          <div className="grid gap-4 lg:grid-cols-2">
            <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm">
              <dt className="text-muted">Selected vendor</dt>
              <dd className="font-semibold text-brand-800">{a.split ? a.split.map((s) => `${s.name} (${s.quantity})`).join(" + ") : a.selected} {a.isOverride && !a.split ? <Badge tone="warning">differs from recommendation</Badge> : <Badge tone="success">recommended</Badge>}</dd>
              <dt className="text-muted">Recommended</dt>
              <dd>{a.recommended}</dd>
              <dt className="text-muted">Amount (landed)</dt>
              <dd className="font-semibold">{inr(a.amount)}</dd>
              {a.overrideReason && (<><dt className="text-muted">Override reason</dt><dd>{a.overrideReason}</dd></>)}
              {a.note && (<><dt className="text-muted">Note</dt><dd>{a.note}</dd></>)}
            </dl>
            <ol className="space-y-2">
              {a.steps.map((s) => (
                <li key={s.id} className="flex items-start gap-3 rounded-lg border border-border p-2 text-sm">
                  {s.status === "APPROVED" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : s.status === "PENDING" ? <Clock className="mt-0.5 h-4 w-4 text-warning" /> : <XCircle className="mt-0.5 h-4 w-4 text-danger" />}
                  <div>
                    <div className="font-medium">L{s.level} · {s.label} — {s.approver}</div>
                    <div className="text-xs text-muted"><StatusBadge status={s.status} /> {s.decidedAt && fmtDateTime(s.decidedAt)} {s.comment && `· “${s.comment}”`}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {a.status === "PENDING" && canDecide && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              <Button onClick={() => setMode("APPROVE")}><CheckCircle2 className="h-4 w-4" /> Approve {a.isOverride ? "selection" : "recommended"}</Button>
              <Button variant="secondary" onClick={() => setMode("CHOOSE_OTHER")}>Choose another vendor</Button>
              <Button variant="secondary" onClick={() => setMode("RE_RFQ")}>Re-RFQ</Button>
              <Button variant="danger" onClick={() => setMode("REJECT")}>Reject</Button>
            </div>
          )}
          <ConfirmDialog
            open={!!mode}
            onOpenChange={(o) => !o && setMode(null)}
            title={mode === "APPROVE" ? "Approve and create the PO?" : mode === "CHOOSE_OTHER" ? "Approve a different vendor" : mode === "REJECT" ? "Reject this request?" : "Send back for a new RFQ?"}
            description={mode === "APPROVE" ? "If this is the final approval level, a purchase order is generated automatically." : "A reason is mandatory and is recorded in the audit trail."}
            confirmLabel={mode === "REJECT" ? "Reject" : mode === "RE_RFQ" ? "Re-RFQ" : "Approve"}
            danger={mode === "REJECT"}
            loading={pending}
            onConfirm={() => act(() => decideApproval({ requestId: a.id, decision: mode!, vendorId: vendorId || undefined, comment }), "Decision recorded", () => { setMode(null); setComment(""); })}
          >
            {mode === "CHOOSE_OTHER" && (
              <Field label="Vendor" className="mb-3">
                <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">Choose…</option>
                  {vendors.filter((v) => v.quotation?.active?.landedCost && v.vendorId !== a.selectedVendorId).map((v) => <option key={v.vendorId} value={v.vendorId}>{v.name} — {inr(v.quotation!.active!.landedCost, false)}</option>)}
                </Select>
              </Field>
            )}
            <Field label={mode === "APPROVE" ? "Comment (optional)" : "Reason (required)"}>
              <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </ConfirmDialog>
        </Card>
      ))}
    </div>
  );
}
