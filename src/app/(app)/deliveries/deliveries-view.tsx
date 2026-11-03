"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge, StatusBadge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { GrnDialog, type PoForForms } from "@/components/order-forms";
import { resolveReturn } from "@/server/actions/orders";
import { fmtDate, fmtDateTime, qty } from "@/lib/utils";

type Incoming = { po: PoForForms; status: string; promised: string; eta: string | null; lastUpdate: string | null; late: boolean };
type Grn = { id: string; number: string; poId: string; poNumber: string; vendor: string; material: string; unit: string; delivered: number; accepted: number; rejected: number; qcOk: boolean; receivedAt: string };
type Ret = { id: string; poId: string; poNumber: string; vendor: string; material: string; qty: number; unit: string; reason: string; status: string; createdAt: string };

export function DeliveriesView({ incoming, grns, returns, canReceive }: { incoming: Incoming[]; grns: Grn[]; returns: Ret[]; canReceive: boolean }) {
  const router = useRouter();
  const [grnPo, setGrnPo] = React.useState<PoForForms | null>(null);
  const [pending, start] = React.useTransition();
  const inCols: ColumnDef<Incoming, unknown>[] = [
    { id: "po", header: "PO", accessorFn: (r) => r.po.number, cell: ({ row: { original: r } }) => <Link href={`/purchase-orders/${r.po.id}`} className="link">{r.po.number}</Link> },
    { id: "vendor", header: "Vendor", accessorFn: (r) => r.po.vendor },
    { id: "material", header: "Material", accessorFn: (r) => r.po.items[0]?.description, cell: ({ row: { original: r } }) => <div className="max-w-xs">{r.po.items[0]?.description}<div className="text-xs text-muted">{qty(r.po.items[0]?.acceptedQty, r.po.items[0]?.unit)} of {qty(r.po.items[0]?.quantity, r.po.items[0]?.unit)} received</div></div> },
    { accessorKey: "status", header: "PO status", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: "promised", header: "Expected", cell: ({ row: { original: r } }) => <span className={r.late ? "font-semibold text-danger" : ""}>{fmtDate(r.promised)}{r.late && <Badge tone="danger" className="ml-1">Late</Badge>}</span> },
    { accessorKey: "eta", header: "Vendor ETA", cell: ({ row: { original: r } }) => <div>{r.eta ? fmtDateTime(r.eta) : "—"}<div className="text-xs text-muted">{r.lastUpdate}</div></div> },
    { id: "act", header: "", enableSorting: false, cell: ({ row: { original: r } }) => canReceive && <Button size="sm" onClick={() => setGrnPo(r.po)}><PackageCheck className="h-4 w-4" /> Record GRN</Button> },
  ];
  const grnCols: ColumnDef<Grn, unknown>[] = [
    { accessorKey: "number", header: "GRN", cell: ({ row: { original: g } }) => <Link href={`/purchase-orders/${g.poId}`} className="link">{g.number}</Link> },
    { accessorKey: "receivedAt", header: "Received", cell: ({ getValue }) => fmtDateTime(getValue() as string) },
    { accessorKey: "poNumber", header: "PO" },
    { accessorKey: "vendor", header: "Vendor" },
    { accessorKey: "material", header: "Material" },
    { accessorKey: "delivered", header: "Delivered", cell: ({ row: { original: g } }) => qty(g.delivered, g.unit) },
    { accessorKey: "accepted", header: "Accepted", cell: ({ row: { original: g } }) => qty(g.accepted, g.unit) },
    { accessorKey: "rejected", header: "Rejected", cell: ({ row: { original: g } }) => (g.rejected ? <span className="text-danger">{qty(g.rejected, g.unit)}</span> : "—") },
    { accessorKey: "qcOk", header: "Inspection", cell: ({ getValue }) => <Badge tone={getValue() ? "success" : "warning"}>{getValue() ? "Passed" : "Issues"}</Badge> },
  ];
  const retCols: ColumnDef<Ret, unknown>[] = [
    { accessorKey: "poNumber", header: "PO", cell: ({ row: { original: r } }) => <Link href={`/purchase-orders/${r.poId}`} className="link">{r.poNumber}</Link> },
    { accessorKey: "vendor", header: "Vendor" },
    { accessorKey: "material", header: "Material", cell: ({ row: { original: r } }) => `${qty(r.qty, r.unit)} ${r.material}` },
    { accessorKey: "reason", header: "Reason" },
    { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: "createdAt", header: "Raised", cell: ({ getValue }) => fmtDate(getValue() as string) },
    {
      id: "act",
      header: "",
      cell: ({ row: { original: r } }) =>
        canReceive && r.status === "OPEN" && (
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => { const x = await resolveReturn(r.id, "REPLACED"); x.ok ? toast.success("Marked replaced") : toast.error(x.error); router.refresh(); })}>Replaced</Button>
            <Button size="sm" variant="ghost" loading={pending} onClick={() => start(async () => { const x = await resolveReturn(r.id, "CREDITED"); x.ok ? toast.success("Marked credited") : toast.error(x.error); router.refresh(); })}>Credit note</Button>
          </div>
        ),
    },
  ];
  return (
    <>
      <Tabs defaultValue="incoming">
        <TabsList>
          <TabsTrigger value="incoming">Expected deliveries ({incoming.length})</TabsTrigger>
          <TabsTrigger value="grns">GRN register ({grns.length})</TabsTrigger>
          <TabsTrigger value="returns">Returns ({returns.filter((r) => r.status === "OPEN").length} open)</TabsTrigger>
        </TabsList>
        <TabsContent value="incoming">
          <DataTable data={incoming} columns={inCols} csvName="expected-deliveries" rowClassName={(r) => (r.late ? "bg-red-50/60" : undefined)} emptyTitle="No deliveries expected" />
        </TabsContent>
        <TabsContent value="grns">
          <DataTable data={grns} columns={grnCols} csvName="grn-register" emptyTitle="No goods received yet" />
        </TabsContent>
        <TabsContent value="returns">
          <DataTable data={returns} columns={retCols} csvName="returns" emptyTitle="No returns" />
        </TabsContent>
      </Tabs>
      <GrnDialog po={grnPo} open={!!grnPo} onOpenChange={(o) => !o && setGrnPo(null)} />
    </>
  );
}
