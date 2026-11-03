import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Prisma } from "@prisma/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TIMEZONE = "Asia/Kolkata";
export const CURRENCY = "INR";

/** Number from Prisma Decimal / string / number / null. */
export function num(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

export function numOrNull(v: Prisma.Decimal | number | string | null | undefined): number | null {
  return v === null || v === undefined ? null : num(v);
}

/** Recursively convert Prisma Decimals (and Dates → ISO) so data can cross the server→client boundary. */
export function plain<T>(value: T): Plain<T> {
  return walk(value) as Plain<T>;
}
function walk(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Prisma.Decimal.isDecimal(v)) return Number((v as Prisma.Decimal).toString());
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(walk);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
    return out;
  }
  return v;
}
export type Plain<T> = T extends Prisma.Decimal
  ? number
  : T extends Date
    ? string
    : T extends Array<infer U>
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: CURRENCY, maximumFractionDigits: 2 });
const inrFmt0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });

export function inr(v: number | null | undefined, decimals = true) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return (decimals ? inrFmt : inrFmt0).format(v);
}

/** ₹ 3.1 L / ₹ 1.2 Cr style compact amounts (Indian numbering). */
export function inrCompact(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return inr(v, false);
}

export function qty(v: number | null | undefined, unit?: string | null) {
  if (v === null || v === undefined) return "—";
  const s = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(v);
  return unit ? `${s} ${unit}` : s;
}

export function pct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TIMEZONE, day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(v: Date | string | null | undefined) {
  if (!v) return "—";
  return dateFmt.format(typeof v === "string" ? new Date(v) : v);
}
export function fmtDateTime(v: Date | string | null | undefined) {
  if (!v) return "—";
  return dateTimeFmt.format(typeof v === "string" ? new Date(v) : v);
}

export function daysBetween(a: Date | string, b: Date | string) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

export function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
