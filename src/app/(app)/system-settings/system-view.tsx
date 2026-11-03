"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { FileText, Plus, Mail } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table";
import { saveRfqTemplate, activateTemplate, saveGeneralSettings, saveRatingWeights, sendTestEmail, saveUser } from "@/server/actions/admin";
import { POINTER_LABELS, POINTER_ORDER } from "@/components/rating-widgets";
import { fmtDateTime } from "@/lib/utils";

type Template = { id: string; version: number; name: string; kind: string; isActive: boolean; terms: string; createdAt: string; rfqs: number; fileUrl: string | null };
type User = { id: string; name: string; email: string; role: string; roleLabel: string; approvalLimit: number | null; isActive: boolean; projectIds: string[] };
type Audit = { id: string; at: string; actor: string; entity: string; entityId: string; action: string; before: string; after: string; ip: string | null };

export function SystemSettingsView(p: {
  tab: string;
  settings: { demoMode: boolean; notifyNotSelected: boolean; companyName: string; poTerms: string; ratingWeights: Record<string, number> };
  providers: Record<string, string>;
  placeholders: string[];
  templates: Template[];
  users: User[];
  projects: { id: string; name: string; code: string }[];
  audit: Audit[];
  currentUserId: string;
}) {
  return (
    <Tabs defaultValue={p.tab}>
      <TabsList>
        <TabsTrigger value="template">RFQ template</TabsTrigger>
        <TabsTrigger value="rating">Rating weights</TabsTrigger>
        <TabsTrigger value="general">Email & general</TabsTrigger>
        <TabsTrigger value="users">Users ({p.users.length})</TabsTrigger>
        <TabsTrigger value="audit">Audit log</TabsTrigger>
      </TabsList>
      <TabsContent value="template"><TemplateTab {...p} /></TabsContent>
      <TabsContent value="rating"><RatingTab weights={p.settings.ratingWeights} /></TabsContent>
      <TabsContent value="general"><GeneralTab settings={p.settings} providers={p.providers} /></TabsContent>
      <TabsContent value="users"><UsersTab users={p.users} projects={p.projects} /></TabsContent>
      <TabsContent value="audit"><AuditTab rows={p.audit} /></TabsContent>
    </Tabs>
  );
}

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return {
    pending,
    act: (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) return void toast.error(r.error);
        toast.success(msg);
        after?.();
        router.refresh();
      }),
  };
}

function TemplateTab({ templates, placeholders }: { templates: Template[]; placeholders: string[] }) {
  const { pending, act } = useAct();
  const active = templates.find((t) => t.isActive);
  const [replace, setReplace] = React.useState(false);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card
        title={`Active template: v${active?.version} — ${active?.name}`}
        actions={
          <>
            {active?.fileUrl && <Button size="sm" variant="secondary" asChild><a href={active.fileUrl}><FileText className="h-4 w-4" /> Download .docx</a></Button>}
            <Button size="sm" onClick={() => setReplace(true)}><Plus className="h-4 w-4" /> Replace template</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          {active?.kind === "DOCX"
            ? "Uploaded Word template: each RFQ fills the placeholders, attaches the .docx, and renders a NYATI-branded PDF with the same data and terms."
            : "Built-in NYATI-branded template (logo, header, requirement table, terms, signature block)."}
        </p>
        <div className="mb-2 text-xs font-semibold text-brand-800">Terms & conditions</div>
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{active?.terms}</pre>
        <p className="mt-3 text-xs text-muted">Live preview with sample data: open any material → RFQ → “Preview RFQ PDF”.</p>
        <h3 className="mb-2 mt-5 text-sm font-semibold">Version history</h3>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Version</th><th className="th">Name</th><th className="th">Type</th><th className="th">Created</th><th className="th">RFQs</th><th className="th" /></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td className="td">v{t.version} {t.isActive && <Badge tone="success">active</Badge>}</td>
                <td className="td">{t.name}</td>
                <td className="td">{t.kind === "DOCX" ? "Word upload" : "Built-in"}</td>
                <td className="td text-xs">{fmtDateTime(t.createdAt)}</td>
                <td className="td">{t.rfqs}</td>
                <td className="td">{!t.isActive && <Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => activateTemplate(t.id), `v${t.version} activated`)}>Activate</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Available placeholders">
        <p className="mb-2 text-xs text-muted">Use these in your Word file exactly as shown:</p>
        <ul className="space-y-1">{placeholders.map((x) => <li key={x}><code className="rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-800">{`{{${x}}}`}</code></li>)}</ul>
      </Card>
      <Dialog open={replace} onOpenChange={setReplace}>
        <DialogContent title="New RFQ template version" description="Previous versions are kept; every RFQ records the template version it used.">
          <form action={(fd) => act(() => saveRfqTemplate(fd), "New template version active", () => setReplace(false))} className="space-y-3">
            <Field label="Name"><Input name="name" defaultValue={active?.name} required /></Field>
            <Field label="Word template (.docx)" hint="Optional — leave empty to keep the built-in layout and only change the terms."><Input name="file" type="file" accept=".docx" className="py-1.5" /></Field>
            <Field label="Terms & conditions"><Textarea name="terms" rows={7} defaultValue={active?.terms} required /></Field>
            <div className="flex justify-end"><Button type="submit" loading={pending}>Save as v{(templates[0]?.version ?? 0) + 1}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RatingTab({ weights }: { weights: Record<string, number> }) {
  const { pending, act } = useAct();
  const [w, setW] = React.useState(weights);
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  return (
    <Card title="Vendor rating — 5 pointers">
      <p className="mb-4 text-sm text-muted">Applied to ratings computed after saving. Stars = score ÷ 20. Overall rating is a rolling average with exponential decay (recent orders weigh more).</p>
      <div className="max-w-xl space-y-3">
        {POINTER_ORDER.map((k) => (
          <div key={k} className="flex items-center gap-3">
            <label htmlFor={`rw-${k}`} className="w-72 text-sm">{POINTER_LABELS[k]}</label>
            <input id={`rw-${k}`} type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="flex-1 accent-brand-600" />
            <Input type="number" value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="w-20" aria-label={`${POINTER_LABELS[k]} weight`} />
          </div>
        ))}
        <p className={sum === 100 ? "text-xs text-success" : "text-xs text-danger"}>Total {sum}{sum === 100 ? " ✓" : " — must equal 100"}</p>
        <Button disabled={sum !== 100} loading={pending} onClick={() => act(() => saveRatingWeights(w as never), "Rating weights saved")}>Save weights</Button>
      </div>
    </Card>
  );
}

function GeneralTab({ settings, providers }: { settings: { demoMode: boolean; notifyNotSelected: boolean; companyName: string; poTerms: string }; providers: Record<string, string> }) {
  const { pending, act } = useAct();
  const [s, setS] = React.useState(settings);
  const [testTo, setTestTo] = React.useState("");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="General">
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={s.demoMode} onChange={(e) => setS({ ...s, demoMode: e.target.checked })} /> <span><strong>Demo mode</strong> — emails are not sent; they appear in the Demo Outbox with working vendor links.</span></label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={s.notifyNotSelected} onChange={(e) => setS({ ...s, notifyNotSelected: e.target.checked })} /> Send “not selected” emails (global switch; projects can also opt out)</label>
          <Field label="Company name on documents"><Input value={s.companyName} onChange={(e) => setS({ ...s, companyName: e.target.value })} /></Field>
          <Field label="Purchase order terms & conditions"><Textarea rows={6} value={s.poTerms} onChange={(e) => setS({ ...s, poTerms: e.target.value })} /></Field>
          <Button loading={pending} onClick={() => act(() => saveGeneralSettings(s), "Settings saved")}>Save</Button>
        </div>
      </Card>
      <Card title="Integrations (configured via environment variables)">
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Email</dt><dd>{providers.email}</dd>
          <dt className="text-muted">Quotation extraction</dt><dd>{providers.llm}</dd>
          <dt className="text-muted">Maps / distance</dt><dd>{providers.maps}</dd>
          <dt className="text-muted">Market rates</dt><dd>{providers.market}</dd>
          <dt className="text-muted">File storage</dt><dd>{providers.storage}</dd>
          <dt className="text-muted">Database</dt><dd>{providers.database}</dd>
          <dt className="text-muted">Vendor links</dt><dd className="break-all">{providers.vendorLinks}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">See README → “Swapping providers”. External failures degrade gracefully (haversine distance, rule-based extraction, cached market rates, email retries).</p>
        <div className="mt-4 flex items-end gap-2">
          <Field label="Send a test email to" className="flex-1"><Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field>
          <Button variant="secondary" disabled={!testTo} loading={pending} onClick={() => act(() => sendTestEmail(testTo), settings.demoMode ? "Queued to demo outbox" : "Test email sent")}><Mail className="h-4 w-4" /> Send</Button>
        </div>
      </Card>
    </div>
  );
}

function UsersTab({ users, projects }: { users: User[]; projects: { id: string; name: string; code: string }[] }) {
  const [editing, setEditing] = React.useState<User | "new" | null>(null);
  const cols: ColumnDef<User, unknown>[] = [
    { accessorKey: "name", header: "Name" },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "roleLabel", header: "Role" },
    { accessorKey: "approvalLimit", header: "Approval limit", cell: ({ getValue }) => ((getValue() as number | null) ? `₹${(getValue() as number).toLocaleString("en-IN")}` : "—") },
    { id: "projects", header: "Projects", accessorFn: (u) => u.projectIds.map((id) => projects.find((p) => p.id === id)?.code).join(", ") },
    { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <Badge tone={getValue() ? "success" : "neutral"}>{getValue() ? "Active" : "Inactive"}</Badge> },
    { id: "act", header: "", cell: ({ row: { original: u } }) => <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button> },
  ];
  return (
    <>
      <DataTable data={users} columns={cols} csvName="users" toolbar={<Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New user</Button>} />
      <UserDialog user={editing} projects={projects} onClose={() => setEditing(null)} />
    </>
  );
}

function UserDialog({ user, projects, onClose }: { user: User | "new" | null; projects: { id: string; name: string; code: string }[]; onClose: () => void }) {
  const { pending, act } = useAct();
  const u = user === "new" ? null : user;
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  React.useEffect(() => setSel(new Set(u?.projectIds ?? projects.map((p) => p.id))), [user, u?.projectIds, projects]);
  if (!user) return null;
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={u ? `Edit ${u.name}` : "New user"}>
        <form
          action={(fd) =>
            act(
              () => saveUser({ id: u?.id, name: String(fd.get("name")), email: String(fd.get("email")), role: String(fd.get("role")) as "ADMIN", approvalLimit: fd.get("approvalLimit") ? Number(fd.get("approvalLimit")) : null, password: String(fd.get("password") ?? ""), projectIds: [...sel], isActive: fd.get("isActive") === "on" }),
              "User saved",
              onClose,
            )
          }
          className="grid grid-cols-2 gap-3"
        >
          <Field label="Name"><Input name="name" defaultValue={u?.name} required /></Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={u?.email} required /></Field>
          <Field label="Role">
            <Select name="role" defaultValue={u?.role ?? "PROCUREMENT_MANAGER"}>
              <option value="ADMIN">Admin</option><option value="PROCUREMENT_MANAGER">Procurement Manager</option><option value="APPROVER">Approver</option><option value="SITE_ENGINEER">Site / Store Engineer</option>
            </Select>
          </Field>
          <Field label="Approval limit (₹)" hint="Informational for approvers"><Input name="approvalLimit" type="number" min="0" defaultValue={u?.approvalLimit ?? ""} /></Field>
          <Field label={u ? "Reset password (optional)" : "Initial password"} className="col-span-2"><Input name="password" type="password" autoComplete="new-password" minLength={8} required={!u} /></Field>
          <div className="col-span-2">
            <div className="mb-1 text-xs font-semibold text-brand-800">Projects</div>
            <div className="flex flex-wrap gap-2">{projects.map((p) => <label key={p.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm"><Checkbox checked={sel.has(p.id)} onChange={() => { const n = new Set(sel); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setSel(n); }} />{p.code}</label>)}</div>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={u?.isActive ?? true} className="h-4 w-4 accent-brand-600" /> Active</label>
          <div className="col-span-2 flex justify-end"><Button type="submit" loading={pending}>Save user</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AuditTab({ rows }: { rows: Audit[] }) {
  const [entity, setEntity] = React.useState("");
  const entities = [...new Set(rows.map((r) => r.entity))].sort();
  const cols: ColumnDef<Audit, unknown>[] = [
    { accessorKey: "at", header: "When", cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{fmtDateTime(getValue() as string)}</span> },
    { accessorKey: "actor", header: "Who" },
    { accessorKey: "action", header: "What", cell: ({ getValue }) => (getValue() as string).replace(/_/g, " ").toLowerCase() },
    { accessorKey: "entity", header: "Entity", cell: ({ row: { original: a } }) => <span className="text-xs">{a.entity} <span className="text-muted">{a.entityId.slice(-6)}</span></span> },
    { accessorKey: "before", header: "Old", cell: ({ getValue }) => <code className="block max-w-xs truncate text-[11px] text-muted" title={getValue() as string}>{getValue() as string}</code> },
    { accessorKey: "after", header: "New", cell: ({ getValue }) => <code className="block max-w-xs truncate text-[11px]" title={getValue() as string}>{getValue() as string}</code> },
    { accessorKey: "ip", header: "IP", cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) ?? ""}</span> },
  ];
  return (
    <DataTable
      data={rows.filter((r) => !entity || r.entity === entity)}
      columns={cols}
      csvName="audit-log"
      pageSize={25}
      filters={<Select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-auto" aria-label="Entity"><option value="">All entities</option>{entities.map((e) => <option key={e}>{e}</option>)}</Select>}
    />
  );
}
