"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Printer } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line } from "recharts";
import { DataTable } from "@/components/data-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, Kpi, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { SERIES, BRAND } from "@/lib/chart-colors";
import { fmtDate, inr, inrCompact, pct } from "@/lib/utils";

type NV = { name: string; value: number };
type Saving = { po: string; rfq: string; vendor: string; followedRecommendation: boolean; awarded: number; highest: number; average: number; savingVsHighest: number; savingVsAverage: number };
type Resp = { vendor: string; invited: number; responded: number; declined: number; rate: number; avgHours: number | null };
type Delay = { grn: string; po: string; vendor: string; promised: string; received: string; daysLate: number };

export function ReportsView(p: {
  scope: "project" | "all";
  months: number;
  spendByVendor: NV[];
  spendByMaterial: NV[];
  spendByCategory: NV[];
  spendByProject: NV[];
  spendByMonth: { month: string; value: number }[];
  savings: Saving[];
  response: Resp[];
  delays: Delay[];
  materials: { id: string; name: string; unit: string }[];
  trend: Record<string, { month: string; avg: number }[]>;
}) {
  const router = useRouter();
  const [spendDim, setSpendDim] = React.useState<"vendor" | "material" | "category" | "project">("vendor");
  const [material, setMaterial] = React.useState(p.materials[0]?.id ?? "");
  const spend = { vendor: p.spendByVendor, material: p.spendByMaterial, category: p.spendByCategory, project: p.spendByProject }[spendDim];
  const totalSpend = p.spendByVendor.reduce((s, x) => s + x.value, 0);
  const totalSavingHigh = p.savings.reduce((s, x) => s + x.savingVsHighest, 0);
  const totalSavingAvg = p.savings.reduce((s, x) => s + x.savingVsAverage, 0);
  const followed = p.savings.filter((s) => s.followedRecommendation).length;
  const late = p.delays.filter((d) => d.daysLate > 0);
  const setParam = (k: string, v: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set(k, v);
    router.push(u.pathname + u.search);
  };
  const nvCols: ColumnDef<NV, unknown>[] = [
    { accessorKey: "name", header: spendDim[0].toUpperCase() + spendDim.slice(1) },
    { accessorKey: "value", header: "Spend (₹)", cell: ({ getValue }) => inr(getValue() as number, false) },
    { id: "share", header: "Share", accessorFn: (r) => (totalSpend ? (r.value / totalSpend) * 100 : 0), cell: ({ getValue }) => pct(getValue() as number) },
  ];
  const sCols: ColumnDef<Saving, unknown>[] = [
    { accessorKey: "rfq", header: "RFQ" },
    { accessorKey: "po", header: "PO" },
    { accessorKey: "vendor", header: "Awarded to", cell: ({ row: { original: s } }) => <div>{s.vendor} {s.followedRecommendation ? <Badge tone="success">recommended</Badge> : <Badge tone="warning">override</Badge>}</div> },
    { accessorKey: "awarded", header: "Awarded (landed)", cell: ({ getValue }) => inr(getValue() as number, false) },
    { accessorKey: "highest", header: "Highest quote", cell: ({ getValue }) => inr(getValue() as number, false) },
    { accessorKey: "savingVsHighest", header: "Saving vs highest", cell: ({ getValue }) => <span className="text-success">{inr(getValue() as number, false)}</span> },
    { accessorKey: "savingVsAverage", header: "Saving vs average", cell: ({ getValue }) => inr(getValue() as number, false) },
  ];
  const rCols: ColumnDef<Resp, unknown>[] = [
    { accessorKey: "vendor", header: "Vendor" },
    { accessorKey: "invited", header: "Invited" },
    { accessorKey: "responded", header: "Responded" },
    { accessorKey: "declined", header: "Declined" },
    { accessorKey: "rate", header: "Response rate", cell: ({ getValue }) => pct(getValue() as number, 0) },
    { accessorKey: "avgHours", header: "Avg. turnaround", cell: ({ getValue }) => ((getValue() as number | null) === null ? "—" : `${(getValue() as number).toFixed(1)} h`) },
  ];
  const dCols: ColumnDef<Delay, unknown>[] = [
    { accessorKey: "grn", header: "GRN" },
    { accessorKey: "po", header: "PO" },
    { accessorKey: "vendor", header: "Vendor" },
    { accessorKey: "promised", header: "Promised", cell: ({ getValue }) => fmtDate(getValue() as string) },
    { accessorKey: "received", header: "Received", cell: ({ getValue }) => fmtDate(getValue() as string) },
    { accessorKey: "daysLate", header: "Days late", cell: ({ getValue }) => ((getValue() as number) > 0 ? <span className="font-semibold text-danger">{getValue() as number}</span> : <span className="text-success">On time</span>) },
  ];
  const m = p.materials.find((x) => x.id === material);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Select value={p.scope} onChange={(e) => setParam("scope", e.target.value)} className="w-auto" aria-label="Scope"><option value="project">Selected project</option><option value="all">All my projects</option></Select>
        <Select value={String(p.months)} onChange={(e) => setParam("months", e.target.value)} className="w-auto" aria-label="Period"><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option><option value="24">Last 24 months</option></Select>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / PDF</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total spend" value={inrCompact(totalSpend)} />
        <Kpi label="Savings vs highest quote" value={inrCompact(totalSavingHigh)} tone="success" sub={`${inrCompact(totalSavingAvg)} vs average`} />
        <Kpi label="Recommendation followed" value={p.savings.length ? pct((followed / p.savings.length) * 100, 0) : "—"} sub={`${followed} of ${p.savings.length} awards`} />
        <Kpi label="Late deliveries" value={late.length} sub={p.delays.length ? `${pct((late.length / p.delays.length) * 100, 0)} of receipts` : undefined} tone={late.length ? "warning" : undefined} />
      </div>
      <Tabs defaultValue="spend">
        <TabsList>
          <TabsTrigger value="spend">Spend</TabsTrigger>
          <TabsTrigger value="savings">Savings</TabsTrigger>
          <TabsTrigger value="response">RFQ response</TabsTrigger>
          <TabsTrigger value="prices">Price trends</TabsTrigger>
          <TabsTrigger value="delays">Delivery delays</TabsTrigger>
        </TabsList>
        <TabsContent value="spend">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Monthly spend">
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={p.spendByMonth} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke={BRAND.grid} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} />
                    <YAxis tickFormatter={(v) => inrCompact(v)} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} width={70} />
                    <Tooltip formatter={(v: number) => [inr(v, false), "Spend"]} cursor={{ fill: BRAND.tint }} />
                    <Bar dataKey="value" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Spend breakdown" actions={<Select value={spendDim} onChange={(e) => setSpendDim(e.target.value as "vendor")} className="w-auto" aria-label="Breakdown"><option value="vendor">By vendor</option><option value="material">By material</option><option value="category">By category</option><option value="project">By project</option></Select>}>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={spend.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke={BRAND.grid} horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => inrCompact(v)} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} />
                    <Tooltip formatter={(v: number) => [inr(v, false), "Spend"]} cursor={{ fill: BRAND.tint }} />
                    <Bar dataKey="value" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
          <div className="mt-4"><DataTable data={spend} columns={nvCols} csvName={`spend-by-${spendDim}`} /></div>
        </TabsContent>
        <TabsContent value="savings">
          <DataTable data={p.savings} columns={sCols} csvName="savings" emptyTitle="No awarded RFQs with 2+ quotes in this period" />
        </TabsContent>
        <TabsContent value="response">
          <DataTable data={p.response} columns={rCols} csvName="rfq-response" emptyTitle="No RFQs in this period" />
        </TabsContent>
        <TabsContent value="prices">
          <Card title={m ? `${m.name} — average purchase rate per month (₹/${m.unit})` : "Price trend"} actions={<Select value={material} onChange={(e) => setMaterial(e.target.value)} className="w-auto" aria-label="Material">{p.materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={p.trend[material] ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={BRAND.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} />
                  <YAxis domain={["auto", "auto"]} tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} tick={{ fontSize: 11, fill: BRAND.muted }} stroke={BRAND.grid} width={80} />
                  <Tooltip formatter={(v: number) => [inr(v), "Avg rate"]} />
                  <Line dataKey="avg" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, fill: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>
        <TabsContent value="delays">
          <DataTable data={p.delays} columns={dCols} csvName="delivery-delays" rowClassName={(d) => (d.daysLate > 0 ? "bg-amber-50/60" : undefined)} emptyTitle="No receipts in this period" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
