import PizZip from "pizzip";

/** One vendor row from a bulk-upload file, after header mapping and clean-up. */
export interface VendorImportRow {
  row: number; // 1-based row number in the file (header = row 1)
  name: string;
  contactPerson: string;
  emails: string[];
  phone: string;
  whatsapp: string;
  gstin: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  categories: string[];
  serviceRadiusKm: number | null;
  leadTimeDays: number | null;
  paymentTerms: string;
  creditDays: number | null;
  notes: string;
}

export const VENDOR_TEMPLATE_HEADERS = [
  "name", "contact_person", "email", "phone", "whatsapp", "gstin", "pan", "address", "city", "state", "pincode",
  "categories", "service_radius_km", "lead_time_days", "payment_terms", "credit_days", "notes",
] as const;

type Key = (typeof VENDOR_TEMPLATE_HEADERS)[number];

/** Header spellings people actually use in vendor lists → our field. */
const ALIASES: Record<string, Key> = {
  name: "name", vendor: "name", vendorname: "name", suppliername: "name", supplier: "name", company: "name", companyname: "name", firmname: "name", firm: "name",
  contactperson: "contact_person", contact: "contact_person", contactname: "contact_person", person: "contact_person", owner: "contact_person",
  email: "email", emails: "email", emailid: "email", emailaddress: "email", mail: "email", mailid: "email",
  phone: "phone", mobile: "phone", mobileno: "phone", phoneno: "phone", contactno: "phone", contactnumber: "phone", phonenumber: "phone", mobilenumber: "phone", tel: "phone",
  whatsapp: "whatsapp", whatsappno: "whatsapp", whatsappnumber: "whatsapp",
  gstin: "gstin", gst: "gstin", gstno: "gstin", gstnumber: "gstin", gstinno: "gstin",
  pan: "pan", panno: "pan", pannumber: "pan",
  address: "address", fulladdress: "address", officeaddress: "address",
  city: "city", town: "city", location: "city",
  state: "state",
  pincode: "pincode", pin: "pincode", pinno: "pincode", zip: "pincode", postalcode: "pincode",
  categories: "categories", category: "categories", materialcategory: "categories", materialcategories: "categories", materials: "categories", supplies: "categories",
  serviceradiuskm: "service_radius_km", serviceradius: "service_radius_km", radius: "service_radius_km", radiuskm: "service_radius_km",
  leadtimedays: "lead_time_days", leadtime: "lead_time_days", deliverydays: "lead_time_days",
  paymentterms: "payment_terms", terms: "payment_terms", payment: "payment_terms",
  creditdays: "credit_days", credit: "credit_days", creditperiod: "credit_days",
  notes: "notes", remarks: "notes", remark: "notes", note: "notes",
};

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

/** RFC 4180-ish CSV parser: quoted fields, embedded commas/newlines, "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** First worksheet of an .xlsx as a grid of strings (shared strings, inline strings, numbers). */
export function parseXlsx(buf: Buffer): string[][] {
  const zip = new PizZip(buf);
  const sharedXml = zip.file("xl/sharedStrings.xml")?.asText() ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const wb = zip.file("xl/workbook.xml")?.asText() ?? "";
  const rels = zip.file("xl/_rels/workbook.xml.rels")?.asText() ?? "";
  const firstRid = wb.match(/<sheet[^>]*r:id="([^"]+)"/)?.[1];
  const target = firstRid ? rels.match(new RegExp(`Id="${firstRid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${firstRid}"`))?.[1] : null;
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}` : "xl/worksheets/sheet1.xml";
  const sheet = (zip.file(sheetPath) ?? zip.file("xl/worksheets/sheet1.xml"))?.asText() ?? "";
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const body = c[2] ?? "";
      let v = "";
      if (type === "s") v = shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? "";
      else if (type === "inlineStr") v = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else v = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      cells[ref ? colIndex(ref) : cells.length] = v;
    }
    const filled = Array.from(cells, (x) => x ?? "");
    if (filled.some((x) => x.trim())) rows.push(filled);
  }
  return rows;
}

const intOrNull = (s: string) => {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return s.trim() && Number.isFinite(n) ? Math.round(n) : null;
};
const splitList = (s: string) => s.split(/[;,|/\n]+/).map((x) => x.trim()).filter(Boolean);
const cleanPhone = (s: string) => s.replace(/\.0$/, "").trim(); // Excel stores numbers as 9876543210.0 sometimes

/** Map a grid (header row first) to vendor rows. Returns the rows and any columns we didn't recognise. */
export function gridToVendors(grid: string[][]): { rows: VendorImportRow[]; unknownColumns: string[]; missingRequired: string[] } {
  if (!grid.length) return { rows: [], unknownColumns: [], missingRequired: ["name", "email", "city"] };
  const header = grid[0].map((h) => ALIASES[normHeader(h)] ?? null);
  const unknownColumns = grid[0].filter((h, i) => h.trim() && !header[i]);
  const missingRequired = (["name", "email", "city"] as const).filter((k) => !header.includes(k));
  const rows = grid.slice(1).map((cells, i) => {
    const get = (k: Key) => {
      const idx = header.indexOf(k);
      return idx >= 0 ? String(cells[idx] ?? "").trim() : "";
    };
    return {
      row: i + 2,
      name: get("name"),
      contactPerson: get("contact_person"),
      emails: splitList(get("email")).map((e) => e.toLowerCase()),
      phone: cleanPhone(get("phone")),
      whatsapp: cleanPhone(get("whatsapp")),
      gstin: get("gstin").toUpperCase().replace(/\s/g, ""),
      pan: get("pan").toUpperCase(),
      address: get("address"),
      city: get("city"),
      state: get("state"),
      pincode: get("pincode").replace(/\.0$/, ""),
      categories: splitList(get("categories")),
      serviceRadiusKm: intOrNull(get("service_radius_km")),
      leadTimeDays: intOrNull(get("lead_time_days")),
      paymentTerms: get("payment_terms"),
      creditDays: intOrNull(get("credit_days")),
      notes: get("notes"),
    };
  });
  return { rows, unknownColumns, missingRequired };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

/** Problems that block importing a row. */
export function rowErrors(r: VendorImportRow): string[] {
  const e: string[] = [];
  if (r.name.length < 2) e.push("Name is missing");
  if (!r.emails.length) e.push("Email is missing");
  else if (r.emails.some((x) => !EMAIL.test(x))) e.push(`Invalid email: ${r.emails.find((x) => !EMAIL.test(x))}`);
  if (r.city.length < 2) e.push("City is missing");
  if (r.gstin && !GSTIN.test(r.gstin)) e.push(`Invalid GSTIN: ${r.gstin}`);
  return e;
}
