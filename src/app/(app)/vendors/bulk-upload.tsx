"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/form";
import { previewVendorImport, importVendorRows, type VendorPreviewRow } from "@/server/actions/vendors";

const TEMPLATE = [
  "name,contact_person,email,phone,whatsapp,gstin,pan,address,city,state,pincode,categories,service_radius_km,lead_time_days,payment_terms,credit_days,notes",
  'Shree Ganesh Building Materials,Ramesh Patil,sales@shreeganesh.in,9822012345,9822012345,27ABCDE1234F1Z5,ABCDE1234F,"Plot 12, Hadapsar Industrial Estate",Pune,Maharashtra,411013,Cement;Steel,80,2,30 days credit,30,Prefers WhatsApp',
  "Sahyadri Aggregates,Sunil Jadhav,info@sahyadriagg.in,9890011122,,,,Wagholi,Pune,Maharashtra,412207,Aggregates;Sand,60,1,Against delivery,0,",
].join("\n");

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob(["﻿" + TEMPLATE], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "vendor-bulk-upload-template.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS = {
  new: { tone: "success", label: "New" },
  duplicate: { tone: "warning", label: "Already exists" },
  error: { tone: "danger", label: "Error" },
} as const;

export function BulkUploadButton({ projects, currentProjectId }: { projects: { id: string; name: string }[]; currentProjectId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [rows, setRows] = React.useState<VendorPreviewRow[] | null>(null);
  const [unknownColumns, setUnknownColumns] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [projectId, setProjectId] = React.useState(currentProjectId ?? "");
  const [reading, setReading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  function reset() {
    setFile(null);
    setRows(null);
    setUnknownColumns([]);
    setError(null);
  }

  async function onFile(f: File | undefined) {
    reset();
    if (!f) return;
    setFile(f);
    setReading(true);
    const fd = new FormData();
    fd.set("file", f);
    const r = await previewVendorImport(fd);
    setReading(false);
    if (!r.ok) return setError(r.error);
    setRows(r.data.rows);
    setUnknownColumns(r.data.unknownColumns);
  }

  async function onImport() {
    if (!file) return;
    setImporting(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("projectId", projectId);
    const r = await importVendorRows(fd);
    setImporting(false);
    if (!r.ok) return void toast.error(r.error);
    const { created, linked, skipped, failed } = r.data;
    toast.success(
      `${created} vendor${created === 1 ? "" : "s"} added${skipped.length ? `, ${skipped.length} already existed` : ""}${linked ? `, ${linked} linked to the project` : ""}${failed.length ? `, ${failed.length} failed` : ""}`,
    );
    if (failed.length) toast.error(failed.slice(0, 3).join("\n"));
    setOpen(false);
    reset();
    router.refresh();
  }

  const counts = rows ? { new: rows.filter((r) => r.status === "new").length, duplicate: rows.filter((r) => r.status === "duplicate").length, error: rows.filter((r) => r.status === "error").length } : null;
  const willImport = counts ? counts.new + (projectId ? counts.duplicate : 0) : 0;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Bulk upload
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent
          wide
          title="Bulk upload vendors"
          description="Upload a CSV or Excel (.xlsx) list. Required columns: name, email, city. Vendors with the same GSTIN or email as an existing vendor are not created twice."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Vendor list (.csv or .xlsx)" className="min-w-[240px] flex-1">
                <Input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="py-1.5" onChange={(e) => onFile(e.target.files?.[0])} />
              </Field>
              <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4" /> Download template
              </Button>
            </div>
            <p className="text-xs text-muted">
              Columns: name, contact_person, email, phone, whatsapp, gstin, pan, address, city, state, pincode, categories (separate with ;), service_radius_km, lead_time_days, payment_terms, credit_days, notes. Common names like “Vendor Name”, “Mobile”, “GST No” are recognised too.
            </p>

            {reading && <p className="text-sm text-muted">Reading the file…</p>}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}

            {rows && counts && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <FileSpreadsheet className="h-4 w-4 text-brand-600" />
                  <span className="font-medium">{file?.name}</span>
                  <span className="text-muted">· {rows.length} rows</span>
                  <Badge tone="success">{counts.new} new</Badge>
                  {counts.duplicate > 0 && <Badge tone="warning">{counts.duplicate} already exist</Badge>}
                  {counts.error > 0 && <Badge tone="danger">{counts.error} with errors (skipped)</Badge>}
                </div>
                {unknownColumns.length > 0 && <p className="text-xs text-muted">Ignored columns: {unknownColumns.join(", ")}</p>}
                <div className="max-h-72 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr>
                        <th className="th">Row</th>
                        <th className="th">Vendor</th>
                        <th className="th">Email</th>
                        <th className="th">City</th>
                        <th className="th">Categories</th>
                        <th className="th">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.row}>
                          <td className="td text-muted">{r.row}</td>
                          <td className="td font-medium">{r.name || "—"}<div className="font-mono text-[11px] font-normal text-muted">{r.gstin}</div></td>
                          <td className="td">{r.emails.join(", ") || "—"}</td>
                          <td className="td">{r.city || "—"}</td>
                          <td className="td">
                            {r.categories.join(", ") || "—"}
                            {r.unknownCategories.length > 0 && <div className="text-[11px] text-amber-700">Not in category list: {r.unknownCategories.join(", ")}</div>}
                          </td>
                          <td className="td">
                            <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                            {r.errors.map((e) => <div key={e} className="mt-0.5 text-[11px] text-danger">{e}</div>)}
                            {r.duplicateOf && <div className="mt-0.5 text-[11px] text-muted">as {r.duplicateOf}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <Field label="Also add to a project's vendor book (optional)" className="min-w-[240px]">
                    <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                      <option value="">Directory only</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                  <Button onClick={onImport} loading={importing} disabled={!willImport}>
                    Import {willImport} vendor{willImport === 1 ? "" : "s"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
