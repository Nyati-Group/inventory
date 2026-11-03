"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { VendorForm, type VendorFormValues } from "@/components/vendor-form";
import { setVendorStatus, uploadVendorDocument } from "@/server/actions/vendors";

export function EditVendorButton({ initial, categories, materials }: { initial: VendorFormValues; categories: { id: string; name: string }[]; materials: { id: string; name: string; categoryId: string }[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Edit ${initial.name}`} wide>
          <VendorForm initial={initial} categories={categories} materials={materials} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VendorActions({ vendorId, status }: { vendorId: string; status: string }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<"ACTIVE" | "ON_HOLD" | "BLACKLISTED" | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <>
      <Select value="" onChange={(e) => e.target.value && setTarget(e.target.value as "ACTIVE")} className="w-auto" aria-label="Change status">
        <option value="">Change status…</option>
        {status !== "ACTIVE" && <option value="ACTIVE">Set Active</option>}
        {status !== "ON_HOLD" && <option value="ON_HOLD">Put On hold</option>}
        {status !== "BLACKLISTED" && <option value="BLACKLISTED">Blacklist</option>}
      </Select>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target === "ACTIVE" ? "Re-activate vendor?" : target === "ON_HOLD" ? "Put vendor on hold?" : "Blacklist vendor?"}
        description={target === "BLACKLISTED" ? "Blacklisted vendors cannot be invited to RFQs and are disqualified in comparisons." : "This change is logged in the audit trail."}
        confirmLabel="Confirm"
        danger={target === "BLACKLISTED"}
        loading={pending}
        onConfirm={() =>
          start(async () => {
            const r = await setVendorStatus(vendorId, target!, reason);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Status updated");
            setTarget(null);
            setReason("");
            router.refresh();
          })
        }
      >
        {target !== "ACTIVE" && (
          <Field label="Reason (required)">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </ConfirmDialog>
    </>
  );
}

export function VendorDocsUpload({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Upload className="h-4 w-4" /> Upload</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Upload vendor document">
          <form
            action={(fd) =>
              start(async () => {
                fd.set("vendorId", vendorId);
                const r = await uploadVendorDocument(fd);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Document uploaded");
                setOpen(false);
                router.refresh();
              })
            }
            className="space-y-3"
          >
            <Field label="Type">
              <Select name="type">
                <option>GST certificate</option>
                <option>PAN card</option>
                <option>Trade licence</option>
                <option>Company registration</option>
                <option>Cancelled cheque</option>
                <option>ISO / quality certificate</option>
                <option>Other</option>
              </Select>
            </Field>
            <Field label="File (PDF, image or DOCX, max 10 MB)"><Input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.docx" className="py-1.5" /></Field>
            <div className="flex justify-end"><Button type="submit" loading={pending}>Upload</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
