import { cookies } from "next/headers";
import { db, notDeleted } from "./db";
import type { SessionUser } from "./auth";

export const PROJECT_COOKIE = "nyati_project";

/** Projects the user can see: admins see all, others see projects they are members of. */
export async function accessibleProjects(user: SessionUser) {
  return db.project.findMany({
    where: {
      deletedAt: notDeleted,
      ...(user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, city: true, status: true },
  });
}

/** The selected project (cookie → user's last project → first accessible). */
export async function currentProject(user: SessionUser) {
  const projects = await accessibleProjects(user);
  if (!projects.length) return { project: null, projects };
  const cookieId = cookies().get(PROJECT_COOKIE)?.value;
  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { lastProjectId: true } });
  const pick =
    projects.find((p) => p.id === cookieId) ?? projects.find((p) => p.id === dbUser?.lastProjectId) ?? projects[0];
  const project = await db.project.findUnique({ where: { id: pick.id }, include: { settings: true } });
  return { project, projects };
}

export async function requireProject(user: SessionUser) {
  const { project } = await currentProject(user);
  if (!project) throw new Error("No project available. Create a project first.");
  return project;
}

/** Throws unless the user may access the given project. */
export async function assertProjectAccess(user: SessionUser, projectId: string) {
  if (user.role === "ADMIN") return;
  const m = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  if (!m) throw new Error("You are not a member of this project");
}
