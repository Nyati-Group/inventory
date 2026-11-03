// Branded HTML emails (inline styles for client compatibility). NYATI blue palette.
import { appUrl } from "../tokens";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#F6F8FB;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FB;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
<tr><td style="background:#ffffff;padding:16px 24px;border-bottom:4px solid #014B85"><img src="${appUrl("/nyati-logo.png")}" alt="NYATI" width="54" height="56" style="display:block;border:0;color:#014B85;font-size:20px;font-weight:700;letter-spacing:3px"></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:18px;color:#112C49">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px">This is an automated message from NYATI Procurement. Please do not reply to this email; use the secure link above.</td></tr>
</table></td></tr></table></body></html>`;
}

export function button(href: string, label: string) {
  return `<p style="margin:24px 0"><a href="${href}" style="background:#014B85;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(label)}</a></p>
<p style="font-size:12px;color:#64748B;word-break:break-all">Or open: ${href}</p>`;
}

export function kv(rows: [string, string][]) {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px;background:#E6EEF5;border:1px solid #E2E8F0;width:40%;color:#112C49;font-weight:600">${esc(k)}</td><td style="padding:8px 12px;border:1px solid #E2E8F0">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

export const p = (t: string) => `<p style="margin:0 0 12px;font-size:14px;line-height:20px">${esc(t)}</p>`;
