"use client";

import * as React from "react";
import { toast } from "sonner";
import { RefreshCw, ExternalLink, UserPlus, Info } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, ReferenceLine, Cell, Legend } from "recharts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton, EmptyState } from "@/components/ui/misc";
import { Field, Input } from "@/components/ui/form";
import { getRateHistory, fetchMarketRates, addMarketVendor } from "@/server/actions/procurement";
import { SERIES, BRAND } from "@/lib/chart-colors";
import { cn, fmtDate, fmtDateTime, inr, pct, qty } from "@/lib/utils";
import type { MaterialRow, ProjectLite } from "./procurement-table";

type Point = Extract<Awaited<ReturnType<typeof getRateHistory>>, { ok: true }>["data"][number];
type Market = Extract<Awaited<ReturnType<typeof fetchMarketRates>>, { ok: true }>["data"];

const RANGES = { "3M": 90, "6M": 180, "1Y": 365, All: 100000 } as const;

export function RateGraphModal({ row, project, canRfq, onClose }: { row: MaterialRow | null; project: ProjectLite; canRfq: boolean; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      {row && (
        <DialogContent title={`Rate graph — ${row.name}`} description={`₹ per ${row.unit} · ${project.name}`} wide>
          <Tabs defaultValue="history">
            <TabsList>
              <TabsTrigger value="history">Our purchase history</TabsTrigger>
              <TabsTrigger value="market">Market rates (online)</TabsTrigger>
            </TabsList>
            <TabsContent value="history">
              <History row={row} project={project} />
            </TabsContent>
            <TabsContent value="market">
              <MarketTab row={row} project={project} canRfq={canRfq} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      )}
    </Dialog>
  );
}

function History({ row, project }: { row: MaterialRow; project: ProjectLite }) {
  const [all, setAll] = React.useState(false);
  const [range, setRange] = React.useState<keyof typeof RANGES>("1Y");
  const [points, setPoints] = React.useState<Point[] | null>(null);
  React.useEffect(() => {
    setPoints(null);
    getRateHistory(project.id, row.materialId, all).then((r) => (r.ok ? setPoints(r.data) : toast.error(r.error)));
  }, [project.id, row.materialId, all]);

  if (!points) return <Skeleton className="h-80" />;
  const cutoff = Date.now() - RANGES[range] * 86_400_000;
  const pts = points.filter((p) => new Date(p.date).getTime() >= cutoff);

  // Series per vendor, fixed colour order by first appearance across the full history (colour follows the entity).
  const vendorOrder = [...new Map(points.map((p) => [p.vendorId, p.vendor])).entries()];
  const top = vendorOrder.slice(0, 7);
  const keyOf = (id: string) => (top.some(([v]) => v === id) ? id : "other");
  const series = [...top.map(([id, name], i) => ({ key: id, name, color: SERIES[i] })), ...(vendorOrder.length > 7 ? [{ key: "other", name: "Other vendors", color: SERIES[7] }] : [])].filter((s) => pts.some((p) => keyOf(p.vendorId) === s.key));
  const data = pts.map((p) => ({ t: new Date(p.date).getTime(), [keyOf(p.vendorId)]: p.rate, _p: p }));

  const rates = pts.map((p) => p.rate);
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const change = last && prev ? ((last.rate - prev.rate) / prev.rate) * 100 : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Time range">
          {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
            <button key={k} onClick={() => setRange(k)} aria-pressed={range === k} className={cn("rounded-md px-3 py-1 text-xs font-medium", range === k ? "bg-brand-600 text-white" : "text-brand-800 hover:bg-brand-100")}>
              {k}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Scope">
          {[false, true].map((v) => (
            <button key={String(v)} onClick={() => setAll(v)} aria-pressed={all === v} className={cn("rounded-md px-3 py-1 text-xs font-medium", all === v ? "bg-brand-600 text-white" : "text-brand-800 hover:bg-brand-100")}>
              {v ? "All projects" : "This project"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip label="Last rate" value={last ? inr(last.rate) : "—"} />
        <Chip label="Average" value={avg ? inr(avg) : "—"} />
        <Chip label="Lowest" value={rates.length ? inr(Math.min(...rates)) : "—"} />
        <Chip label="Highest" value={rates.length ? inr(Math.max(...rates)) : "—"} />
        <Chip label="vs previous purchase" value={change === null ? "—" : `${change >= 0 ? "+" : ""}${pct(change)}`} tone={change === null ? undefined : change > 0 ? "up" : "down"} />
      </div>
      {pts.length ? (
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={BRAND.grid} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtDate(new Date(t)).slice(3)} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} />
              <YAxis tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} width={80} domain={["auto", "auto"]} />
              <Tooltip content={<HistoryTooltip unit={row.unit} />} cursor={{ stroke: BRAND.mid, strokeDasharray: "3 3" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {avg && <ReferenceLine y={avg} stroke={BRAND.navy} strokeDasharray="4 4" label={{ value: `Avg ${inr(avg, false)}`, position: "insideTopRight", fill: BRAND.navy, fontSize: 11 }} />}
              {series.map((s) => (
                <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 6 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState title="No purchases in this range" description="Try a longer range or all projects." />
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-brand-600">View as table</summary>
        <table className="mt-2 w-full text-sm">
          <thead><tr><th className="th">Date</th><th className="th">Vendor</th><th className="th">PO</th><th className="th">Project</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th></tr></thead>
          <tbody>
            {[...pts].reverse().map((p, i) => (
              <tr key={i}><td className="td">{fmtDate(p.date)}</td><td className="td">{p.vendor}</td><td className="td text-xs">{p.poNumber}</td><td className="td">{p.project}</td><td className="td text-right">{qty(p.qty, row.unit)}</td><td className="td text-right">{inr(p.rate)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function HistoryTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: { _p: Point } }[]; unit: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload._p;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-brand-800">{p.vendor}</div>
      <div className="text-muted">{fmtDate(p.date)} · {p.poNumber}</div>
      <div className="mt-1">Qty {qty(p.qty, unit)} · <strong>{inr(p.rate)}</strong>/{unit}</div>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-1.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("text-sm font-semibold text-brand-800", tone === "up" && "text-danger", tone === "down" && "text-success")}>{value}</div>
    </div>
  );
}

function MarketTab({ row, project, canRfq }: { row: MaterialRow; project: ProjectLite; canRfq: boolean }) {
  const [data, setData] = React.useState<Market | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [adding, setAdding] = React.useState<{ supplier: string; city: string | null } | null>(null);
  const load = React.useCallback(
    async (force: boolean) => {
      setLoading(true);
      const r = await fetchMarketRates(project.id, row.materialId, force);
      setLoading(false);
      if (!r.ok) return toast.error(r.error);
      setData(r.data);
    },
    [project.id, row.materialId],
  );
  React.useEffect(() => {
    load(false);
  }, [load]);

  if (!data) return <Skeleton className="h-80" />;
  const ours = row.rate;
  const results = data.results.filter((r) => r.normalisedRate);
  const chart = results.map((r) => ({ name: r.supplier.length > 22 ? `${r.supplier.slice(0, 20)}…` : r.supplier, rate: r.normalisedRate! }));
  const over = ours && data.stats ? ((ours - data.stats.avg) / data.stats.avg) * 100 : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="Our last rate" value={ours ? inr(ours) : "—"} />
        <Chip label="Market average" value={data.stats ? inr(data.stats.avg) : "—"} />
        <Chip label="Market min / max" value={data.stats ? `${inr(data.stats.min, false)} – ${inr(data.stats.max, false)}` : "—"} />
        {over !== null && (
          <Badge tone={over > 3 ? "danger" : over < -3 ? "success" : "neutral"} className="h-7">
            {over > 0 ? `Paying ${pct(over)} above market avg.` : `${pct(-over)} below market avg.`}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          Last updated {fmtDateTime(data.fetchedAt)}
          <Button size="sm" variant="secondary" onClick={() => load(true)} loading={loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-brand-100 px-3 py-2 text-xs text-brand-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Indicative market rates from public web sources — confirm with a formal quotation.
          {data.isDemo && <strong> Demo data: no search provider is configured (set MARKET_RATE_PROVIDER and an API key), so these listings are simulated from our own purchase history.</strong>}
        </span>
      </p>
      {data.error && <p className="text-sm text-danger">{data.error} — showing cached or empty results; you can retry with Refresh.</p>}
      {chart.length > 0 && (
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ top: 16, right: 16, bottom: 0, left: 8 }} barCategoryGap="30%">
              <CartesianGrid stroke={BRAND.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} interval={0} />
              <YAxis tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} width={80} />
              <Tooltip formatter={(v: number) => [`${inr(v)}/${row.unit}`, "Market rate"]} cursor={{ fill: BRAND.tint }} />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {chart.map((_, i) => <Cell key={i} fill={SERIES[0]} />)}
              </Bar>
              {ours && <ReferenceLine y={ours} stroke={BRAND.navy} strokeWidth={2} label={{ value: `Our last ${inr(ours, false)}`, position: "insideTopLeft", fill: BRAND.navy, fontSize: 11 }} />}
              {data.stats && <ReferenceLine y={data.stats.avg} stroke={BRAND.muted} strokeDasharray="4 4" label={{ value: `Market avg ${inr(data.stats.avg, false)}`, position: "insideTopRight", fill: BRAND.muted, fontSize: 11 }} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Provider / supplier</th>
              <th className="th">City · distance</th>
              <th className="th text-right">Rate</th>
              <th className="th">Unit</th>
              <th className="th text-right">₹/{row.unit}</th>
              <th className="th">Availability</th>
              <th className="th">Source</th>
              <th className="th">Fetched</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {data.results.map((r, i) => (
              <tr key={i}>
                <td className="td font-medium">{r.supplier}</td>
                <td className="td">{r.city ?? "—"}{r.distanceKm !== null && r.distanceKm !== undefined ? ` · ${Math.round(r.distanceKm)} km` : ""}</td>
                <td className="td text-right tabular-nums">{inr(r.rate)}</td>
                <td className="td">{r.unit}</td>
                <td className="td text-right tabular-nums">{r.normalisedRate ? inr(r.normalisedRate) : <span className="text-xs text-muted">unit mismatch</span>}</td>
                <td className="td">{r.availability ?? "—"}</td>
                <td className="td">{r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">Link <ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-muted">—</span>}</td>
                <td className="td text-xs text-muted">{fmtDate(data.fetchedAt)}</td>
                <td className="td">
                  {r.inVendorBook ? (
                    <Badge tone="success">In vendor book</Badge>
                  ) : canRfq && !data.isDemo ? (
                    <Button size="sm" variant="secondary" onClick={() => setAdding({ supplier: r.supplier, city: r.city })}>
                      <UserPlus className="h-4 w-4" /> Add to RFQ
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.results.length && <EmptyState title="No market prices found" description="The search returned no comparable listings. Try Refresh later." />}
      </div>
      <AddVendorDialog target={adding} onClose={() => setAdding(null)} projectId={project.id} materialId={row.materialId} />
    </div>
  );
}

function AddVendorDialog({ target, onClose, projectId, materialId }: { target: { supplier: string; city: string | null } | null; onClose: () => void; projectId: string; materialId: string }) {
  const [pending, start] = React.useTransition();
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target && (
        <DialogContent title="Add supplier to vendor book" description="They will appear in the RFQ vendor list for this material.">
          <form
            action={(fd) =>
              start(async () => {
                const r = await addMarketVendor({ projectId, materialId, name: String(fd.get("name")), email: String(fd.get("email")), city: String(fd.get("city")), phone: String(fd.get("phone") || "") || undefined });
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.data.existed ? "Vendor already existed — added to this project" : "Vendor added to the project vendor book");
                onClose();
              })
            }
            className="grid grid-cols-2 gap-3"
          >
            <Field label="Supplier name" className="col-span-2"><Input name="name" defaultValue={target.supplier} required /></Field>
            <Field label="Email (for RFQs)"><Input name="email" type="email" required /></Field>
            <Field label="Phone"><Input name="phone" /></Field>
            <Field label="City" className="col-span-2"><Input name="city" defaultValue={target.city ?? ""} required /></Field>
            <div className="col-span-2 flex justify-end"><Button type="submit" loading={pending}>Add vendor</Button></div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
