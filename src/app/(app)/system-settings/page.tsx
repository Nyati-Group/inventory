import { redirect } from "next/navigation";
import { requireUser, ROLE_LABEL } from "@/lib/auth";
import { db, notDeleted } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { signedUrl } from "@/lib/storage";
import { RFQ_PLACEHOLDERS } from "@/lib/pdf";
import { numOrNull } from "@/lib/utils";
import { llmAvailable, LLM_MODEL } from "@/lib/llm";
import { vendorPortalBase, portalUrlIsLocal } from "@/lib/vendor-links";
import { PageHeader } from "@/components/ui/misc";
import { SystemSettingsView } from "./system-view";

export const metadata = { title: "System Settings" };

export default async function SystemSettingsPage({ searchParams }: { searchParams: { tab?: string; q?: string } }) {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/procurement");
  const [settings, templates, users, projects, auditRows] = await Promise.all([
    getSettings(),
    db.rFQTemplate.findMany({ orderBy: { version: "desc" }, include: { _count: { select: { rfqs: true } } } }),
    db.user.findMany({ where: { deletedAt: notDeleted }, include: { memberships: { select: { projectId: true } } }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: { deletedAt: notDeleted }, select: { id: true, name: true, code: true } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const providers = {
    email: settings.demoMode ? "Demo outbox (no emails sent)" : `${process.env.EMAIL_PROVIDER ?? "smtp"} (${process.env.EMAIL_FROM ?? "EMAIL_FROM not set"})`,
    llm: llmAvailable() ? `Google Gemini (${LLM_MODEL})` : "Not configured (GEMINI_API_KEY) — rule-based extraction",
    vendorLinks: `${vendorPortalBase()}/vendor/…${portalUrlIsLocal() ? " — LOCAL ADDRESS, vendors can't open it" : ""}`,
    database: process.env.MONGODB_URI ? `MongoDB (${process.env.MONGODB_DB ?? "db from URI"})` : "MONGODB_URI not set",
    maps: process.env.MAPS_PROVIDER ?? "haversine",
    market: process.env.MARKET_RATE_PROVIDER ?? "demo",
    storage: process.env.STORAGE_DRIVER ?? "local",
  };
  return (
    <div>
      <PageHeader title="System Settings" description="RFQ template, rating weights, email & demo mode, users and the audit log." />
      <SystemSettingsView
        tab={searchParams.tab ?? "template"}
        settings={settings}
        providers={providers}
        placeholders={RFQ_PLACEHOLDERS}
        templates={templates.map((t) => ({ id: t.id, version: t.version, name: t.name, kind: t.kind, isActive: t.isActive, terms: t.terms, createdAt: t.createdAt.toISOString(), rfqs: t._count.rfqs, fileUrl: t.fileKey ? signedUrl(t.fileKey, 3600, `rfq-template-v${t.version}.docx`) : null }))}
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, roleLabel: ROLE_LABEL[u.role], approvalLimit: numOrNull(u.approvalLimit), isActive: u.isActive, projectIds: u.memberships.map((m) => m.projectId) }))}
        projects={projects}
        audit={auditRows.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), actor: a.actorLabel, entity: a.entityType, entityId: a.entityId, action: a.action, before: a.before ? JSON.stringify(a.before) : "", after: a.after ? JSON.stringify(a.after) : "", ip: a.ip }))}
        currentUserId={user.id}
      />
    </div>
  );
}
