"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { setSetting, getSettings } from "@/lib/settings";
import { saveFile, validateUpload, guessMime } from "@/lib/storage";
import { fillDocxTemplate, RFQ_PLACEHOLDERS } from "@/lib/pdf";
import { deliver, queueEmail } from "@/lib/email/service";
import { layout, p } from "@/lib/email/templates";
import { run } from "../action-result";

/** Upload a new .docx RFQ template (or new terms for the built-in one). Keeps history; the new version becomes active. */
export async function saveRfqTemplate(fd: FormData) {
  return run(async () => {
    const user = await requireRole("ADMIN");
    const name = String(fd.get("name") ?? "").trim() || "RFQ template";
    const terms = String(fd.get("terms") ?? "").trim();
    if (terms.length < 10) throw new Error("Terms & conditions are required");
    const file = fd.get("file");
    let fileKey: string | null = null;
    if (file instanceof File && file.size) {
      const mime = file.type || guessMime(file.name);
      const err = validateUpload({ size: file.size, type: mime, name: file.name }, "template");
      if (err) throw new Error(err);
      const buf = Buffer.from(await file.arrayBuffer());
      try {
        fillDocxTemplate(buf, Object.fromEntries(RFQ_PLACEHOLDERS.map((k) => [k, "test"]))); // validate placeholders parse
      } catch (e) {
        throw new Error(`Template could not be parsed — check {{placeholder}} syntax (${(e as Error).message})`);
      }
      fileKey = await saveFile("templates", file.name, buf, mime);
    }
    const last = await db.rFQTemplate.findFirst({ orderBy: { version: "desc" } });
    const t = await db.$transaction(async (tx) => {
      await tx.rFQTemplate.updateMany({ data: { isActive: false } });
      return tx.rFQTemplate.create({ data: { version: (last?.version ?? 0) + 1, name, kind: fileKey ? "DOCX" : "BUILTIN", fileKey, terms, isActive: true, createdById: user.id } });
    });
    await audit(user, "RFQTemplate", t.id, "NEW_VERSION", { after: { version: t.version, kind: t.kind, name } });
    revalidatePath("/system-settings");
    return { version: t.version };
  });
}

export async function activateTemplate(id: string) {
  return run(async () => {
    const user = await requireRole("ADMIN");
    await db.$transaction([db.rFQTemplate.updateMany({ data: { isActive: false } }), db.rFQTemplate.update({ where: { id }, data: { isActive: true } })]);
    await audit(user, "RFQTemplate", id, "ACTIVATED");
    revalidatePath("/system-settings");
    return undefined;
  });
}

const General = z.object({
  demoMode: z.boolean(),
  notifyNotSelected: z.boolean(),
  companyName: z.string().min(2),
  poTerms: z.string().min(10),
});

export async function saveGeneralSettings(input: z.infer<typeof General>) {
  return run(async () => {
    const user = await requireRole("ADMIN");
    const d = General.parse(input);
    const before = await getSettings();
    for (const [k, v] of Object.entries(d)) await setSetting(k as keyof typeof d, v as never);
    await audit(user, "SystemSetting", "general", "UPDATED", { before: { demoMode: before.demoMode, notifyNotSelected: before.notifyNotSelected, companyName: before.companyName }, after: d });
    revalidatePath("/", "layout");
    return undefined;
  });
}

const RW = z
  .object({ PRICE: z.number().int().min(0), DELIVERY: z.number().int().min(0), QUALITY: z.number().int().min(0), RESPONSIVENESS: z.number().int().min(0), COMPLIANCE: z.number().int().min(0) })
  .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) === 100, "Rating weights must sum to 100");

export async function saveRatingWeights(input: z.infer<typeof RW>) {
  return run(async () => {
    const user = await requireRole("ADMIN");
    const d = RW.parse(input);
    const before = (await getSettings()).ratingWeights;
    await setSetting("ratingWeights", d);
    await audit(user, "SystemSetting", "ratingWeights", "UPDATED", { before, after: d });
    revalidatePath("/system-settings");
    return undefined;
  });
}

export async function sendTestEmail(to: string) {
  return run(async () => {
    const user = await requireRole("ADMIN");
    const email = z.string().email().parse(to);
    const log = await queueEmail({ idempotencyKey: `test:${Date.now()}`, to: [email], subject: "NYATI Procurement — test email", html: layout("Test email", p(`Sent by ${user.name}. If you can read this, email delivery works.`)) });
    return { status: log.status };
  });
}

export async function retryEmail(id: string) {
  return run(async () => {
    await requireRole("ADMIN", "PROCUREMENT_MANAGER");
    await db.emailLog.update({ where: { id }, data: { attempts: 0, status: "QUEUED", nextAttemptAt: new Date() } });
    await deliver(id).catch(() => undefined);
    revalidatePath("/outbox");
    return undefined;
  });
}

const UserInput = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["ADMIN", "PROCUREMENT_MANAGER", "APPROVER", "SITE_ENGINEER"]),
  approvalLimit: z.number().min(0).nullable(),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
  projectIds: z.array(z.string()),
  isActive: z.boolean(),
});

export async function saveUser(input: z.infer<typeof UserInput>) {
  return run(async () => {
    const admin = await requireRole("ADMIN");
    const d = UserInput.parse(input);
    if (!d.id && !d.password) throw new Error("Set an initial password");
    if (d.id === admin.id && (!d.isActive || d.role !== "ADMIN")) throw new Error("You cannot demote or deactivate yourself");
    const data = { name: d.name, email: d.email.toLowerCase(), role: d.role, approvalLimit: d.approvalLimit, isActive: d.isActive, ...(d.password ? { passwordHash: await bcrypt.hash(d.password, 10) } : {}) };
    const before = d.id ? await db.user.findUnique({ where: { id: d.id }, select: { role: true, isActive: true, email: true } }) : null;
    const u = d.id ? await db.user.update({ where: { id: d.id }, data }) : await db.user.create({ data: data as typeof data & { passwordHash: string } });
    await db.projectMember.deleteMany({ where: { userId: u.id, projectId: { notIn: d.projectIds } } });
    for (const projectId of d.projectIds) await db.projectMember.upsert({ where: { projectId_userId: { projectId, userId: u.id } }, create: { projectId, userId: u.id }, update: {} });
    await audit(admin, "User", u.id, d.id ? "UPDATED" : "CREATED", { before, after: { ...data, passwordHash: undefined, projects: d.projectIds } });
    revalidatePath("/system-settings");
    return { id: u.id };
  });
}
