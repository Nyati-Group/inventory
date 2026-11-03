"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Field, Input, Textarea, Checkbox } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { saveVendor } from "@/server/actions/vendors";

export interface VendorFormValues {
  id?: string;
  name: string;
  contactPerson?: string | null;
  emails: string[];
  phone?: string | null;
  whatsapp?: string | null;
  gstin?: string | null;
  pan?: string | null;
  address?: string | null;
  city: string;
  state?: string | null;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  serviceRadiusKm: number;
  leadTimeDays: number;
  paymentTerms?: string | null;
  creditDays: number;
  bankName?: string | null;
  bankAccountMasked?: string | null;
  bankIfsc?: string | null;
  categoryIds: string[];
  materialIds: string[];
  isPreferred: boolean;
  notes?: string | null;
}

type F = Record<string, string | boolean | string[]>;

export function VendorForm({
  initial,
  categories,
  materials,
  projectId,
  onSaved,
}: {
  initial?: VendorFormValues;
  categories: { id: string; name: string }[];
  materials: { id: string; name: string; categoryId: string }[];
  projectId?: string;
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const [cats, setCats] = React.useState<Set<string>>(new Set(initial?.categoryIds ?? []));
  const [mats, setMats] = React.useState<Set<string>>(new Set(initial?.materialIds ?? []));
  const { register, handleSubmit, formState } = useForm<F>({
    defaultValues: {
      name: initial?.name ?? "",
      contactPerson: initial?.contactPerson ?? "",
      emails: (initial?.emails ?? []).join(", "),
      phone: initial?.phone ?? "",
      whatsapp: initial?.whatsapp ?? "",
      gstin: initial?.gstin ?? "",
      pan: initial?.pan ?? "",
      address: initial?.address ?? "",
      city: initial?.city ?? "",
      state: initial?.state ?? "",
      pincode: initial?.pincode ?? "",
      lat: initial?.lat?.toString() ?? "",
      lng: initial?.lng?.toString() ?? "",
      serviceRadiusKm: String(initial?.serviceRadiusKm ?? 100),
      leadTimeDays: String(initial?.leadTimeDays ?? 3),
      paymentTerms: initial?.paymentTerms ?? "",
      creditDays: String(initial?.creditDays ?? 0),
      bankName: initial?.bankName ?? "",
      bankAccount: "",
      bankIfsc: initial?.bankIfsc ?? "",
      isPreferred: initial?.isPreferred ?? false,
      notes: initial?.notes ?? "",
    },
  });

  const onSubmit = async (f: F) => {
    const s = (k: string) => (typeof f[k] === "string" ? (f[k] as string).trim() : "") || undefined;
    const r = await saveVendor({
      id: initial?.id,
      projectId,
      name: s("name")!,
      contactPerson: s("contactPerson"),
      emails: String(f.emails).split(/[,;\s]+/).filter(Boolean),
      phone: s("phone"),
      whatsapp: s("whatsapp"),
      gstin: s("gstin")?.toUpperCase() ?? "",
      pan: s("pan")?.toUpperCase(),
      address: s("address"),
      city: s("city")!,
      state: s("state"),
      pincode: s("pincode"),
      lat: s("lat") ? Number(s("lat")) : null,
      lng: s("lng") ? Number(s("lng")) : null,
      serviceRadiusKm: Number(f.serviceRadiusKm),
      leadTimeDays: Number(f.leadTimeDays),
      paymentTerms: s("paymentTerms"),
      creditDays: Number(f.creditDays),
      bankName: s("bankName"),
      bankAccount: s("bankAccount"),
      bankIfsc: s("bankIfsc")?.toUpperCase(),
      categoryIds: [...cats],
      materialIds: [...mats],
      isPreferred: !!f.isPreferred,
      notes: s("notes"),
    });
    if (!r.ok) return toast.error(r.error);
    toast.success(initial?.id ? "Vendor updated" : "Vendor created");
    onSaved?.(r.data.id);
    router.refresh();
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setter(n);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name" className="sm:col-span-2"><Input {...register("name", { required: true })} /></Field>
        <Field label="Contact person"><Input {...register("contactPerson")} /></Field>
        <Field label="Email(s)" hint="Comma-separated; RFQs go to all"><Input {...register("emails", { required: true })} /></Field>
        <Field label="Phone"><Input {...register("phone")} /></Field>
        <Field label="WhatsApp"><Input {...register("whatsapp")} /></Field>
        <Field label="GSTIN"><Input {...register("gstin")} className="uppercase" placeholder="27ABCDE1234F1Z5" /></Field>
        <Field label="PAN"><Input {...register("pan")} className="uppercase" /></Field>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <Field label="Address" className="sm:col-span-3"><Textarea rows={2} {...register("address")} /></Field>
        <Field label="City"><Input {...register("city", { required: true })} /></Field>
        <Field label="State"><Input {...register("state")} /></Field>
        <Field label="PIN code"><Input {...register("pincode")} /></Field>
        <Field label="Latitude" hint="Blank = geocode from address"><Input {...register("lat")} inputMode="decimal" /></Field>
        <Field label="Longitude"><Input {...register("lng")} inputMode="decimal" /></Field>
        <Field label="Service radius (km)"><Input type="number" min="1" {...register("serviceRadiusKm")} /></Field>
        <Field label="Typical lead time (days)"><Input type="number" min="0" {...register("leadTimeDays")} /></Field>
        <Field label="Default payment terms"><Input {...register("paymentTerms")} placeholder="30 days credit" /></Field>
        <Field label="Credit days"><Input type="number" min="0" {...register("creditDays")} /></Field>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <Field label="Bank name"><Input {...register("bankName")} /></Field>
        <Field label="Account number" hint={initial?.bankAccountMasked ? `Stored: ${initial.bankAccountMasked} (leave blank to keep)` : "Stored masked"}><Input {...register("bankAccount")} autoComplete="off" /></Field>
        <Field label="IFSC"><Input {...register("bankIfsc")} className="uppercase" /></Field>
      </section>
      <section>
        <div className="mb-1 text-xs font-semibold text-brand-800">Categories supplied</div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
              <Checkbox checked={cats.has(c.id)} onChange={() => toggle(cats, setCats, c.id)} /> {c.name}
            </label>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-1 text-xs font-semibold text-brand-800">Specific materials supplied</div>
        <div className="scrollbar-thin grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
          {materials
            .filter((m) => !cats.size || cats.has(m.categoryId))
            .map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={mats.has(m.id)} onChange={() => toggle(mats, setMats, m.id)} /> {m.name}
              </label>
            ))}
        </div>
      </section>
      <section className="grid gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" {...register("isPreferred")} /> Preferred vendor</label>
        <Field label="Notes"><Textarea rows={2} {...register("notes")} /></Field>
      </section>
      <div className="flex justify-end">
        <Button type="submit" loading={formState.isSubmitting}>{initial?.id ? "Save vendor" : projectId ? "Create & add to project" : "Create vendor"}</Button>
      </div>
    </form>
  );
}
