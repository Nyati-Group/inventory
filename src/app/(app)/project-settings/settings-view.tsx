"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { MapPin, Plus, RefreshCw, Trash2, Upload, Ban, Star as StarIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, Badge, Stars } from "@/components/ui/misc";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, ConfirmDialog } from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table";
import { VendorForm } from "@/components/vendor-form";
import { updateProjectProfile, updateProjectSettings, saveApprovalRules } from "@/server/actions/project";
import { addVendorToProject, updateProjectVendor, removeVendorFromProject, recalcDistances, importVendorsCsv } from "@/server/actions/vendors";
import { inr } from "@/lib/utils";

type Project = {
  id: string;
  code: string;
  name: string;
  client: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  siteAddress: string;
  city: string;
  state: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  receivingHours: string | null;
  unloadingConstraints: string | null;
  settings: {
    weightPrice: number;
    weightDelivery: number;
    weightProximity: number;
    weightRating: number;
    weightCommercial: number;
    maxDelayDays: number;
    defaultDeadlineHours: number;
    reminderHoursBefore: number[];
    financeApprovalThreshold: number;
    notifyNotSelected: boolean;
  } | null;
};

type VendorRow = {
  vendorId: string;
  name: string;
  city: string;
  emails: string[];
  gstin: string | null;
  categories: string[];
  distanceKm: number | null;
  distanceSource: string | null;
  etaDays: number;
  serviceRadiusKm: number;
  rating: number | null;
  projectRated: number;
  status: string;
  isPreferred: boolean;
  isBlacklisted: boolean;
  notes: string | null;
};

export function ProjectSettingsView(p: {
  tab: string;
  project: Project;
  canEdit: boolean;
  vendors: VendorRow[];
  directory: { id: string; name: string; city: string }[];
  categories: { id: string; name: string }[];
  materials: { id: string; name: string; categoryId: string }[];
  approvers: { id: string; name: string; role: string }[];
  rules: { userId: string; label: string; minAmount: number }[];
}) {
  return (
    <Tabs defaultValue={p.tab}>
      <TabsList>
        <TabsTrigger value="profile">Project profile</TabsTrigger>
        <TabsTrigger value="approvals">Approvals & scoring</TabsTrigger>
        <TabsTrigger value="vendors">Project vendor book ({p.vendors.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">
        <ProfileForm project={p.project} canEdit={p.canEdit} />
      </TabsContent>
      <TabsContent value="approvals">
        <div className="grid gap-4 xl:grid-cols-2">
          <ScoringForm project={p.project} canEdit={p.canEdit} />
          <ApprovalRules projectId={p.project.id} approvers={p.approvers} rules={p.rules} canEdit={p.canEdit} />
        </div>
      </TabsContent>
      <TabsContent value="vendors">
        <VendorBook {...p} />
      </TabsContent>
    </Tabs>
  );
}

function ProfileForm({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const mapUrl = project.lat && project.lng ? `https://www.openstreetmap.org/?mlat=${project.lat}&mlon=${project.lng}#map=14/${project.lat}/${project.lng}` : null;
  return (
    <form
      action={(fd) =>
        start(async () => {
          const s = (k: string) => (String(fd.get(k) ?? "").trim() || undefined);
          const r = await updateProjectProfile({
            projectId: project.id,
            name: s("name")!,
            client: s("client"),
            status: s("status") as "ACTIVE",
            startDate: s("startDate"),
            endDate: s("endDate"),
            budget: s("budget") ? Number(s("budget")) : null,
            siteAddress: s("siteAddress")!,
            city: s("city")!,
            state: s("state"),
            pincode: s("pincode"),
            lat: s("lat") ? Number(s("lat")) : null,
            lng: s("lng") ? Number(s("lng")) : null,
            siteContactName: s("siteContactName"),
            siteContactPhone: s("siteContactPhone"),
            receivingHours: s("receivingHours"),
            unloadingConstraints: s("unloadingConstraints"),
          });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Project profile saved — vendor distances refreshed");
          router.refresh();
        })
      }
    >
      <fieldset disabled={!canEdit} className="grid gap-4 lg:grid-cols-2">
        <Card title="Project">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project name" className="sm:col-span-2"><Input name="name" defaultValue={project.name} required /></Field>
            <Field label="Code"><Input value={project.code} readOnly className="bg-slate-50" /></Field>
            <Field label="Client"><Input name="client" defaultValue={project.client ?? ""} /></Field>
            <Field label="Status">
              <Select name="status" defaultValue={project.status}>
                {["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
              </Select>
            </Field>
            <Field label="Budget (₹)" hint={project.budget ? inr(project.budget, false) : undefined}><Input name="budget" type="number" min="0" defaultValue={project.budget ?? ""} /></Field>
            <Field label="Start date"><Input name="startDate" type="date" defaultValue={project.startDate?.slice(0, 10) ?? ""} /></Field>
            <Field label="End date"><Input name="endDate" type="date" defaultValue={project.endDate?.slice(0, 10) ?? ""} /></Field>
          </div>
        </Card>
        <Card title="Site & receiving" actions={mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-sm"><MapPin className="h-4 w-4" /> View pin on map</a>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Site address" className="sm:col-span-2"><Textarea name="siteAddress" rows={2} defaultValue={project.siteAddress} required /></Field>
            <Field label="City"><Input name="city" defaultValue={project.city} required /></Field>
            <Field label="State"><Input name="state" defaultValue={project.state ?? ""} /></Field>
            <Field label="Latitude" hint="Clear both to re-geocode from the address"><Input name="lat" defaultValue={project.lat ?? ""} inputMode="decimal" /></Field>
            <Field label="Longitude"><Input name="lng" defaultValue={project.lng ?? ""} inputMode="decimal" /></Field>
            <Field label="PIN code"><Input name="pincode" defaultValue={project.pincode ?? ""} /></Field>
            <div />
            <Field label="Site contact person"><Input name="siteContactName" defaultValue={project.siteContactName ?? ""} /></Field>
            <Field label="Site contact phone"><Input name="siteContactPhone" defaultValue={project.siteContactPhone ?? ""} /></Field>
            <Field label="Receiving hours"><Input name="receivingHours" defaultValue={project.receivingHours ?? ""} /></Field>
            <Field label="Unloading constraints"><Input name="unloadingConstraints" defaultValue={project.unloadingConstraints ?? ""} placeholder="e.g. max 10-wheeler, no night entry" /></Field>
          </div>
        </Card>
        {canEdit && (
          <div className="lg:col-span-2">
            <Button type="submit" loading={pending}>Save profile</Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

const WEIGHTS = [
  ["weightPrice", "Landed price"],
  ["weightDelivery", "Delivery lead time vs need"],
  ["weightProximity", "Proximity / logistics"],
  ["weightRating", "Vendor performance rating"],
  ["weightCommercial", "Commercial terms"],
] as const;

function ScoringForm({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const router = useRouter();
  const s = project.settings!;
  const [w, setW] = React.useState<Record<string, number>>({ weightPrice: s.weightPrice, weightDelivery: s.weightDelivery, weightProximity: s.weightProximity, weightRating: s.weightRating, weightCommercial: s.weightCommercial });
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const [pending, start] = React.useTransition();
  return (
    <Card title="Recommendation scoring & RFQ defaults">
      <form
        action={(fd) =>
          start(async () => {
            const r = await updateProjectSettings({
              projectId: project.id,
              weightPrice: w.weightPrice,
              weightDelivery: w.weightDelivery,
              weightProximity: w.weightProximity,
              weightRating: w.weightRating,
              weightCommercial: w.weightCommercial,
              maxDelayDays: Number(fd.get("maxDelayDays")),
              defaultDeadlineHours: Number(fd.get("defaultDeadlineHours")),
              reminderHoursBefore: String(fd.get("reminders")).split(",").map((x) => Number(x.trim())).filter((x) => x > 0),
              financeApprovalThreshold: Number(fd.get("financeApprovalThreshold")),
              notifyNotSelected: fd.get("notifyNotSelected") === "on",
            });
            if (!r.ok) return void toast.error(r.error);
            toast.success("Settings saved");
            router.refresh();
          })
        }
      >
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="space-y-2">
            {WEIGHTS.map(([k, label]) => (
              <div key={k} className="flex items-center gap-3">
                <label htmlFor={k} className="w-56 text-sm">{label}</label>
                <input id={k} type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="flex-1 accent-brand-600" />
                <Input type="number" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="w-20" aria-label={`${label} weight`} />
              </div>
            ))}
            <p className={sum === 100 ? "text-xs text-success" : "text-xs text-danger"} role="status">Total: {sum} {sum === 100 ? "✓" : "— weights must sum to 100"}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Max acceptable delay (days)" hint="Quotes later than this are disqualified"><Input name="maxDelayDays" type="number" min={0} defaultValue={s.maxDelayDays} /></Field>
            <Field label="Default quotation deadline (hours)"><Input name="defaultDeadlineHours" type="number" min={1} defaultValue={s.defaultDeadlineHours} /></Field>
            <Field label="Reminders (hours before deadline)" hint="Comma-separated, e.g. 24, 3"><Input name="reminders" defaultValue={s.reminderHoursBefore.join(", ")} /></Field>
            <Field label="Finance approval above (₹)"><Input name="financeApprovalThreshold" type="number" min={0} defaultValue={s.financeApprovalThreshold} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notifyNotSelected" defaultChecked={s.notifyNotSelected} className="h-4 w-4 accent-brand-600" /> Send polite "not selected" emails to other vendors</label>
          {canEdit && <Button type="submit" loading={pending} disabled={sum !== 100}>Save scoring & defaults</Button>}
        </fieldset>
      </form>
    </Card>
  );
}

function ApprovalRules({ projectId, approvers, rules, canEdit }: { projectId: string; approvers: { id: string; name: string; role: string }[]; rules: { userId: string; label: string; minAmount: number }[]; canEdit: boolean }) {
  const router = useRouter();
  const [list, setList] = React.useState(rules.length ? rules : [{ userId: approvers[0]?.id ?? "", label: "Project Head", minAmount: 0 }]);
  const [pending, start] = React.useTransition();
  return (
    <Card title="Approvers & approval limits">
      <p className="mb-3 text-sm text-muted">Each level must approve when the order amount is at or above its threshold. Level 1 typically applies to all orders; Finance above ₹5 L.</p>
      <div className="space-y-2">
        {list.map((r, i) => (
          <div key={i} className="grid grid-cols-[40px_1fr_1fr_120px_32px] items-center gap-2">
            <Badge tone="brand">L{i + 1}</Badge>
            <Select value={r.userId} disabled={!canEdit} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))} aria-label="Approver">
              {approvers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Input value={r.label} disabled={!canEdit} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Label" />
            <Input type="number" min={0} value={r.minAmount} disabled={!canEdit} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, minAmount: Number(e.target.value) } : x)))} aria-label="From amount (₹)" />
            {canEdit && list.length > 1 ? (
              <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:text-danger" aria-label="Remove level"><Trash2 className="h-4 w-4" /></button>
            ) : <span />}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setList([...list, { userId: approvers[0]?.id ?? "", label: "Finance", minAmount: 500000 }])}><Plus className="h-4 w-4" /> Add level</Button>
          <Button
            type="button"
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await saveApprovalRules({ projectId, rules: list });
                if (!r.ok) return void toast.error(r.error);
                toast.success("Approval chain saved");
                router.refresh();
              })
            }
          >
            Save approvers
          </Button>
        </div>
      )}
    </Card>
  );
}

function VendorBook(p: Parameters<typeof ProjectSettingsView>[0]) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [csv, setCsv] = React.useState("");
  const [existing, setExisting] = React.useState("");
  const [removing, setRemoving] = React.useState<VendorRow | null>(null);
  const [pending, start] = React.useTransition();
  const projectId = p.project.id;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
      router.refresh();
    });

  const columns: ColumnDef<VendorRow, unknown>[] = [
    {
      accessorKey: "name",
      header: "Vendor",
      cell: ({ row: { original: v } }) => (
        <div className="min-w-[180px]">
          <Link href={`/vendors/${v.vendorId}`} className="link">{v.name}</Link>
          <div className="flex flex-wrap gap-1 text-xs text-muted">
            {v.emails[0]}
            {v.isPreferred && <Badge tone="success">Preferred</Badge>}
            {v.isBlacklisted && <Badge tone="danger">Blacklisted (project)</Badge>}
            {v.status !== "ACTIVE" && <Badge tone={v.status === "ON_HOLD" ? "warning" : "danger"}>{v.status === "ON_HOLD" ? "On hold" : "Blacklisted"}</Badge>}
          </div>
        </div>
      ),
    },
    { accessorKey: "city", header: "City" },
    { id: "cats", header: "Categories", accessorFn: (v) => v.categories.join(", "), cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span> },
    {
      accessorKey: "distanceKm",
      header: "Distance to site",
      cell: ({ row: { original: v } }) => (
        <span className="tabular-nums">
          {v.distanceKm !== null ? `${Math.round(v.distanceKm)} km` : "—"}
          {v.distanceKm !== null && v.distanceKm > v.serviceRadiusKm && <span className="block text-xs text-danger">outside {v.serviceRadiusKm} km radius</span>}
          {v.distanceSource === "HAVERSINE" && <span className="block text-[11px] text-muted">approx. (no maps key)</span>}
        </span>
      ),
    },
    { accessorKey: "etaDays", header: "Est. delivery", cell: ({ getValue }) => `${getValue()} days` },
    { accessorKey: "rating", header: "Rating", cell: ({ row: { original: v } }) => <div><Stars value={v.rating} /><div className="text-[11px] text-muted">{v.projectRated} orders here</div></div> },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row: { original: v } }) =>
        p.canEdit && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" title={v.isPreferred ? "Unmark preferred" : "Mark preferred"} aria-label="Toggle preferred" onClick={() => act(() => updateProjectVendor(projectId, v.vendorId, { isPreferred: !v.isPreferred }), "Updated")}><StarIcon className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" title={v.isBlacklisted ? "Remove project blacklist" : "Blacklist for this project"} aria-label="Toggle blacklist" onClick={() => act(() => updateProjectVendor(projectId, v.vendorId, { isBlacklisted: !v.isBlacklisted }), "Updated")}><Ban className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" title="Remove from project" aria-label="Remove from project" onClick={() => setRemoving(v)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ),
    },
  ];

  return (
    <>
      {p.canEdit && (
        <div className="card mb-3 flex flex-wrap items-end gap-2 p-3">
          <Field label="Add an existing vendor from the directory" className="min-w-[260px] flex-1">
            <Select value={existing} onChange={(e) => setExisting(e.target.value)}>
              <option value="">Choose vendor…</option>
              {p.directory.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.city}</option>)}
            </Select>
          </Field>
          <Button variant="secondary" disabled={!existing || pending} onClick={() => act(() => addVendorToProject(projectId, existing), "Vendor added to project")}>Add</Button>
          <span className="mx-2 h-8 w-px bg-border" />
          <Button variant="secondary" onClick={() => act(() => recalcDistances(projectId), "Distances recalculated")} loading={pending}><RefreshCw className="h-4 w-4" /> Recalculate distances</Button>
          <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import CSV</Button>
          <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New vendor</Button>
        </div>
      )}
      <DataTable data={p.vendors} columns={columns} csvName={`vendor-book-${p.project.code}`} searchPlaceholder="Search vendor book…" emptyTitle="No vendors in this project yet" emptyDescription="Add vendors from the directory, create a new one, or import a CSV." />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New vendor" description={`Will be added to ${p.project.name}'s vendor book with auto-calculated distance.`} wide>
          <VendorForm categories={p.categories} materials={p.materials} projectId={projectId} onSaved={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent title="Import vendors (CSV)" description="Columns: name,contact_person,email,phone,gstin,city,state,address,categories,service_radius_km,lead_time_days,payment_terms,credit_days. Categories separated by ';'. Duplicates (same GSTIN/email) are linked, not re-created.">
          <Input type="file" accept=".csv" className="mb-2 py-1.5" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-xs" />
          <div className="mt-3 flex justify-end">
            <Button
              loading={pending}
              disabled={!csv.trim()}
              onClick={() =>
                start(async () => {
                  const r = await importVendorsCsv(projectId, csv);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`${r.data.created} created, ${r.data.linked} linked${r.data.skipped.length ? ` — ${r.data.skipped.length} duplicates linked to existing` : ""}`);
                  setImporting(false);
                  setCsv("");
                  router.refresh();
                })
              }
            >
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name} from this project?`}
        description="The vendor stays in the global directory and in past RFQs/orders. They will no longer be offered for new RFQs on this project."
        confirmLabel="Remove"
        danger
        loading={pending}
        onConfirm={() => removing && act(async () => { const r = await removeVendorFromProject(projectId, removing.vendorId); setRemoving(null); return r; }, "Removed from project")}
      />
    </>
  );
}
