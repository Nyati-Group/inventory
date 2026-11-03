"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { addMaterial, importMaterialsCsv } from "@/server/actions/procurement";

const UNITS = ["bag", "tonne", "kg", "m3", "cft", "brass", "nos", "litre", "m", "sqm", "coil"];

export function AddMaterialDialog({ open, onOpenChange, projectId, categories }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const { register, handleSubmit, formState, reset } = useForm<Record<string, string>>({ defaultValues: { gstPercent: "18", currentQty: "0", reorderLevel: "0", unit: "nos" } });
  const onSubmit = async (f: Record<string, string>) => {
    const r = await addMaterial({
      projectId,
      code: f.code,
      name: f.name,
      categoryId: f.categoryId,
      unit: f.unit,
      spec: f.spec,
      hsnCode: f.hsnCode,
      gstPercent: Number(f.gstPercent),
      currentQty: Number(f.currentQty),
      reorderLevel: Number(f.reorderLevel),
    });
    if (!r.ok) return toast.error(r.error);
    toast.success("Material added");
    reset();
    onOpenChange(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add material">
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
          <Field label="Material name" className="col-span-2"><Input {...register("name", { required: true })} /></Field>
          <Field label="Code"><Input {...register("code", { required: true })} className="uppercase" /></Field>
          <Field label="Category">
            <Select {...register("categoryId", { required: true })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Unit">
            <Select {...register("unit")}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select>
          </Field>
          <Field label="GST %"><Input type="number" step="any" {...register("gstPercent")} /></Field>
          <Field label="Specification / grade" className="col-span-2"><Input {...register("spec")} /></Field>
          <Field label="HSN code"><Input {...register("hsnCode")} /></Field>
          <div />
          <Field label="Opening stock"><Input type="number" step="any" min="0" {...register("currentQty")} /></Field>
          <Field label="Reorder level"><Input type="number" step="any" min="0" {...register("reorderLevel")} /></Field>
          <div className="col-span-2 flex justify-end"><Button type="submit" loading={formState.isSubmitting}>Add material</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ImportCsvDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string }) {
  const router = useRouter();
  const [csv, setCsv] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Import materials (CSV)" description="Columns: code,name,category,unit,spec,gst_percent,current_qty,reorder_level. Existing codes update their reorder level.">
        <div className="space-y-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setCsv(await f.text());
            }}
            className="py-1.5"
          />
          <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} placeholder={"code,name,category,unit,spec,gst_percent,current_qty,reorder_level\nCEM-WHITE,White Cement,Cement,bag,40 kg,28,50,20"} className="font-mono text-xs" />
          <div className="flex justify-end">
            <Button
              loading={pending}
              disabled={!csv.trim()}
              onClick={() =>
                start(async () => {
                  const r = await importMaterialsCsv(projectId, csv);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`Imported: ${r.data.created} new, ${r.data.updated} updated`);
                  setCsv("");
                  onOpenChange(false);
                  router.refresh();
                })
              }
            >
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
