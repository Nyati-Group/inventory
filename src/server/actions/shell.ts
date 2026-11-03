"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, notDeleted, unset } from "@/lib/db";
import { getUser, requireRole } from "@/lib/auth";
import { PROJECT_COOKIE, assertProjectAccess } from "@/lib/project-context";
import { audit } from "@/lib/audit";
import { geocode } from "@/lib/geo";
import { run } from "../action-result";

export async function selectProject(projectId: string) {
  return run(async () => {
    const user = await getUser();
    if (!user) throw new Error("Not signed in");
    await assertProjectAccess(user, projectId);
    cookies().set(PROJECT_COOKIE, projectId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await db.user.update({ where: { id: user.id }, data: { lastProjectId: projectId } });
    revalidatePath("/", "layout");
    return undefined;
  });
}

export async function markNotificationsRead() {
  return run(async () => {
    const user = await getUser();
    if (!user) throw new Error("Not signed in");
    await db.notification.updateMany({ where: { userId: user.id, readAt: unset }, data: { readAt: new Date() } });
    revalidatePath("/", "layout");
    return undefined;
  });
}

const NewProject = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(10).regex(/^[A-Z0-9]+$/, "Use capital letters and digits only"),
  client: z.string().optional(),
  siteAddress: z.string().min(5),
  city: z.string().min(2),
  state: z.string().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export async function createProject(input: z.infer<typeof NewProject>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = NewProject.parse(input);
    let lat = d.lat;
    let lng = d.lng;
    if (lat === undefined || lng === undefined) {
      const g = await geocode(`${d.siteAddress}, ${d.city}`);
      lat = g?.lat;
      lng = g?.lng;
    }
    const project = await db.project.create({
      data: {
        name: d.name,
        code: d.code,
        client: d.client,
        siteAddress: d.siteAddress,
        city: d.city,
        state: d.state,
        lat,
        lng,
        settings: { create: {} },
        members: { create: { userId: user.id } },
      },
    });
    // Admins and the creator see it; seed every material with zero stock so the procurement table is ready.
    const materials = await db.material.findMany({ where: { deletedAt: notDeleted }, select: { id: true } });
    await db.materialProjectStock.createMany({ data: materials.map((m) => ({ projectId: project.id, materialId: m.id })) });
    await audit(user, "Project", project.id, "CREATED", { after: d, projectId: project.id });
    cookies().set(PROJECT_COOKIE, project.id, { httpOnly: true, sameSite: "lax", path: "/" });
    revalidatePath("/", "layout");
    return { id: project.id };
  });
}
