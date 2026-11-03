"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

export function VendorPoForms({ token, status }: { token: string; status: string }) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [changeOpen, setChangeOpen] = React.useState(false);
  const post = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    const res = await fetch(`/api/vendor/po/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: success } : { ok: false, text: j.error ?? "Something went wrong" });
    if (res.ok) router.refresh();
  };
  const awaiting = ["SENT", "CHANGE_REQUESTED"].includes(status);
  const canDispatch = ["SENT", "ACCEPTED", "PARTIALLY_DELIVERED"].includes(status);
  return (
    <>
      {msg && <p className={msg.ok ? "rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800" : "rounded-lg bg-red-50 px-3 py-2 text-sm text-danger"} role="status">{msg.text}</p>}
      {(awaiting || status === "ACCEPTED") && (
        <Card title="Your response">
          <div className="flex flex-wrap gap-2">
            {awaiting && <Button loading={busy} onClick={() => post({ action: "accept" }, "Thank you — PO accepted.")}>Accept PO</Button>}
            <Button variant="secondary" onClick={() => setChangeOpen((x) => !x)}>Request change</Button>
          </div>
          {changeOpen && (
            <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); post({ action: "change", note: String(new FormData(e.currentTarget).get("note")) }, "Change request sent to NYATI procurement."); setChangeOpen(false); }}>
              <Field label="What needs to change?"><Textarea name="note" rows={3} required minLength={5} /></Field>
              <Button type="submit" loading={busy}>Send request</Button>
            </form>
          )}
        </Card>
      )}
      {canDispatch && (
        <Card title="Dispatch / delivery update">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const eta = String(fd.get("eta") || "");
              post({ action: "dispatch", status: fd.get("status"), vehicleNo: fd.get("vehicleNo") || undefined, driverName: fd.get("driverName") || undefined, driverPhone: fd.get("driverPhone") || undefined, eta: eta ? new Date(eta).toISOString() : undefined, note: fd.get("note") || undefined }, "Update shared with the site team.");
              e.currentTarget.reset();
            }}
          >
            <Field label="Status"><Select name="status"><option value="DISPATCHED">Dispatched</option><option value="IN_TRANSIT">In transit</option><option value="DELAYED">Delayed</option><option value="ARRIVED">Arrived at site</option></Select></Field>
            <Field label="ETA at site"><Input type="datetime-local" name="eta" /></Field>
            <Field label="Vehicle no."><Input name="vehicleNo" /></Field>
            <Field label="Driver name"><Input name="driverName" /></Field>
            <Field label="Driver phone"><Input name="driverPhone" /></Field>
            <Field label="Note"><Input name="note" /></Field>
            <div className="sm:col-span-2"><Button type="submit" loading={busy}>Share update</Button></div>
          </form>
        </Card>
      )}
    </>
  );
}
