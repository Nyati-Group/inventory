import { requireUser, ROLE_LABEL, can } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ project, projects }, notifications, settings] = await Promise.all([
    currentProject(user),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    getSettings(),
  ]);
  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role, roleLabel: ROLE_LABEL[user.role] }}
      projects={projects.map((p) => ({ id: p.id, code: p.code, name: p.name, city: p.city }))}
      currentProjectId={project?.id ?? null}
      notifications={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null }))}
      demoMode={settings.demoMode}
      canCreateProject={can(user, "manageProject")}
    >
      {children}
    </AppShell>
  );
}
