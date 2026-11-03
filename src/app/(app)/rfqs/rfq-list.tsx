"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge, StatusBadge } from "@/components/ui/misc";
import { Select } from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fmtDate, fmtDateTime, inr, qty } from "@/lib/utils";

type Row = {
  id: string;
  number: string;
  material: string;
  quantity: number;
  unit: string;
  status: string;
  invited: number;
  responded: number;
  declined: number;
  needsReview: number;
  deadline: string;
  expected: string;
  createdAt: string;
  recommended: string | null;
  bestLanded: number | null;
};
type Approval = { id: string; rfqId: string; number: string; material: string; amount: number; vendor: string; isRecommended: boolean; step: string; mine: boolean; requestedBy: string; createdAt: string };

export function RfqList({ rows, approvals, tab }: { rows: Row[]; approvals: Approval[]; tab: string }) {
  const [status, setStatus] = React.useState("");
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "number", header: "RFQ", cell: ({ row: { original: r } }) => <Link href={`/rfqs/${r.id}`} className="link whitespace-nowrap">{r.number}</Link> },
    { accessorKey: "material", header: "Material", cell: ({ row: { original: r } }) => <div>{r.material}<div className="text-xs text-muted">{qty(r.quantity, r.unit)}</div></div> },
    { accessorKey: "status", header: "Status", cell: ({ row: { original: r } }) => <div className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.needsReview > 0 && <Badge tone="warning">{r.needsReview} needs review</Badge>}</div> },
    { id: "responses", header: "Responses", accessorFn: (r) => r.responded, cell: ({ row: { original: r } }) => <span className="tabular-nums">{r.responded} of {r.invited}{r.declined ? <span className="text-xs text-muted"> · {r.declined} declined</span> : null}</span> },
    { accessorKey: "recommended", header: "Recommended", cell: ({ row: { original: r } }) => (r.recommended ? <div>{r.recommended}<div className="text-xs text-muted">{inr(r.bestLanded, false)}</div></div> : <span className="text-muted">—</span>) },
    { accessorKey: "deadline", header: "Deadline", cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDateTime(getValue() as string)}</span> },
    { accessorKey: "expected", header: "Need by", cell: ({ getValue }) => fmtDate(getValue() as string) },
    { accessorKey: "createdAt", header: "Created", cell: ({ getValue }) => fmtDate(getValue() as string) },
  ];
  const aCols: ColumnDef<Approval, unknown>[] = [
    { accessorKey: "number", header: "RFQ", cell: ({ row: { original: a } }) => <Link href={`/rfqs/${a.rfqId}?tab=approval`} className="link">{a.number}</Link> },
    { accessorKey: "material", header: "Material" },
    { accessorKey: "vendor", header: "Vendor", cell: ({ row: { original: a } }) => <div>{a.vendor} {a.isRecommended ? <Badge tone="success">Recommended</Badge> : <Badge tone="warning">Override</Badge>}</div> },
    { accessorKey: "amount", header: "Amount", cell: ({ getValue }) => inr(getValue() as number, false) },
    { accessorKey: "step", header: "Waiting on", cell: ({ row: { original: a } }) => <div>{a.step}{a.mine && <Badge tone="brand" className="ml-1">You</Badge>}</div> },
    { accessorKey: "requestedBy", header: "Requested by" },
    { accessorKey: "createdAt", header: "Requested", cell: ({ getValue }) => fmtDateTime(getValue() as string) },
  ];
  return (
    <Tabs defaultValue={tab}>
      <TabsList>
        <TabsTrigger value="all">All RFQs ({rows.length})</TabsTrigger>
        <TabsTrigger value="approvals">Pending approvals ({approvals.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        <DataTable
          data={rows.filter((r) => !status || r.status === status)}
          columns={columns}
          csvName="rfqs"
          searchPlaceholder="Search RFQs…"
          emptyTitle="No RFQs yet"
          emptyDescription="Create an RFQ from the Procurement tab using the RFQ button on any material."
          emptyAction={<Link href="/procurement" className="link">Go to Procurement</Link>}
          filters={
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">
              <option value="">All statuses</option>
              {["SENT", "PARTIALLY_RESPONDED", "CLOSED", "AWAITING_APPROVAL", "APPROVED", "ORDERED", "CANCELLED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
            </Select>
          }
        />
      </TabsContent>
      <TabsContent value="approvals">
        <DataTable data={approvals} columns={aCols} csvName="pending-approvals" emptyTitle="Nothing awaiting approval" />
      </TabsContent>
    </Tabs>
  );
}
