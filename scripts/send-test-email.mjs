// Check email settings: sends one branded test email through EMAIL_PROVIDER (resend | smtp).
// Usage: npm run test-email -- someone@example.com
// Ignores DEMO_MODE on purpose — this is how you verify delivery before switching demo mode off.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error("Usage: npm run test-email -- someone@example.com");
  process.exit(1);
}
const provider = process.env.EMAIL_PROVIDER ?? "smtp";
const from = process.env.EMAIL_FROM;
if (!from) {
  console.error("Set EMAIL_FROM in .env");
  process.exit(1);
}
const appUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
const vendorBase = (process.env.VENDOR_PORTAL_URL || appUrl).replace(/\/$/, "");
const subject = "NYATI Procurement — test email";
const html = `<!doctype html><html><body style="margin:0;background:#F6F8FB;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FB;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
<tr><td style="background:#ffffff;padding:16px 24px;border-bottom:4px solid #014B85;color:#014B85;font-size:20px;font-weight:700;letter-spacing:3px">NYATI</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:18px;color:#112C49">Email delivery works</h1>
<p style="font-size:14px;line-height:20px">This is a test email from NYATI Procurement, sent via <strong>${provider}</strong> from <strong>${from.replace(/</g, "&lt;")}</strong> at ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.</p>
<p style="font-size:14px;line-height:20px">RFQ invitations, reminders, purchase orders and approval requests will arrive like this. Vendor links will start with:<br><code>${vendorBase}/vendor/…</code></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px">Automated message from NYATI Procurement.</td></tr>
</table></td></tr></table></body></html>`;

try {
  let id;
  if (provider === "resend") {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is empty");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? JSON.stringify(body)}`);
    id = body.id;
  } else {
    const nodemailer = (await import("nodemailer")).default;
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    id = (await t.sendMail({ from, to, subject, html })).messageId;
  }
  console.log(`Sent to ${to} via ${provider} (id ${id}). Check the inbox and the spam folder.`);
} catch (e) {
  console.error(`Email failed: ${e.message}`);
  process.exit(1);
}
