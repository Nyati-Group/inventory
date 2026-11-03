"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge, StatusBadge } from "@/components/ui/misc";
import { Select } from "@/components/ui/form";
import { fmtDate, inr, qty } from "@/lib/utils";

type Row = { id: string; number: string; vendor: string; material: string; quantity: number; received: number; unit: string; total: number; status: string; expected: string; late: boolean; rfq: string | null; createdAt: string };

export function PoList({ rows }: { rows: Row[] }) {
  const [status, setStatus] = React.useState("");
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "number", header: "PO", cell: ({ row: { original: r } }) => <Link href={`/purchase-orders/${r.id}`} className="link whitespace-nowrap">{r.number}</Link> },
    { accessorKey: "vendor", header: "Vendor" },
    { accessorKey: "material", header: "Material", cell: ({ row: { original: r } }) => <div>{r.material}<div className="text-xs text-muted">{qty(r.received, r.unit)} of {qty(r.quantity, r.unit)} received</div></div> },
    { accessorKey: "total", header: "Value", cell: ({ getValue }) => <span className="tabular-nums">{inr(getValue() as number, false)}</span> },
    { accessorKey: "status", header: "Status", cell: ({ row: { original: r } }) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.late && <Badge tone="danger">Late</Badge>}</div> },
    { accessorKey: "expected", header: "Delivery due", cell: ({ getValue }) => fmtDate(getValue() as string) },
    { accessorKey: "rfq", header: "RFQ", cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) ?? "—"}</span> },
    { accessorKey: "createdAt", header: "Created", cell: ({ getValue }) => fmtDate(getValue() as string) },
  ];
  return (
    <DataTable
      data={rows.filter((r) => !status || r.status === status)}
      columns={columns}
      csvName="purchase-orders"
      searchPlaceholder="Search POs…"
      emptyTitle="No purchase orders yet"
      emptyDescription="POs are created automatically when an approver approves a recommendation."
      filters={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">
          <option value="">All statuses</option>
          {["APPROVED", "SENT", "ACCEPTED", "CHANGE_REQUESTED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED", "CANCELLED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
        </Select>
      }
    />
  );
}
