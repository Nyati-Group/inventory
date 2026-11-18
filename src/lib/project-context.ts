import { cache } from "react";
import { cookies } from "next/headers";
import { db, notDeleted } from "./db";
import type { SessionUser } from "./auth";

export const PROJECT_COOKIE = "nyati_project";

/** Projects the user can see: admins see all, others see projects they are members of. Cached per request. */
const projectsFor = cache((userId: string, isAdmin: boolean) =>
  db.project.findMany({
    where: {
      deletedAt: notDeleted,
      ...(isAdmin ? {} : { members: { some: { userId } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, city: true, status: true },
  }),
);

export async function accessibleProjects(user: SessionUser) {
  return projectsFor(user.id, user.role === "ADMIN");
}

/**
 * The selected project (cookie → user's last project → first accessible).
 * Cached per request: the layout and the page both need it, so it's looked up once per navigation.
 */
const currentProjectFor = cache(async (userId: string, isAdmin: boolean, cookieId: string | undefined) => {
  const projects = await projectsFor(userId, isAdmin);
  if (!projects.length) return { project: null, projects };
  let pick = projects.find((p) => p.id === cookieId);
  if (!pick) {
    const dbUser = await db.user.findUnique({ where: { id: userId }, select: { lastProjectId: true } });
    pick = projects.find((p) => p.id === dbUser?.lastProjectId) ?? projects[0];
  }
  const project = await db.project.findUnique({ where: { id: pick.id }, include: { settings: true } });
  return { project, projects };
});

export async function currentProject(user: SessionUser) {
  return currentProjectFor(user.id, user.role === "ADMIN", cookies().get(PROJECT_COOKIE)?.value);
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
