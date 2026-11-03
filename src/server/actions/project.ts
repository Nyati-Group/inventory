"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/project-context";
import { audit } from "@/lib/audit";
import { geocode } from "@/lib/geo";
import { run } from "../action-result";
import { recalcDistances } from "./vendors";

const Profile = z.object({
  projectId: z.string(),
  name: z.string().min(2),
  client: z.string().optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: z.number().min(0).optional().nullable(),
  siteAddress: z.string().min(5),
  city: z.string().min(2),
  state: z.string().optional(),
  pincode: z.string().optional(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  siteContactName: z.string().optional(),
  siteContactPhone: z.string().optional(),
  receivingHours: z.string().optional(),
  unloadingConstraints: z.string().optional(),
});

export async function updateProjectProfile(input: z.infer<typeof Profile>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = Profile.parse(input);
    await assertProjectAccess(user, d.projectId);
    const before = await db.project.findUniqueOrThrow({ where: { id: d.projectId } });
    let { lat, lng } = d;
    const addressChanged = before.siteAddress !== d.siteAddress || before.city !== d.city;
    if ((lat === null || lat === undefined || lng === null || lng === undefined) || (addressChanged && lat === before.lat && lng === before.lng)) {
      const g = await geocode(`${d.siteAddress}, ${d.city}`);
      if (g) ({ lat, lng } = g);
    }
    const { projectId, startDate, endDate, ...rest } = d;
    const after = await db.project.update({
      where: { id: projectId },
      data: { ...rest, lat, lng, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null },
    });
    if (after.lat !== before.lat || after.lng !== before.lng) await recalcDistances(projectId);
    await audit(user, "Project", projectId, "PROFILE_UPDATED", { before, after: d, projectId });
    revalidatePath("/", "layout");
    return { geocoded: lat !== d.lat };
  });
}

const Settings = z
  .object({
    projectId: z.string(),
    weightPrice: z.number().int().min(0).max(100),
    weightDelivery: z.number().int().min(0).max(100),
    weightProximity: z.number().int().min(0).max(100),
    weightRating: z.number().int().min(0).max(100),
    weightCommercial: z.number().int().min(0).max(100),
    maxDelayDays: z.number().int().min(0).max(60),
    defaultDeadlineHours: z.number().int().min(1).max(720),
    reminderHoursBefore: z.array(z.number().int().min(1).max(720)).max(5),
    financeApprovalThreshold: z.number().min(0),
    notifyNotSelected: z.boolean(),
  })
  .refine((s) => s.weightPrice + s.weightDelivery + s.weightProximity + s.weightRating + s.weightCommercial === 100, { message: "Scoring weights must sum to 100" });

export async function updateProjectSettings(input: z.infer<typeof Settings>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = Settings.parse(input);
    await assertProjectAccess(user, d.projectId);
    const { projectId, ...data } = d;
    const before = await db.projectSettings.findUnique({ where: { projectId } });
    await db.projectSettings.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await audit(user, "ProjectSettings", projectId, "UPDATED", { before, after: data, projectId });
    revalidatePath("/project-settings");
    return undefined;
  });
}

/** What-if sliders → "Save as project default". */
export async function saveProjectWeights(projectId: string, w: { price: number; delivery: number; proximity: number; rating: number; commercial: number }) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    await assertProjectAccess(user, projectId);
    const vals = [w.price, w.delivery, w.proximity, w.rating, w.commercial].map((x) => Math.round(x));
    if (vals.some((x) => x < 0) || vals.reduce((a, b) => a + b, 0) !== 100) throw new Error("Weights must be whole numbers summing to 100");
    const data = { weightPrice: vals[0], weightDelivery: vals[1], weightProximity: vals[2], weightRating: vals[3], weightCommercial: vals[4] };
    await db.projectSettings.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await audit(user, "ProjectSettings", projectId, "WEIGHTS_UPDATED", { after: data, projectId });
    revalidatePath("/rfqs");
    return undefined;
  });
}

const Rules = z.object({
  projectId: z.string(),
  rules: z.array(z.object({ userId: z.string(), label: z.string().min(2), minAmount: z.number().min(0) })).min(1, "At least one approver is required"),
});

export async function saveApprovalRules(input: z.infer<typeof Rules>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = Rules.parse(input);
    await assertProjectAccess(user, d.projectId);
    const approvers = await db.user.findMany({ where: { id: { in: d.rules.map((r) => r.userId) } } });
    if (approvers.some((a) => a.role !== "APPROVER" && a.role !== "ADMIN")) throw new Error("Only users with the Approver or Admin role can approve");
    await db.$transaction([
      db.approvalRule.deleteMany({ where: { projectId: d.projectId } }),
      ...d.rules.map((r, i) => db.approvalRule.create({ data: { projectId: d.projectId, userId: r.userId, level: i + 1, label: r.label, minAmount: r.minAmount } })),
      ...d.rules.map((r) => db.projectMember.upsert({ where: { projectId_userId: { projectId: d.projectId, userId: r.userId } }, create: { projectId: d.projectId, userId: r.userId }, update: {} })),
    ]);
    await audit(user, "ApprovalRule", d.projectId, "UPDATED", { after: d.rules, projectId: d.projectId });
    revalidatePath("/project-settings");
    return undefined;
  });
}
