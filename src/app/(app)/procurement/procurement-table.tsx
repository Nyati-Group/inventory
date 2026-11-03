"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { LineChart, Send, Plus, Upload, AlertTriangle } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Select, Checkbox } from "@/components/ui/form";
import { cn, inr, qty, fmtDate } from "@/lib/utils";
import { MaterialDrawer } from "./material-drawer";
import { RateGraphModal } from "./rate-graph-modal";
import { RfqModal } from "./rfq-modal";
import { AddMaterialDialog, ImportCsvDialog } from "./material-dialogs";

export interface MaterialRow {
  sr: number;
  materialId: string;
  name: string;
  code: string;
  spec: string | null;
  category: string;
  categoryId: string;
  unit: string;
  currentQty: number;
  reorderLevel: number;
  rate: number | null;
  rateAt: string | null;
  status: "low" | "soon" | "ok";
  openRfq: { id: string; number: string } | null;
  request: { id: string; qty: number; source: string } | null;
}

export interface ProjectLite {
  id: string;
  name: string;
  city: string;
  siteAddress: string;
  defaultDeadlineHours: number;
}

export function ProcurementTable({
  rows,
  categories,
  project,
  summary,
  canRfq,
  canStock,
  initialLowOnly,
}: {
  rows: MaterialRow[];
  categories: { id: string; name: string }[];
  project: ProjectLite;
  summary: { total: number; low: number; openRfqs: number; awaitingApproval: number };
  canRfq: boolean;
  canStock: boolean;
  initialLowOnly: boolean;
}) {
  const [category, setCategory] = React.useState("");
  const [lowOnly, setLowOnly] = React.useState(initialLowOnly);
  const [drawer, setDrawer] = React.useState<MaterialRow | null>(null);
  const [graph, setGraph] = React.useState<MaterialRow | null>(null);
  const [rfq, setRfq] = React.useState<MaterialRow | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const data = rows.filter((r) => (!category || r.categoryId === category) && (!lowOnly || r.status !== "ok"));
  const needReorder = rows.filter((r) => r.status === "low" && !r.openRfq);

  const columns: ColumnDef<MaterialRow, unknown>[] = [
    { accessorKey: "sr", header: "Sr. No", cell: ({ row }) => <span className="text-muted">{row.index + 1}</span>, enableHiding: false },
    {
      accessorKey: "name",
      header: "Material Name",
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[200px]">
          <button onClick={() => setDrawer(r)} className="link text-left">
            {r.name}
          </button>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {r.spec}
            {r.status === "low" && <Badge tone="danger">Low stock</Badge>}
            {r.status === "soon" && <Badge tone="warning">Reorder soon</Badge>}
            {r.openRfq && (
              <Link href={`/rfqs/${r.openRfq.id}`} className="hover:underline">
                <Badge tone="brand">{r.openRfq.number}</Badge>
              </Link>
            )}
          </div>
        </div>
      ),
    },
    { accessorKey: "category", header: "Category" },
    {
      accessorKey: "currentQty",
      header: "Current Quantity",
      cell: ({ row: { original: r } }) => <span className={cn("font-medium tabular-nums", r.status === "low" && "text-danger", r.status === "soon" && "text-warning")}>{qty(r.currentQty, r.unit)}</span>,
    },
    {
      accessorKey: "rate",
      header: "Rate",
      cell: ({ row: { original: r } }) => (
        <div className="tabular-nums">
          {r.rate !== null ? `${inr(r.rate)}/${r.unit}` : <span className="text-muted">—</span>}
          {r.rateAt && <div className="text-xs text-muted">{fmtDate(r.rateAt)}</div>}
        </div>
      ),
    },
    {
      id: "graph",
      header: "View Rate Graph",
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <Button variant="secondary" size="sm" onClick={() => setGraph(r)} aria-label={`View rate graph for ${r.name}`}>
          <LineChart className="h-4 w-4" /> Rate graph
        </Button>
      ),
    },
    { accessorKey: "reorderLevel", header: "Reorder Level", cell: ({ row: { original: r } }) => <span className="tabular-nums">{qty(r.reorderLevel, r.unit)}</span> },
    {
      id: "rfq",
      header: "RFQ",
      enableSorting: false,
      cell: ({ row: { original: r } }) =>
        canRfq ? (
          <Button size="sm" variant={r.status === "low" ? "primary" : "secondary"} onClick={() => setRfq(r)} aria-label={`Create RFQ for ${r.name}`}>
            <Send className="h-4 w-4" /> RFQ
          </Button>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <span>
          <strong className="text-brand-800">{summary.total}</strong> <span className="text-muted">materials</span>
        </span>
        <button onClick={() => setLowOnly(true)} className="hover:underline">
          <strong className="text-danger">{summary.low}</strong> <span className="text-muted">low stock</span>
        </button>
        <Link href="/rfqs" className="hover:underline">
          <strong className="text-brand-800">{summary.openRfqs}</strong> <span className="text-muted">open RFQs</span>
        </Link>
        <Link href="/rfqs?tab=approvals" className="hover:underline">
          <strong className="text-warning">{summary.awaitingApproval}</strong> <span className="text-muted">awaiting approval</span>
        </Link>
        <span className="ml-auto text-xs text-muted">{project.name} · {project.city}</span>
      </div>

      {canRfq && needReorder.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="status">
          <AlertTriangle className="h-4 w-4" />
          <span>
            <strong>{needReorder.length}</strong> material{needReorder.length > 1 ? "s are" : " is"} at or below reorder level without an open RFQ:
          </span>
          {needReorder.slice(0, 4).map((r) => (
            <button key={r.materialId} onClick={() => setRfq(r)} className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100">
              Create RFQ · {r.name}
            </button>
          ))}
        </div>
      )}

      <DataTable
        data={data}
        columns={columns}
        searchPlaceholder="Search materials…"
        csvName="procurement-materials"
        csvRow={(r) => ({ "Sr. No": r.sr, Material: r.name, Category: r.category, "Current Quantity": r.currentQty, Unit: r.unit, "Rate (INR)": r.rate ?? "", "Reorder Level": r.reorderLevel, Status: r.status })}
        rowClassName={(r) => (r.status === "low" ? "bg-red-50/60" : undefined)}
        emptyTitle="No materials"
        emptyDescription="Add materials or import a CSV to start tracking stock for this project."
        pageSize={25}
        filters={
          <>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Filter by category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm text-brand-800">
              <Checkbox checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
            </label>
          </>
        }
        toolbar={
          canStock && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add Material
              </Button>
            </>
          )
        }
      />

      <MaterialDrawer row={drawer} projectId={project.id} canStock={canStock} onClose={() => setDrawer(null)} onRfq={canRfq ? (r) => { setDrawer(null); setRfq(r); } : undefined} />
      <RateGraphModal row={graph} project={project} canRfq={canRfq} onClose={() => setGraph(null)} />
      <RfqModal row={rfq} project={project} onClose={() => setRfq(null)} />
      <AddMaterialDialog open={addOpen} onOpenChange={setAddOpen} projectId={project.id} categories={categories} />
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} projectId={project.id} />
    </>
  );
}
