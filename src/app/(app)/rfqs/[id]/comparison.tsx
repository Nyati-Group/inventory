"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Award, ArrowLeftRight, RefreshCw, Send, Sparkles, SplitSquareHorizontal, Info } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend, ReferenceLine } from "recharts";
import { scoreQuotes, type QuoteInput, type ScoringContext, type Weights, type ScoredQuote } from "@/lib/engine/scoring";
import { Card, Badge, Stars, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea, Input } from "@/components/ui/form";
import { sendForApproval, recomputeNow } from "@/server/actions/rfq";
import { saveProjectWeights } from "@/server/actions/project";
import { SERIES, BRAND } from "@/lib/chart-colors";
import { cn, fmtDate, inr, pct } from "@/lib/utils";
import type { RfqLite, VendorRow } from "./rfq-detail";

export interface ComparisonProps {
  quotes: QuoteInput[];
  ctx: ScoringContext;
  weights: Weights;
  ourLastRate: number | null;
  marketAvg: number | null;
  rfq: RfqLite;
  vendors: VendorRow[];
  canManage: boolean;
}

const WEIGHT_LABELS: [keyof Weights, string][] = [
  ["price", "Landed price"],
  ["delivery", "Delivery vs need"],
  ["proximity", "Proximity"],
  ["rating", "Vendor rating"],
  ["commercial", "Commercial terms"],
];

export function Comparison(p: ComparisonProps) {
  const router = useRouter();
  const [w, setW] = React.useState<Weights>(p.weights);
  const [vendorsAsColumns, setVendorsAsColumns] = React.useState(true);
  const [approvalOpen, setApprovalOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const result = React.useMemo(() => scoreQuotes(p.quotes, p.ctx, w), [p.quotes, p.ctx, w]);
  const changed = WEIGHT_LABELS.some(([k]) => w[k] !== p.weights[k]);
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const invited = p.vendors.length;
  const responded = p.vendors.filter((v) => v.status === "RESPONDED").length;
  const needsReview = p.vendors.filter((v) => v.quotation?.active?.parseStatus === "NEEDS_REVIEW");
  const open = ["SENT", "PARTIALLY_RESPONDED", "CLOSED"].includes(p.rfq.status);

  if (!p.quotes.length)
    return (
      <Card>
        <EmptyState title={`${responded} of ${invited} vendors responded`} description={needsReview.length ? "Quotations are waiting for review before they can be compared." : "The comparison appears automatically as quotations arrive."} action={needsReview[0] && <Link className="link" href={`/rfqs/${p.rfq.id}/review/${needsReview[0].quotation!.active!.id}`}>Review {needsReview[0].name}</Link>} />
      </Card>
    );

  const rec = result.recommended;
  const color = (vendorId: string) => SERIES[Math.max(0, p.quotes.findIndex((q) => q.vendorId === vendorId)) % SERIES.length];
  const vrow = (id: string) => p.vendors.find((v) => v.vendorId === id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="brand">{responded} of {invited} vendors responded</Badge>
        {needsReview.length > 0 && <Badge tone="warning">{needsReview.length} quotation(s) need review — <Link href={`/rfqs/${p.rfq.id}/review/${needsReview[0].quotation!.active!.id}`} className="underline">review</Link></Badge>}
        <span className="text-xs text-muted">Recomputed automatically on every new or revised quotation.</span>
        <Button size="sm" variant="ghost" className="ml-auto" loading={pending} onClick={() => start(async () => { await recomputeNow(p.rfq.id); router.refresh(); })}><RefreshCw className="h-4 w-4" /> Recompute</Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className={cn(rec && "border-brand-600")} title={<div className="flex items-center gap-2"><Award className="h-5 w-5 text-brand-600" /><span className="font-semibold">{rec ? `Recommended vendor: ${rec.vendorName}` : "No eligible vendor"}</span></div>} actions={rec && <Badge tone="success">Score {rec.totalScore}/100</Badge>}>
          <p className="text-sm leading-relaxed">{result.explanation}</p>
          {result.whyNotCheapest && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>Why not the cheapest?</strong> {result.whyNotCheapest}</p>
          )}
          {result.runnerUp && <p className="mt-2 text-xs text-muted">Runner-up: {result.runnerUp.vendorName} — {inr(result.runnerUp.landedCost, false)}, score {result.runnerUp.totalScore}.</p>}
          {result.split && (
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-100/40 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 font-semibold text-brand-800"><SplitSquareHorizontal className="h-4 w-4" /> Split-order suggestion</div>
              <p>No single eligible vendor can supply the full quantity. Award {result.split.parts.map((x) => `${x.quantity} ${p.rfq.unit} to ${x.vendorName}`).join(" and ")} — about {inr(result.split.totalCost, false)} landed.</p>
            </div>
          )}
          {changed && <p className="mt-3 flex items-center gap-1 text-xs text-brand-600"><Sparkles className="h-3 w-3" /> Showing what-if weights (not saved).</p>}
          {p.canManage && open && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => setApprovalOpen(true)} disabled={!rec && !result.split}><Send className="h-4 w-4" /> Send for approval</Button>
            </div>
          )}
        </Card>
        <Card title="What-if weights" actions={<span className={cn("text-xs", sum === 100 ? "text-muted" : "text-warning")}>Σ {sum}{sum !== 100 ? " (normalised)" : ""}</span>}>
          <div className="space-y-2">
            {WEIGHT_LABELS.map(([k, label]) => (
              <div key={k}>
                <div className="flex justify-between text-xs"><label htmlFor={`w-${k}`}>{label}</label><span className="tabular-nums">{w[k]}</span></div>
                <input id={`w-${k}`} type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="w-full accent-brand-600" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" disabled={!changed} onClick={() => setW(p.weights)}>Reset</Button>
            {p.canManage && (
              <Button size="sm" variant="secondary" disabled={!changed || sum !== 100} loading={pending} onClick={() => start(async () => { const r = await saveProjectWeights(p.rfq.projectId, w); if (!r.ok) return void toast.error(r.error); toast.success("Saved as project default"); router.refresh(); })}>
                Save as project default
              </Button>
            )}
          </div>
        </Card>
      </div>

      <Card title="Comparison" bodyClassName="p-0" actions={<Button size="sm" variant="secondary" onClick={() => setVendorsAsColumns((x) => !x)}><ArrowLeftRight className="h-4 w-4" /> {vendorsAsColumns ? "Vendors as rows" : "Vendors as columns"}</Button>}>
        <CompareTable scored={result.scored} vendorsAsColumns={vendorsAsColumns} p={p} vrow={vrow} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Landed cost by vendor">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={result.scored.map((s) => ({ name: short(s.vendorName), landed: s.landedCost, id: s.vendorId, dq: s.disqualified }))} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={BRAND.grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} interval={0} />
                <YAxis tickFormatter={(v) => `₹${(v / 1e5).toFixed(1)}L`} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} width={56} />
                <Tooltip formatter={(v: number) => [inr(v, false), "Landed cost"]} cursor={{ fill: BRAND.tint }} />
                <Bar dataKey="landed" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {result.scored.map((s) => <Cell key={s.vendorId} fill={color(s.vendorId)} fillOpacity={s.disqualified ? 0.35 : 1} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Top vendors across the 5 criteria">
          <div className="h-64">
            <ResponsiveContainer>
              <RadarChart data={radarData(result.scored.filter((s) => !s.disqualified).slice(0, 3))} outerRadius="70%">
                <PolarGrid stroke={BRAND.grid} />
                <PolarAngleAxis dataKey="criterion" tick={{ fontSize: 11, fill: BRAND.muted }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                {result.scored.filter((s) => !s.disqualified).slice(0, 3).map((s) => (
                  <Radar key={s.vendorId} name={short(s.vendorName)} dataKey={s.vendorId} stroke={color(s.vendorId)} fill={color(s.vendorId)} fillOpacity={0.12} strokeWidth={2} />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={`Unit rate vs history & market (₹/${p.rfq.unit})`}>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={result.scored.map((s) => ({ name: short(s.vendorName), rate: s.unitRate, id: s.vendorId }))} margin={{ top: 16, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={BRAND.grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} width={56} domain={["auto", "auto"]} />
                <Tooltip formatter={(v: number) => [inr(v), "Quoted rate"]} cursor={{ fill: BRAND.tint }} />
                <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {result.scored.map((s) => <Cell key={s.vendorId} fill={color(s.vendorId)} />)}
                </Bar>
                {p.ourLastRate && <ReferenceLine y={p.ourLastRate} stroke={BRAND.navy} strokeWidth={2} label={{ value: `Our last ${inr(p.ourLastRate, false)}`, position: "insideTopLeft", fontSize: 11, fill: BRAND.navy }} />}
                {p.marketAvg && <ReferenceLine y={p.marketAvg} stroke={BRAND.muted} strokeDasharray="4 4" label={{ value: `Market ${inr(p.marketAvg, false)}`, position: "insideTopRight", fontSize: 11, fill: BRAND.muted }} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!p.marketAvg && <p className="flex items-center gap-1 text-xs text-muted"><Info className="h-3 w-3" /> Open “Rate graph → Market rates” on the material to fetch a market benchmark.</p>}
        </Card>
      </div>

      <SendForApprovalDialog open={approvalOpen} onOpenChange={setApprovalOpen} p={p} scored={result.scored} recommendedId={rec?.vendorId ?? null} split={result.split} />
    </div>
  );
}

const short = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s);

function radarData(top: ScoredQuote[]) {
  const crit: [string, keyof ScoredQuote][] = [["Price", "priceScore"], ["Delivery", "deliveryScore"], ["Proximity", "proximityScore"], ["Rating", "ratingScore"], ["Commercial", "commercialScore"]];
  return crit.map(([label, key]) => ({ criterion: label, ...Object.fromEntries(top.map((s) => [s.vendorId, s[key] as number])) }));
}

function CompareTable({ scored, vendorsAsColumns, p, vrow }: { scored: ScoredQuote[]; vendorsAsColumns: boolean; p: ComparisonProps; vrow: (id: string) => VendorRow | undefined }) {
  const metrics: { label: string; render: (s: ScoredQuote) => React.ReactNode }[] = [
    { label: "Landed total", render: (s) => <span className="font-semibold">{inr(s.landedCost, false)}</span> },
    { label: "Unit rate", render: (s) => inr(s.unitRate) },
    { label: "GST", render: (s) => { const a = vrow(s.vendorId)?.quotation?.active; return a?.gstPercent !== null && a?.gstPercent !== undefined ? `${a.gstPercent}%` : "—"; } },
    { label: "Freight & charges", render: (s) => inr(vrow(s.vendorId)?.quotation?.active?.freight ?? 0, false) },
    { label: "Quantity offered", render: (s) => <span className={cn(s.quantityOffered < p.ctx.quantityRequired && "text-danger")}>{s.quantityOffered} {p.rfq.unit}</span> },
    { label: "Delivery", render: (s) => (s.deliveryDate ? <span className={cn(s.daysLate !== null && s.daysLate > 0 && "text-warning")}>{fmtDate(s.deliveryDate)}<span className="block text-xs text-muted">{s.daysLate === null ? "" : s.daysLate > 0 ? `${s.daysLate} d late` : s.daysLate < 0 ? `${-s.daysLate} d early` : "on time"}</span></span> : "—") },
    { label: "Distance", render: (s) => (s.distanceKm !== null ? `${Math.round(s.distanceKm)} km` : "—") },
    { label: "Payment terms", render: (s) => vrow(s.vendorId)?.quotation?.active?.paymentTerms ?? "—" },
    { label: "Validity", render: (s) => (s.validityDays ? `${s.validityDays} days` : "—") },
    { label: "Warranty", render: (s) => s.warranty || "—" },
    { label: "Deviations", render: (s) => (s.deviations.length ? <span className="text-xs text-warning">{s.deviations.join("; ")}</span> : <span className="text-xs text-success">None</span>) },
    { label: "Vendor rating", render: (s) => (s.isNewVendor ? <Badge>New (3.5 used)</Badge> : <Stars value={s.effectiveRating} />) },
    { label: "Our previous rate", render: () => inr(p.ourLastRate) },
    { label: "vs market avg", render: (s) => (p.marketAvg ? <span className={cn(s.unitRate > p.marketAvg ? "text-danger" : "text-success")}>{s.unitRate > p.marketAvg ? "+" : ""}{pct(((s.unitRate - p.marketAvg) / p.marketAvg) * 100)}</span> : "—") },
    { label: "Score (price/deliv/prox/rating/comm.)", render: (s) => <span className="text-xs tabular-nums">{s.priceScore}/{s.deliveryScore}/{s.proximityScore}/{s.ratingScore}/{s.commercialScore}</span> },
    { label: "Total score", render: (s) => <span className="text-base font-semibold text-brand-800">{s.totalScore}</span> },
    { label: "Rank", render: (s) => (s.disqualified ? <span className="text-xs text-danger">Disqualified: {s.disqualifyReasons.join("; ")}</span> : <Badge tone={s.rank === 1 ? "success" : "neutral"}>#{s.rank}</Badge>) },
    {
      label: "Original quotation",
      render: (s) => {
        const v = vrow(s.vendorId);
        const doc = v?.quotation?.versions.find((x) => x.id === s.versionId)?.docs[0];
        return doc ? <a className="link text-xs" href={doc.url} target="_blank" rel="noreferrer">View original</a> : <Link className="link text-xs" href={`/rfqs/${p.rfq.id}/review/${s.versionId}`}>View original</Link>;
      },
    },
  ];
  const head = (s: ScoredQuote) => (
    <div>
      <div className="font-semibold normal-case text-brand-800">{s.vendorName}</div>
      <div className="mt-1 flex flex-wrap gap-1 normal-case">{s.badges.map((b) => <Badge key={b} tone="success">{b}</Badge>)}</div>
    </div>
  );
  return (
    <div className="scrollbar-thin overflow-x-auto">
      {vendorsAsColumns ? (
        <table className="w-full text-sm">
          <thead><tr><th className="th">Criterion</th>{scored.map((s) => <th key={s.vendorId} className={cn("th min-w-[160px] align-top", s.rank === 1 && "bg-brand-600/10")}>{head(s)}</th>)}</tr></thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.label}><td className="td whitespace-nowrap text-xs font-medium text-muted">{m.label}</td>{scored.map((s) => <td key={s.vendorId} className={cn("td", s.disqualified && "opacity-60", s.rank === 1 && "bg-brand-100/40")}>{m.render(s)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-sm">
          <thead><tr><th className="th">Vendor</th>{metrics.map((m) => <th key={m.label} className="th">{m.label}</th>)}</tr></thead>
          <tbody>
            {scored.map((s) => (
              <tr key={s.vendorId} className={cn(s.rank === 1 && "bg-brand-100/40", s.disqualified && "opacity-60")}><td className="td min-w-[180px]">{head(s)}</td>{metrics.map((m) => <td key={m.label} className="td whitespace-nowrap">{m.render(s)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SendForApprovalDialog({ open, onOpenChange, p, scored, recommendedId, split }: { open: boolean; onOpenChange: (o: boolean) => void; p: ComparisonProps; scored: ScoredQuote[]; recommendedId: string | null; split: ReturnType<typeof scoreQuotes>["split"] }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"single" | "split">(recommendedId ? "single" : "split");
  const [vendorId, setVendorId] = React.useState(recommendedId ?? scored[0]?.vendorId ?? "");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [parts, setParts] = React.useState(split?.parts.map((x) => ({ vendorId: x.vendorId, quantity: x.quantity })) ?? []);
  const [pending, start] = React.useTransition();
  const chosen = scored.find((s) => s.vendorId === vendorId);
  const override = mode === "single" && vendorId !== recommendedId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Send for approval" description="Approvers see this comparison, the recommendation and your selection.">
        <div className="space-y-3">
          {split && (
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["single", "split"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1 text-xs font-medium", mode === m ? "bg-brand-600 text-white" : "text-brand-800")}>{m === "single" ? "Single vendor" : "Split order"}</button>)}
            </div>
          )}
          {mode === "single" ? (
            <>
              <Field label="Vendor">
                <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  {scored.map((s) => <option key={s.vendorId} value={s.vendorId}>{s.vendorName} — {inr(s.landedCost, false)}{s.vendorId === recommendedId ? " (recommended)" : s.disqualified ? " (disqualified)" : ""}</option>)}
                </Select>
              </Field>
              {chosen && <p className="text-sm">Amount for approval: <strong>{inr(chosen.landedCost)}</strong></p>}
              {(override || chosen?.disqualified) && (
                <Field label="Reason for not choosing the recommended vendor (required)"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {parts.map((x, i) => (
                <div key={x.vendorId} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{scored.find((s) => s.vendorId === x.vendorId)?.vendorName}</span>
                  <Input type="number" className="w-28" value={x.quantity} onChange={(e) => setParts(parts.map((y, j) => (j === i ? { ...y, quantity: Number(e.target.value) } : y)))} aria-label="Quantity" />
                  <span className="text-muted">{p.rfq.unit}</span>
                </div>
              ))}
              <p className="text-xs text-muted">Total {parts.reduce((s, x) => s + x.quantity, 0)} of {p.ctx.quantityRequired} {p.rfq.unit}</p>
            </div>
          )}
          <Field label="Note to approver (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex justify-end">
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await sendForApproval(mode === "split" ? { rfqId: p.rfq.id, split: parts, note } : { rfqId: p.rfq.id, selectedVendorId: vendorId, overrideReason: reason || undefined, note });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Sent for approval — approver notified");
                  onOpenChange(false);
                  router.push(`/rfqs/${p.rfq.id}?tab=approval`);
                  router.refresh();
                })
              }
            >
              <Send className="h-4 w-4" /> Send for approval
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
