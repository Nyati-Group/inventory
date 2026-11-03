import { db } from "../db";
import { storage } from "../storage";
import { getSettings } from "../settings";

export interface EmailAttachment {
  name: string;
  key: string; // storage key
  contentType: string;
}

export interface OutgoingEmail {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/** Provider interface — swap implementations via EMAIL_PROVIDER. */
export interface EmailService {
  name: string;
  send(msg: OutgoingEmail): Promise<{ id?: string }>;
}

class SmtpEmailService implements EmailService {
  name = "smtp";
  async send(msg: OutgoingEmail) {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    const info = await t.sendMail({
      from: process.env.EMAIL_FROM,
      to: msg.to.join(","),
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments,
    });
    return { id: info.messageId };
  }
}

class ResendEmailService implements EmailService {
  name = "resend";
  async send(msg: OutgoingEmail) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { id?: string };
    return { id: j.id };
  }
}

export function emailService(): EmailService {
  return process.env.EMAIL_PROVIDER === "resend" ? new ResendEmailService() : new SmtpEmailService();
}

/**
 * Queue an email. Idempotent: the same idempotencyKey is never queued twice.
 * In demo mode the email is stored as DEMO and shown in the in-app outbox instead of being sent.
 */
export async function queueEmail(e: {
  idempotencyKey: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  relatedType?: string;
  relatedId?: string;
  projectId?: string;
}) {
  const existing = await db.emailLog.findUnique({ where: { idempotencyKey: e.idempotencyKey } });
  if (existing) return existing;
  const { demoMode } = await getSettings();
  const log = await db.emailLog.create({
    data: {
      idempotencyKey: e.idempotencyKey,
      to: e.to,
      subject: e.subject,
      html: e.html,
      text: e.text,
      attachments: (e.attachments ?? []) as never,
      relatedType: e.relatedType,
      relatedId: e.relatedId,
      projectId: e.projectId,
      status: demoMode ? "DEMO" : "QUEUED",
      provider: demoMode ? "demo" : emailService().name,
      sentAt: demoMode ? new Date() : null,
    },
  });
  if (!demoMode) await deliver(log.id).catch(() => undefined); // first attempt inline; retries via job runner
  return log;
}

const BACKOFF_MIN = [1, 5, 15, 60, 240];

/** Attempt delivery of one queued email, with exponential back-off on failure. */
export async function deliver(id: string) {
  const log = await db.emailLog.findUnique({ where: { id } });
  if (!log || (log.status !== "QUEUED" && log.status !== "FAILED")) return;
  if (log.attempts >= BACKOFF_MIN.length) return;
  try {
    const atts = (log.attachments as unknown as EmailAttachment[]) ?? [];
    const attachments = await Promise.all(
      atts.map(async (a) => ({ filename: a.name, content: await storage.get(a.key), contentType: a.contentType })),
    );
    const svc = emailService();
    const r = await svc.send({ to: log.to, subject: log.subject, html: log.html, text: log.text ?? undefined, attachments });
    await db.emailLog.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), providerId: r.id, attempts: { increment: 1 }, error: null },
    });
    await onEmailSent(log.relatedType, log.relatedId);
  } catch (err) {
    const attempts = log.attempts + 1;
    await db.emailLog.update({
      where: { id },
      data: {
        status: "FAILED",
        attempts,
        error: (err as Error).message.slice(0, 1000),
        nextAttemptAt: new Date(Date.now() + (BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)] ?? 60) * 60_000),
      },
    });
    if (log.relatedType === "RFQVendor" && log.relatedId)
      await db.rFQVendor.updateMany({ where: { id: log.relatedId, status: "QUEUED" }, data: { status: "FAILED" } });
    throw err;
  }
}

async function onEmailSent(relatedType: string | null, relatedId: string | null) {
  if (relatedType === "RFQVendor" && relatedId)
    await db.rFQVendor.updateMany({
      where: { id: relatedId, status: { in: ["QUEUED", "FAILED"] } },
      data: { status: "SENT", sentAt: new Date() },
    });
}

/** Retry failed/queued emails whose back-off has elapsed. */
export async function processEmailQueue() {
  const due = await db.emailLog.findMany({
    where: { status: { in: ["QUEUED", "FAILED"] }, nextAttemptAt: { lte: new Date() }, attempts: { lt: BACKOFF_MIN.length } },
    take: 25,
  });
  for (const e of due) await deliver(e.id).catch(() => undefined);
  return due.length;
}
