import type { Role } from "@prisma/client";
import { db } from "./db";

/** Notify every project member with one of the given roles (admins always included). */
export async function notifyRoles(
  projectId: string,
  roles: Role[],
  n: { type: string; title: string; body?: string; link?: string },
) {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      OR: [{ role: "ADMIN" }, { role: { in: roles }, memberships: { some: { projectId } } }],
    },
    select: { id: true },
  });
  if (!users.length) return;
  await db.notification.createMany({
    data: users.map((u) => ({ userId: u.id, projectId, type: n.type, title: n.title, body: n.body, link: n.link })),
  });
}

export async function notifyUser(userId: string, projectId: string | null, n: { type: string; title: string; body?: string; link?: string }) {
  await db.notification.create({ data: { userId, projectId, ...n } });
}
