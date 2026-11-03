"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge, Skeleton, Stars, Kpi } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { getMaterialDetail, recordStockMovement, updateReorderLevel, raiseMaterialRequest } from "@/server/actions/procurement";
import { fmtDate, fmtDateTime, inr, qty } from "@/lib/utils";
import type { MaterialRow } from "./procurement-table";

type Detail = Extract<Awaited<ReturnType<typeof getMaterialDetail>>, { ok: true }>["data"];

export function MaterialDrawer({ row, projectId, canStock, onClose, onRfq }: { row: MaterialRow | null; projectId: string; canStock: boolean; onClose: () => void; onRfq?: (r: MaterialRow) => void }) {
  const [data, setData] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    if (!row) return;
    const r = await getMaterialDetail(projectId, row.materialId);
    if (r.ok) setData(r.data);
    else setError(r.error);
  }, [row, projectId]);
  React.useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [load]);

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      {row && (
        <SheetContent title={row.name} description={`${row.code} · ${row.category}${row.spec ? ` · ${row.spec}` : ""}`}>
          {error && <p className="text-sm text-danger">{error}</p>}
          {!data && !error && (
            <div className="space-y-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-40" />
            </div>
          )}
          {data && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-2">
                <Kpi label="In stock" value={qty(Number(data.stock?.currentQty ?? 0), row.unit)} tone={row.status === "low" ? "danger" : undefined} />
                <Kpi label="Reorder level" value={qty(Number(data.stock?.reorderLevel ?? 0), row.unit)} />
                <Kpi label="Last rate" value={row.rate ? inr(row.rate) : "—"} sub={row.rateAt ? fmtDate(row.rateAt) : undefined} />
              </div>
              {onRfq && (
                <Button className="mb-4" onClick={() => onRfq(row)}>
                  <Send className="h-4 w-4" /> Create RFQ
                </Button>
              )}
              <Tabs defaultValue="ledger">
                <TabsList>
                  <TabsTrigger value="ledger">Stock ledger</TabsTrigger>
                  <TabsTrigger value="vendors">Linked vendors ({data.vendors.length})</TabsTrigger>
                  <TabsTrigger value="purchases">Last 5 purchases</TabsTrigger>
                  {canStock && <TabsTrigger value="update">Update stock</TabsTrigger>}
                </TabsList>
                <TabsContent value="ledger">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th">Date</th>
                        <th className="th">Type</th>
                        <th className="th text-right">Qty</th>
                        <th className="th text-right">Balance</th>
                        <th className="th">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger.map((l) => (
                        <tr key={l.id}>
                          <td className="td whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                          <td className="td">
                            <Badge tone={l.type === "IN" ? "success" : l.type === "OUT" ? "warning" : "neutral"}>{l.type === "IN" ? "In" : l.type === "OUT" ? "Out" : "Adjust"}</Badge>
                          </td>
                          <td className="td text-right tabular-nums">{l.type === "OUT" ? "−" : l.qty > 0 ? "+" : ""}{qty(Math.abs(l.qty))}</td>
                          <td className="td text-right tabular-nums">{qty(l.balanceAfter)}</td>
                          <td className="td text-xs text-muted">{l.note ?? l.refType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.ledger.length && <p className="py-6 text-center text-sm text-muted">No stock movements yet.</p>}
                </TabsContent>
                <TabsContent value="vendors">
                  <ul className="divide-y divide-border">
                    {data.vendors.map((pv) => (
                      <li key={pv.id} className="flex items-center justify-between gap-3 py-2">
                        <div>
                          <a href={`/vendors/${pv.vendorId}`} className="link">{pv.vendor.name}</a>
                          <div className="text-xs text-muted">
                            {pv.vendor.city} · {pv.distanceKm !== null ? `${Math.round(pv.distanceKm)} km` : "distance n/a"} · lead {pv.vendor.leadTimeDays} d
                          </div>
                        </div>
                        <div className="text-right">
                          <Stars value={pv.vendor.overallRating} />
                          <div className="text-xs text-muted">{pv.vendor.materials[0]?.lastRate ? `Last ${inr(pv.vendor.materials[0].lastRate)}` : ""}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!data.vendors.length && <p className="py-6 text-center text-sm text-muted">No vendors in this project's vendor book supply this material.</p>}
                </TabsContent>
                <TabsContent value="purchases">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th">Date</th>
                        <th className="th">Vendor</th>
                        <th className="th">PO</th>
                        <th className="th text-right">Qty</th>
                        <th className="th text-right">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.purchases.map((p) => (
                        <tr key={p.id}>
                          <td className="td">{fmtDate(p.date)}</td>
                          <td className="td">{p.vendor.name}</td>
                          <td className="td text-xs">{p.poNumber}</td>
                          <td className="td text-right tabular-nums">{qty(p.qty, row.unit)}</td>
                          <td className="td text-right tabular-nums">{inr(p.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.purchases.length && <p className="py-6 text-center text-sm text-muted">No purchases recorded for this project.</p>}
                </TabsContent>
                {canStock && (
                  <TabsContent value="update">
                    <StockForms row={row} projectId={projectId} onDone={load} />
                  </TabsContent>
                )}
              </Tabs>
            </>
          )}
        </SheetContent>
      )}
    </Dialog>
  );
}

function StockForms({ row, projectId, onDone }: { row: MaterialRow; projectId: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const submitMove = (fd: FormData) =>
    start(async () => {
      const r = await recordStockMovement({ projectId, materialId: row.materialId, type: fd.get("type") as "OUT", qty: Number(fd.get("qty")), note: String(fd.get("note") ?? "") });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Stock updated — balance ${qty(r.data.balance, row.unit)}`);
      onDone();
      router.refresh();
    });
  return (
    <div className="space-y-6">
      <form action={submitMove} className="grid grid-cols-2 gap-3">
        <h3 className="col-span-2 text-sm font-semibold">Record stock movement</h3>
        <Field label="Movement">
          <Select name="type" defaultValue="OUT">
            <option value="OUT">Issue to site (out)</option>
            <option value="IN">Manual receipt (in)</option>
            <option value="ADJUST">Physical count (set balance)</option>
          </Select>
        </Field>
        <Field label={`Quantity (${row.unit})`}>
          <Input name="qty" type="number" step="any" min="0" required />
        </Field>
        <Field label="Note" className="col-span-2">
          <Input name="note" placeholder="e.g. Issued to Tower B slab casting" required />
        </Field>
        <div className="col-span-2">
          <Button type="submit" loading={pending}>Save movement</Button>
        </div>
      </form>
      <form
        action={(fd) =>
          start(async () => {
            const r = await updateReorderLevel(projectId, row.materialId, Number(fd.get("reorder")));
            if (!r.ok) return void toast.error(r.error);
            toast.success("Reorder level updated");
            router.refresh();
          })
        }
        className="flex items-end gap-3"
      >
        <Field label={`Reorder level (${row.unit})`} className="flex-1">
          <Input name="reorder" type="number" step="any" min="0" defaultValue={row.reorderLevel} required />
        </Field>
        <Button type="submit" variant="secondary" loading={pending}>Update</Button>
      </form>
      <form
        action={(fd) =>
          start(async () => {
            const r = await raiseMaterialRequest(projectId, row.materialId, Number(fd.get("qty")), String(fd.get("note") ?? ""));
            if (!r.ok) return void toast.error(r.error);
            toast.success("Material request raised — procurement has been notified");
            router.refresh();
          })
        }
        className="grid grid-cols-2 gap-3"
      >
        <h3 className="col-span-2 text-sm font-semibold">Raise material request</h3>
        <Field label={`Quantity needed (${row.unit})`}>
          <Input name="qty" type="number" step="any" min="0" defaultValue={Math.max(row.reorderLevel * 2 - row.currentQty, 0)} required />
        </Field>
        <Field label="Note">
          <Input name="note" placeholder="Required for…" />
        </Field>
        <div className="col-span-2">
          <Button type="submit" variant="secondary" loading={pending}>Raise request</Button>
        </div>
      </form>
    </div>
  );
}
