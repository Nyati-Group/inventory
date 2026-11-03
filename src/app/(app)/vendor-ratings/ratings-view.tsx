"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge, Stars, StatusBadge, ScoreBar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea, Select } from "@/components/ui/form";
import { RatingBreakdown, RatingSparkline, POINTER_LABELS, POINTER_ORDER } from "@/components/rating-widgets";
import { adjustRatingAction } from "@/server/actions/ratings";
import { fmtDate, pct } from "@/lib/utils";

type Crit = { key: string; score: number };
type League = {
  vendorId: string;
  name: string;
  status: string;
  overall: number | null;
  completedOrders: number;
  projectRating: number | null;
  projectOrders: number;
  inProject: boolean;
  grade: { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" };
  criteria: Crit[];
  projectCriteria: Crit[];
  onTime: number | null;
  trend: { date: string; stars: number }[];
};
type Order = {
  id: string;
  vendorId: string;
  vendor: string;
  poId: string;
  poNumber: string;
  project: string;
  projectId: string;
  date: string;
  stars: number;
  totalScore: number;
  adjusted: boolean;
  feedback: string | null;
  criteria: { key: string; weight: number; autoScore: number; adjustment: number; finalScore: number; comment: string | null }[];
};

export function RatingsView({ projectName, canAdjust, weights, league, orders }: { projectName: string; canAdjust: boolean; weights: Record<string, number>; league: League[]; orders: Order[] }) {
  const [scope, setScope] = React.useState<"project" | "all">("project");
  const [adjusting, setAdjusting] = React.useState<Order | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const rows = scope === "project" ? league.filter((l) => l.inProject) : league;
  const lCols: ColumnDef<League, unknown>[] = [
    { id: "rank", header: "#", cell: ({ row }) => <span className="text-muted">{row.index + 1}</span> },
    { accessorKey: "name", header: "Vendor", cell: ({ row: { original: l } }) => <div><Link href={`/vendors/${l.vendorId}`} className="link">{l.name}</Link><div className="flex gap-1"><Badge tone={l.grade.tone}>{l.grade.label}</Badge>{l.status !== "ACTIVE" && <StatusBadge status={l.status} />}</div></div> },
    { accessorKey: "overall", header: "Overall", sortingFn: (a, b) => (a.original.overall ?? 0) - (b.original.overall ?? 0), cell: ({ row: { original: l } }) => <div><Stars value={l.overall} /><div className="text-xs text-muted">{l.completedOrders} orders</div></div> },
    { accessorKey: "projectRating", header: "This project", sortingFn: (a, b) => (a.original.projectRating ?? 0) - (b.original.projectRating ?? 0), cell: ({ row: { original: l } }) => (l.projectOrders ? <div><Stars value={l.projectRating} /><div className="text-xs text-muted">{l.projectOrders} orders</div></div> : <span className="text-xs text-muted">—</span>) },
    ...POINTER_ORDER.map<ColumnDef<League, unknown>>((k) => ({
      id: k,
      header: POINTER_LABELS[k].split(" ")[0],
      accessorFn: (l) => l.criteria.find((c) => c.key === k)?.score ?? 0,
      cell: ({ getValue }) => <div className="w-20"><div className="text-xs tabular-nums">{((getValue() as number) / 20).toFixed(1)}★</div><ScoreBar value={getValue() as number} /></div>,
    })),
    { accessorKey: "onTime", header: "On-time", cell: ({ getValue }) => pct(getValue() as number | null, 0) },
    { id: "trend", header: "Trend", enableSorting: false, cell: ({ row: { original: l } }) => <RatingSparkline points={l.trend} /> },
    { id: "act", header: "", enableSorting: false, cell: ({ row: { original: l } }) => <Button size="sm" variant="ghost" onClick={() => setSelected(l.vendorId)}>Orders</Button> },
  ];
  const oCols: ColumnDef<Order, unknown>[] = [
    { accessorKey: "date", header: "Closed", cell: ({ getValue }) => fmtDate(getValue() as string) },
    { accessorKey: "vendor", header: "Vendor" },
    { accessorKey: "poNumber", header: "PO", cell: ({ row: { original: o } }) => <Link href={`/purchase-orders/${o.poId}`} className="link">{o.poNumber}</Link> },
    { accessorKey: "project", header: "Project" },
    { accessorKey: "stars", header: "Rating", cell: ({ row: { original: o } }) => <div className="flex items-center gap-1"><Stars value={o.stars} />{o.adjusted && <Badge>Adjusted</Badge>}</div> },
    ...POINTER_ORDER.map<ColumnDef<Order, unknown>>((k) => ({ id: k, header: POINTER_LABELS[k].split(" ")[0], accessorFn: (o) => o.criteria.find((c) => c.key === k)?.finalScore ?? 0, cell: ({ getValue }) => <span className="tabular-nums">{((getValue() as number) / 20).toFixed(1)}</span> })),
    { accessorKey: "feedback", header: "Feedback", cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) ?? ""}</span> },
    { id: "act", header: "", enableSorting: false, cell: ({ row: { original: o } }) => canAdjust && <Button size="sm" variant="secondary" onClick={() => setAdjusting(o)}><SlidersHorizontal className="h-4 w-4" /> Adjust</Button> },
  ];
  const focus = league.find((l) => l.vendorId === selected);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-white p-0.5" role="group" aria-label="Scope">
          {(["project", "all"] as const).map((s) => <button key={s} onClick={() => setScope(s)} aria-pressed={scope === s} className={`rounded-md px-3 py-1 text-xs font-medium ${scope === s ? "bg-brand-600 text-white" : "text-brand-800"}`}>{s === "project" ? `Vendors in ${projectName}` : "All vendors"}</button>)}
        </div>
        <span className="text-xs text-muted">Weights: {POINTER_ORDER.map((k) => `${POINTER_LABELS[k].split(" ")[0]} ${weights[k]}%`).join(" · ")} · Grades: ≥4.5 Excellent · 3.5–4.4 Good · 2.5–3.4 Average · &lt;2.5 Poor · &lt;3 orders = New (3.5 used in scoring)</span>
      </div>
      <Tabs defaultValue="league">
        <TabsList>
          <TabsTrigger value="league">League table</TabsTrigger>
          <TabsTrigger value="orders">Order-by-order ({orders.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="league">
          <DataTable data={[...rows].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))} columns={lCols} csvName="vendor-league" csvRow={(l) => ({ Vendor: l.name, Overall: l.overall ?? "", Orders: l.completedOrders, Grade: l.grade.label, ...Object.fromEntries(l.criteria.map((c) => [POINTER_LABELS[c.key], (c.score / 20).toFixed(2)])) })} emptyTitle="No rated vendors yet" emptyDescription="Ratings appear after orders are closed." />
          {focus && (
            <div className="card mt-4 grid gap-4 p-4 md:grid-cols-[1fr_1fr]">
              <div>
                <h3 className="mb-2 font-semibold">{focus.name} — overall breakdown</h3>
                <RatingBreakdown criteria={focus.criteria.map((c) => ({ ...c, weight: weights[c.key] }))} />
              </div>
              <div>
                <h3 className="mb-2 font-semibold">This project</h3>
                {focus.projectOrders ? <RatingBreakdown criteria={focus.projectCriteria} /> : <p className="text-sm text-muted">No orders on this project yet.</p>}
              </div>
            </div>
          )}
        </TabsContent>
        <TabsContent value="orders">
          <DataTable data={selected ? orders.filter((o) => o.vendorId === selected) : orders} columns={oCols} csvName="vendor-ratings-orders" emptyTitle="No ratings" toolbar={selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Show all vendors</Button>} />
        </TabsContent>
      </Tabs>
      <AdjustDialog order={adjusting} onClose={() => setAdjusting(null)} />
    </>
  );
}

function AdjustDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const router = useRouter();
  const [adj, setAdj] = React.useState<Record<string, { adjustment: number; comment: string }>>({});
  const [feedback, setFeedback] = React.useState("");
  const [pending, start] = React.useTransition();
  React.useEffect(() => {
    if (!order) return;
    setAdj(Object.fromEntries(order.criteria.map((c) => [c.key, { adjustment: c.adjustment, comment: c.comment ?? "" }])));
    setFeedback(order.feedback ?? "");
  }, [order]);
  if (!order) return null;
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Adjust rating — ${order.vendor} · ${order.poNumber}`} description="Each pointer can move ±1 star from the automatic score. A comment is mandatory for every change; all changes are logged." wide>
        <div className="space-y-3">
          {POINTER_ORDER.map((k) => {
            const c = order.criteria.find((x) => x.key === k)!;
            const a = adj[k] ?? { adjustment: 0, comment: "" };
            const final = Math.max(0, Math.min(100, c.autoScore + a.adjustment * 20));
            return (
              <div key={k} className="grid items-end gap-2 md:grid-cols-[220px_110px_140px_1fr]">
                <div><div className="text-sm font-medium">{POINTER_LABELS[k]}</div><div className="text-xs text-muted">Auto {(c.autoScore / 20).toFixed(1)}★ → <strong>{(final / 20).toFixed(1)}★</strong> · weight {c.weight}%</div></div>
                <Field label="Adjustment">
                  <Select value={String(a.adjustment)} onChange={(e) => setAdj({ ...adj, [k]: { ...a, adjustment: Number(e.target.value) } })}>
                    {[-1, -0.5, 0, 0.5, 1].map((v) => <option key={v} value={v}>{v > 0 ? `+${v}` : v}★</option>)}
                  </Select>
                </Field>
                <div className="pb-2"><ScoreBar value={final} /></div>
                <Field label="Comment"><Input value={a.comment} onChange={(e) => setAdj({ ...adj, [k]: { ...a, comment: e.target.value } })} placeholder={a.adjustment !== 0 ? "Required" : "Optional"} /></Field>
              </div>
            );
          })}
          <Field label="Free-text feedback"><Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
          <div className="flex justify-end">
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await adjustRatingAction({ ratingId: order.id, adjustments: Object.entries(adj).map(([key, v]) => ({ key: key as "PRICE", adjustment: v.adjustment, comment: v.comment })), feedback: feedback || undefined });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Rating updated — rolling vendor rating recalculated");
                  onClose();
                  router.refresh();
                })
              }
            >
              Save adjustments
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
