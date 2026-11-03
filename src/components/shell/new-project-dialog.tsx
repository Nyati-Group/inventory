"use client";

import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { createProject } from "@/server/actions/shell";

type Form = { name: string; code: string; client?: string; siteAddress: string; city: string; state?: string; lat?: string; lng?: string };

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { register, handleSubmit, formState, reset } = useForm<Form>();
  const onSubmit = async (f: Form) => {
    const r = await createProject({ ...f, code: f.code.toUpperCase(), lat: f.lat ? Number(f.lat) : undefined, lng: f.lng ? Number(f.lng) : undefined });
    if (!r.ok) return toast.error(r.error);
    toast.success("Project created");
    reset();
    onOpenChange(false);
    router.push("/project-settings");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New project" description="Site address is used for vendor distance and delivery planning.">
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
          <Field label="Project name" className="col-span-2"><Input {...register("name", { required: true })} /></Field>
          <Field label="Code" hint="e.g. PNQ2"><Input {...register("code", { required: true })} className="uppercase" /></Field>
          <Field label="Client"><Input {...register("client")} /></Field>
          <Field label="Site address" className="col-span-2"><Textarea {...register("siteAddress", { required: true })} rows={2} /></Field>
          <Field label="City"><Input {...register("city", { required: true })} /></Field>
          <Field label="State"><Input {...register("state")} /></Field>
          <Field label="Latitude" hint="Optional — auto-geocoded if blank"><Input {...register("lat")} inputMode="decimal" /></Field>
          <Field label="Longitude"><Input {...register("lng")} inputMode="decimal" /></Field>
          <div className="col-span-2 flex justify-end">
            <Button type="submit" loading={formState.isSubmitting}>Create project</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
