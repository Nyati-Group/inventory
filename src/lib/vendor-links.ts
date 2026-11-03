// Links shared with vendors (RFQ quotation portal + PO accept/dispatch page).
//
// A vendor link is:  <VENDOR_PORTAL_URL>/vendor/rfq/<token>   or   <VENDOR_PORTAL_URL>/vendor/po/<token>
//  - token: 32 random bytes (base64url). Only its SHA-256 hash is used for lookup; an AES-GCM copy
//    (keyed from NEXTAUTH_SECRET) lets reminders re-send the same link.
//  - one link = one vendor + one RFQ (or one PO); no login needed; rate-limited; unknown tokens reveal nothing.
//  - RFQ links stop accepting quotations at the deadline and expire VENDOR_LINK_GRACE_HOURS after it.
//  - PO links expire VENDOR_PO_LINK_DAYS after the PO is sent.
//
// Env:
//   VENDOR_PORTAL_URL        public https origin vendors can reach (defaults to APP_URL, then NEXTAUTH_URL)
//   VENDOR_LINK_GRACE_HOURS  default 24
//   VENDOR_PO_LINK_DAYS      default 120

const DEFAULT_GRACE_HOURS = 24;
const DEFAULT_PO_DAYS = 120;

function positive(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function vendorPortalBase() {
  return (process.env.VENDOR_PORTAL_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export const rfqVendorLink = (token: string) => `${vendorPortalBase()}/vendor/rfq/${token}`;
export const poVendorLink = (token: string) => `${vendorPortalBase()}/vendor/po/${token}`;

/** When an RFQ link stops working (it stops accepting quotes at the deadline itself). */
export function rfqLinkExpiry(deadline: Date) {
  return new Date(deadline.getTime() + positive(process.env.VENDOR_LINK_GRACE_HOURS, DEFAULT_GRACE_HOURS) * 3600_000);
}

export function poLinkExpiry(from = new Date()) {
  return new Date(from.getTime() + positive(process.env.VENDOR_PO_LINK_DAYS, DEFAULT_PO_DAYS) * 86_400_000);
}

/** True when the configured base URL can't be opened by an outside vendor. */
export function portalUrlIsLocal() {
  return /\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.)/.test(vendorPortalBase());
}

/** wa.me share link; Indian 10-digit numbers get the 91 country code. */
export function whatsappShareUrl(phone: string | null | undefined, text: string) {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
