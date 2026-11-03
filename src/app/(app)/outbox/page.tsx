import { requireUser } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { db, unset } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui/misc";
import { OutboxView } from "./outbox-view";

export const metadata = { title: "Demo Outbox" };

export default async function OutboxPage() {
  const user = await requireUser();
  const { project } = await currentProject(user);
  const { demoMode } = await getSettings();
  const emails = await db.emailLog.findMany({
    where: user.role === "ADMIN" ? {} : { OR: [{ projectId: project?.id }, { projectId: null }, { projectId: unset }] },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return (
    <div>
      <PageHeader
        title={demoMode ? "Demo Outbox" : "Email log"}
        description={demoMode ? "Demo mode is on: nothing is actually sent. Open any vendor email and click its link to act as the vendor." : "Every email with delivery status, attempts and errors. Failed emails retry automatically with back-off."}
      />
      <OutboxView
        emails={emails.map((e) => ({
          id: e.id,
          to: e.to.join(", "),
          subject: e.subject,
          html: e.html,
          status: e.status,
          attempts: e.attempts,
          error: e.error,
          createdAt: e.createdAt.toISOString(),
          links: [...e.html.matchAll(/href="(https?:\/\/[^"]+\/vendor\/[^"]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i),
          attachments: ((e.attachments as { name: string }[]) ?? []).map((a) => a.name),
        }))}
      />
    </div>
  );
}
