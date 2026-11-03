// Seed: 1 company, 3 projects (Pune, Bengaluru, Navi Mumbai), 25 materials, 12 vendors, 12 months of
// purchase history, completed orders with 5-pointer ratings, 2 live RFQs with quotations (text / PDF / DOCX)
// and one accepted PO in transit (ready for a GRN).
// Run: npm run db:seed   (uses Node's built-in TypeScript type stripping — keep this file erasable-syntax only)

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import PizZip from "pizzip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { computeRating, rollingRating } from "../src/lib/engine/rating.ts";
import { approxRoadKm, transitHoursFor } from "../src/lib/engine/geo.ts";
import { newToken, hashToken, encrypt } from "../src/lib/tokens.ts";
import { mongoUrl } from "../src/lib/mongo-url.ts";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const datasourceUrl = mongoUrl();
if (!datasourceUrl) throw new Error("Set MONGODB_URI and MONGODB_DB in .env");
const db = new PrismaClient({ datasourceUrl });
const APP_URL = (process.env.VENDOR_PORTAL_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const DAY = 86_400_000;
// --keep: add sample data without deleting anything; existing users keep their passwords.
const KEEP = process.argv.includes("--keep");
const now = new Date();

// deterministic RNG
let seed = 20261103;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const r2 = (n: number) => Math.round(n * 100) / 100;
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

async function saveUpload(prefix: string, name: string, data: Buffer) {
  const key = `${prefix}/${crypto.randomUUID()}-${name}`;
  const full = path.resolve(".data/uploads", key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return key;
}

async function textPdf(lines: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  let y = 800;
  for (const l of lines) {
    page.drawText(l, { x: 50, y, size: l === lines[0] ? 16 : 11, font });
    y -= l === lines[0] ? 28 : 18;
  }
  return Buffer.from(await pdf.save());
}

function textDocx(lines: string[]) {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines
      .map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

// ───────────────────────── reference data ─────────────────────────

const CATEGORIES = ["Cement", "Steel", "Sand & Aggregates", "Masonry", "Ready-Mix Concrete", "Paint & Finishes", "Electrical", "Plumbing", "Waterproofing", "Shuttering"];

const MATERIALS: { code: string; name: string; cat: string; unit: string; spec: string; rate: number; gst: number; hsn: string }[] = [
  { code: "CEM-OPC53", name: "OPC 53 Grade Cement", cat: "Cement", unit: "bag", spec: "IS 269, 50 kg bag", rate: 385, gst: 28, hsn: "2523" },
  { code: "CEM-PPC", name: "PPC Cement", cat: "Cement", unit: "bag", spec: "IS 1489, 50 kg bag", rate: 360, gst: 28, hsn: "2523" },
  { code: "STL-TMT08", name: "TMT Bar Fe500D 8 mm", cat: "Steel", unit: "tonne", spec: "IS 1786 Fe500D", rate: 58500, gst: 18, hsn: "7214" },
  { code: "STL-TMT12", name: "TMT Bar Fe500D 12 mm", cat: "Steel", unit: "tonne", spec: "IS 1786 Fe500D", rate: 56800, gst: 18, hsn: "7214" },
  { code: "STL-TMT16", name: "TMT Bar Fe500D 16 mm", cat: "Steel", unit: "tonne", spec: "IS 1786 Fe500D", rate: 56200, gst: 18, hsn: "7214" },
  { code: "STL-BW18", name: "Binding Wire 18 SWG", cat: "Steel", unit: "kg", spec: "Annealed GI", rate: 86, gst: 18, hsn: "7217" },
  { code: "AGG-MSAND", name: "M-Sand (Manufactured Sand)", cat: "Sand & Aggregates", unit: "m3", spec: "Zone II, IS 383", rate: 1450, gst: 5, hsn: "2505" },
  { code: "AGG-RSAND", name: "River Sand", cat: "Sand & Aggregates", unit: "m3", spec: "Washed, Zone II", rate: 2250, gst: 5, hsn: "2505" },
  { code: "AGG-20MM", name: "Coarse Aggregate 20 mm", cat: "Sand & Aggregates", unit: "m3", spec: "Crushed basalt, IS 383", rate: 1320, gst: 5, hsn: "2517" },
  { code: "AGG-10MM", name: "Coarse Aggregate 10 mm", cat: "Sand & Aggregates", unit: "m3", spec: "Crushed basalt, IS 383", rate: 1380, gst: 5, hsn: "2517" },
  { code: "MAS-REDBRK", name: "Red Clay Bricks", cat: "Masonry", unit: "nos", spec: "Class A, 230x110x75", rate: 9.2, gst: 12, hsn: "6901" },
  { code: "MAS-AAC150", name: "AAC Blocks 600x200x150", cat: "Masonry", unit: "m3", spec: "IS 2185 Part 3", rate: 4250, gst: 12, hsn: "6810" },
  { code: "MAS-FLYASH", name: "Fly Ash Bricks", cat: "Masonry", unit: "nos", spec: "IS 12894, 230x110x75", rate: 6.6, gst: 12, hsn: "6815" },
  { code: "RMC-M25", name: "Ready Mix Concrete M25", cat: "Ready-Mix Concrete", unit: "m3", spec: "Pumpable, 20 mm agg.", rate: 5250, gst: 18, hsn: "3824" },
  { code: "RMC-M30", name: "Ready Mix Concrete M30", cat: "Ready-Mix Concrete", unit: "m3", spec: "Pumpable, 20 mm agg.", rate: 5650, gst: 18, hsn: "3824" },
  { code: "PNT-INTEMU", name: "Interior Acrylic Emulsion", cat: "Paint & Finishes", unit: "litre", spec: "Premium, washable", rate: 285, gst: 18, hsn: "3209" },
  { code: "PNT-EXTEMU", name: "Exterior Acrylic Emulsion", cat: "Paint & Finishes", unit: "litre", spec: "Weatherproof", rate: 345, gst: 18, hsn: "3209" },
  { code: "PNT-PUTTY", name: "Wall Putty", cat: "Paint & Finishes", unit: "kg", spec: "White cement based", rate: 22, gst: 18, hsn: "3214" },
  { code: "ELE-FRW25", name: "FR Copper Wire 2.5 sq mm", cat: "Electrical", unit: "coil", spec: "FRLS, 90 m coil", rate: 2150, gst: 18, hsn: "8544" },
  { code: "ELE-FRW40", name: "FR Copper Wire 4 sq mm", cat: "Electrical", unit: "coil", spec: "FRLS, 90 m coil", rate: 3350, gst: 18, hsn: "8544" },
  { code: "ELE-CND25", name: "PVC Conduit 25 mm", cat: "Electrical", unit: "nos", spec: "Heavy gauge, 3 m length", rate: 96, gst: 18, hsn: "3917" },
  { code: "ELE-MCB32", name: "MCB 32A Single Pole", cat: "Electrical", unit: "nos", spec: "C-curve, 10 kA", rate: 215, gst: 18, hsn: "8536" },
  { code: "PLB-CPVC25", name: "CPVC Pipe 1 inch", cat: "Plumbing", unit: "m", spec: "SDR 11", rate: 190, gst: 18, hsn: "3917" },
  { code: "WPF-COMP", name: "Integral Waterproofing Compound", cat: "Waterproofing", unit: "kg", spec: "Liquid admixture", rate: 165, gst: 18, hsn: "3824" },
  { code: "SHT-PLY12", name: "Shuttering Plywood 12 mm", cat: "Shuttering", unit: "nos", spec: "8x4 ft, film faced", rate: 1680, gst: 18, hsn: "4412" },
];

// Sample sites — addresses and coordinates are placeholders; update them in Project Settings.
const PROJECTS = [
  { code: "ELN", name: "Nyati Elenor", client: "Nyati Group", city: "Pune", state: "Maharashtra", siteAddress: "Sample site address, Baner–Balewadi Road, Baner, Pune 411045", lat: 18.559, lng: 73.7868, budget: 1_150_000_000, contact: ["Rahul Deshmukh", "+91 98220 11223"] },
  { code: "EMB", name: "Nyati Emblem", client: "Nyati Group", city: "Pune", state: "Maharashtra", siteAddress: "Sample site address, Kharadi–Mundhwa Road, Kharadi, Pune 411014", lat: 18.5515, lng: 73.9348, budget: 1_400_000_000, contact: ["Sameer Patil", "+91 98670 33445"] },
];

type V = { name: string; contact: string; city: string; state: string; lat: number; lng: number; cats: string[]; radius: number; lead: number; terms: string; credit: number; quality: number; punctual: number; price: number; gstin: string };
const VENDORS: V[] = [
  { name: "Shree Ganesh Building Materials", contact: "Amit Joshi", city: "Pune", state: "Maharashtra", lat: 18.5793, lng: 73.9089, cats: ["Cement", "Sand & Aggregates", "Masonry"], radius: 80, lead: 1, terms: "30 days credit", credit: 30, quality: 0.95, punctual: 0.95, price: 1.0, gstin: "27AAGFS1234K1Z2" },
  { name: "Deccan Steel Traders", contact: "Prakash Kulkarni", city: "Pimpri", state: "Maharashtra", lat: 18.6298, lng: 73.7997, cats: ["Steel"], radius: 200, lead: 2, terms: "15 days credit", credit: 15, quality: 0.9, punctual: 0.85, price: 0.99, gstin: "27AADCD5678L1Z9" },
  { name: "Sahyadri Cement Depot", contact: "Neha Pawar", city: "Chakan", state: "Maharashtra", lat: 18.7606, lng: 73.8636, cats: ["Cement"], radius: 120, lead: 2, terms: "Against delivery", credit: 0, quality: 0.85, punctual: 0.75, price: 0.97, gstin: "27AAHFS9012M1Z4" },
  { name: "Pune Ready Mix Concrete", contact: "Vikram Shinde", city: "Hinjewadi", state: "Maharashtra", lat: 18.5913, lng: 73.7389, cats: ["Ready-Mix Concrete"], radius: 40, lead: 1, terms: "45 days credit", credit: 45, quality: 0.92, punctual: 0.9, price: 1.02, gstin: "27AAECP3456N1Z1" },
  { name: "Mahalaxmi Electricals", contact: "Sunil Mehta", city: "Pune", state: "Maharashtra", lat: 18.5167, lng: 73.8562, cats: ["Electrical", "Plumbing"], radius: 150, lead: 3, terms: "30 days credit", credit: 30, quality: 0.88, punctual: 0.8, price: 1.0, gstin: "27AAJFM7890P1Z6" },
  { name: "Konkan Aggregates & Sand Co.", contact: "Rajesh Mhatre", city: "Panvel", state: "Maharashtra", lat: 18.9894, lng: 73.1175, cats: ["Sand & Aggregates", "Masonry", "Cement"], radius: 160, lead: 2, terms: "15 days credit", credit: 15, quality: 0.8, punctual: 0.7, price: 0.95, gstin: "27AAKFK2345Q1Z3" },
  { name: "Mumbai Metro Steel", contact: "Farhan Shaikh", city: "Bhiwandi", state: "Maharashtra", lat: 19.2813, lng: 73.0483, cats: ["Steel", "Shuttering"], radius: 250, lead: 3, terms: "30 days credit", credit: 30, quality: 0.86, punctual: 0.82, price: 0.98, gstin: "27AALCM6789R1Z8" },
  { name: "Asian Coatings Distributors", contact: "Pooja Nair", city: "Thane", state: "Maharashtra", lat: 19.2183, lng: 72.9781, cats: ["Paint & Finishes", "Waterproofing"], radius: 300, lead: 2, terms: "30 days credit", credit: 30, quality: 0.93, punctual: 0.92, price: 1.01, gstin: "27AAMFA0123S1Z5" },
  { name: "Whitefield Cement & Steel Mart", contact: "Manjunath Reddy", city: "Bengaluru", state: "Karnataka", lat: 12.9784, lng: 77.7108, cats: ["Cement", "Steel"], radius: 100, lead: 1, terms: "21 days credit", credit: 21, quality: 0.9, punctual: 0.9, price: 1.0, gstin: "29AANFW4567T1Z2" },
  { name: "Karnataka TMT Corporation", contact: "Suresh Rao", city: "Tumkur", state: "Karnataka", lat: 13.3379, lng: 77.1173, cats: ["Steel"], radius: 250, lead: 3, terms: "Advance 50%, balance on delivery", credit: 0, quality: 0.82, punctual: 0.72, price: 0.96, gstin: "29AAPCK8901U1Z7" },
  { name: "Hosur Bricks & Blocks", contact: "Lakshmi Narayan", city: "Hosur", state: "Tamil Nadu", lat: 12.7409, lng: 77.8253, cats: ["Masonry", "Sand & Aggregates"], radius: 90, lead: 2, terms: "15 days credit", credit: 15, quality: 0.84, punctual: 0.86, price: 0.97, gstin: "33AAQFH2345V1Z4" },
  { name: "Bangalore RMC Solutions", contact: "Arun Prasad", city: "Bengaluru", state: "Karnataka", lat: 13.0358, lng: 77.597, cats: ["Ready-Mix Concrete", "Waterproofing", "Electrical"], radius: 60, lead: 1, terms: "30 days credit", credit: 30, quality: 0.91, punctual: 0.88, price: 1.03, gstin: "29AARCB6789W1Z9" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function main() {
  const existing = await db.project.findMany({ where: { code: { in: PROJECTS.map((p) => p.code) } }, select: { code: true } });
  if (KEEP && existing.length) {
    console.log(`Sample projects already exist (${existing.map((e) => e.code).join(", ")}) — nothing to do.`);
    return;
  }
  if (!KEEP) {
  console.log("Clearing existing data…");
  // Empty every collection but keep the indexes created by `prisma db push`.
  const listed = (await db.$runCommandRaw({ listCollections: 1, nameOnly: true })) as { cursor: { firstBatch: { name: string }[] } };
  for (const { name } of listed.cursor.firstBatch) {
    if (name.startsWith("system.")) continue;
    await db.$runCommandRaw({ delete: name, deletes: [{ q: {}, limit: 0 }] });
  }
  fs.rmSync(path.resolve(".data/uploads"), { recursive: true, force: true });
  }

  console.log("Company, users, settings…");
  if (!(await db.company.findFirst())) await db.company.create({ data: { name: "NYATI", legalName: "Nyati Engineers & Consultants Pvt. Ltd.", address: "Nyati Unitree, Yerwada, Pune 411006", gstin: "27AAACN1234A1Z5", pan: "AAACN1234A", email: "procurement@nyati.example", phone: "+91 20 6600 1000" } });
  const hash = await bcrypt.hash("nyati123", 10);
  const users = {
    admin: await db.user.upsert({ where: { email: "admin@nyati.in" }, create: { name: "Anita Kapoor", email: "admin@nyati.in", passwordHash: hash, role: "ADMIN" }, update: {} }),
    buyer: await db.user.upsert({ where: { email: "buyer@nyati.in" }, create: { name: "Rohan Mehta", email: "buyer@nyati.in", passwordHash: hash, role: "PROCUREMENT_MANAGER" }, update: {} }),
    approver: await db.user.upsert({ where: { email: "approver@nyati.in" }, create: { name: "Vivek Nyati", email: "approver@nyati.in", passwordHash: hash, role: "APPROVER", approvalLimit: 500000 }, update: {} }),
    finance: await db.user.upsert({ where: { email: "finance@nyati.in" }, create: { name: "Sneha Iyer", email: "finance@nyati.in", passwordHash: hash, role: "APPROVER" }, update: {} }),
    site: await db.user.upsert({ where: { email: "site@nyati.in" }, create: { name: "Ganesh Patil", email: "site@nyati.in", passwordHash: hash, role: "SITE_ENGINEER" }, update: {} }),
  };
  await db.systemSetting.upsert({ where: { key: "demoMode" }, create: { key: "demoMode", value: true }, update: {} });
  if (!(await db.rFQTemplate.findFirst())) await db.rFQTemplate.create({
    data: {
      version: 1,
      name: "NYATI default RFQ (built-in)",
      kind: "BUILTIN",
      isActive: true,
      createdById: users.admin.id,
      terms: [
        "1. Prices must be inclusive of all charges up to the delivery address unless stated separately.",
        "2. GST to be shown separately with HSN code and GSTIN.",
        "3. Material must conform to the specified grade/IS code; test certificates to accompany each lot.",
        "4. Delivery within site receiving hours only; unloading constraints as communicated.",
        "5. NYATI reserves the right to accept or reject any quotation in full or in part.",
      ].join("\n"),
    },
  });

  console.log("Categories & materials…");
  const cats = new Map<string, string>();
  for (const c of CATEGORIES) cats.set(c, (await db.materialCategory.upsert({ where: { name: c }, create: { name: c }, update: {} })).id);
  const mats = new Map<string, { id: string; m: (typeof MATERIALS)[number] }>();
  for (const m of MATERIALS) {
    const row = await db.material.upsert({ where: { code: m.code }, create: { code: m.code, name: m.name, categoryId: cats.get(m.cat)!, unit: m.unit, spec: m.spec, gstPercent: m.gst, hsnCode: m.hsn }, update: {} });
    mats.set(m.code, { id: row.id, m });
  }

  console.log("Projects…");
  const projects: { id: string; p: (typeof PROJECTS)[number] }[] = [];
  for (const p of PROJECTS) {
    const row = await db.project.create({
      data: {
        code: p.code,
        name: p.name,
        client: p.client,
        status: "ACTIVE",
        startDate: daysAgo(420),
        endDate: new Date(now.getTime() + 600 * DAY),
        budget: p.budget,
        siteAddress: p.siteAddress,
        city: p.city,
        state: p.state,
        pincode: p.siteAddress.match(/\d{6}/)?.[0],
        lat: p.lat,
        lng: p.lng,
        siteContactName: p.contact[0],
        siteContactPhone: p.contact[1],
        receivingHours: "08:00–19:00, Mon–Sat",
        unloadingConstraints: "Max 10-wheeler truck; no entry 22:00–06:00",
        settings: { create: { reminderHoursBefore: [24, 3], financeApprovalThreshold: 500000 } },
        members: { create: Object.values(users).map((u) => ({ userId: u.id })) },
        approvalRules: {
          create: [
            { userId: users.approver.id, level: 1, label: "Project Head", minAmount: 0 },
            { userId: users.finance.id, level: 2, label: "Finance", minAmount: 500000 },
          ],
        },
      },
    });
    projects.push({ id: row.id, p });
  }

  console.log("Vendors & project vendor books…");
  const vendors: { id: string; v: V }[] = [];
  for (const v of VENDORS) {
    const vendorMats = MATERIALS.filter((m) => v.cats.includes(m.cat));
    const row = (await db.vendor.findFirst({ where: { gstin: v.gstin } })) ?? await db.vendor.create({
      data: {
        name: v.name,
        contactPerson: v.contact,
        emails: [`sales@${slug(v.name).slice(0, 18)}.example`],
        phone: `+91 9${Math.floor(100000000 + rand() * 899999999)}`,
        gstin: v.gstin,
        pan: v.gstin.slice(2, 12),
        address: `${v.city} industrial area`,
        city: v.city,
        state: v.state,
        lat: v.lat,
        lng: v.lng,
        serviceRadiusKm: v.radius,
        leadTimeDays: v.lead,
        paymentTerms: v.terms,
        creditDays: v.credit,
        bankName: "HDFC Bank",
        bankAccountMasked: `XXXXXX${Math.floor(1000 + rand() * 8999)}`,
        bankIfsc: "HDFC0000123",
        isPreferred: v.quality > 0.92,
        categories: { create: v.cats.map((c) => ({ categoryId: cats.get(c)! })) },
        materials: { create: vendorMats.map((m) => ({ materialId: mats.get(m.code)!.id })) },
      },
    });
    vendors.push({ id: row.id, v });
    for (const pr of projects) {
      const km = approxRoadKm({ lat: pr.p.lat, lng: pr.p.lng }, v);
      if (km > 400) continue;
      await db.projectVendor.create({ data: { projectId: pr.id, vendorId: row.id, distanceKm: km, transitHours: transitHoursFor(km), distanceSource: "HAVERSINE" } });
    }
  }
  const book = await db.projectVendor.findMany();
  const eligible = (projectId: string, cat: string) =>
    vendors.filter((x) => x.v.cats.includes(cat) && book.some((b) => b.projectId === projectId && b.vendorId === x.id && (b.distanceKm ?? 0) <= x.v.radius));

  console.log("Stock & 12 months of purchase history…");
  const lowStock = new Set(["CEM-OPC53", "STL-TMT12", "AGG-MSAND", "ELE-FRW25", "RMC-M25"]);
  for (const pr of projects) {
    for (const [code, { id, m }] of mats) {
      const vs = eligible(pr.id, m.cat);
      let rate = m.rate * (0.9 + rand() * 0.05);
      let last: { rate: number; vendorId: string; date: Date } | null = null;
      if (vs.length) {
        for (let month = 12; month >= 1; month--) {
          const buys = 1 + Math.floor(rand() * 2);
          for (let b = 0; b < buys; b++) {
            rate = rate * (1 + (rand() - 0.42) * 0.035); // gentle upward drift
            const vend = pick(vs);
            const r = r2(rate * vend.v.price);
            const date = daysAgo(month * 30 - Math.floor(rand() * 25));
            const qtyBase = m.unit === "nos" ? 20000 : m.unit === "bag" ? 800 : m.unit === "tonne" ? 18 : m.unit === "m3" ? 60 : m.unit === "kg" ? 400 : 60;
            await db.rateHistory.create({
              data: { projectId: pr.id, materialId: id, vendorId: vend.id, poNumber: `PO-${pr.p.code}-H${month}${b}${code.slice(-3)}`, qty: Math.round(qtyBase * (0.6 + rand() * 0.8)), rate: r, date },
            });
            if (!last || date > last.date) last = { rate: r, vendorId: vend.id, date };
          }
        }
      }
      const reorder = m.unit === "nos" ? 15000 : m.unit === "bag" ? 600 : m.unit === "tonne" ? 12 : m.unit === "m3" ? 40 : m.unit === "kg" ? 300 : m.unit === "coil" ? 40 : 50;
      const low = lowStock.has(code) && pr.p.code !== "MUM1";
      const current = low ? Math.round(reorder * (0.4 + rand() * 0.5)) : Math.round(reorder * (1.05 + rand() * 2));
      await db.materialProjectStock.create({ data: { projectId: pr.id, materialId: id, currentQty: current, reorderLevel: reorder, lastRate: last?.rate, lastRateAt: last?.date } });
      await db.stockLedger.create({ data: { projectId: pr.id, materialId: id, type: "ADJUST", qty: current, balanceAfter: current, refType: "OPENING", note: "Opening balance", createdById: users.site.id, createdAt: daysAgo(30) } });
      if (last) await db.vendorMaterial.updateMany({ where: { vendorId: last.vendorId, materialId: id }, data: { lastRate: last.rate } });
    }
  }

  console.log("Completed orders with ratings…");
  let poSeq = 0;
  let grnSeq = 0;
  const ratingsByVendor = new Map<string, { stars: number; projectId: string; at: Date }[]>();
  const completedPlan: { project: number; code: string; vendorIdx: number[] }[] = [
    { project: 0, code: "CEM-OPC53", vendorIdx: [0, 2, 0, 2] },
    { project: 0, code: "STL-TMT12", vendorIdx: [1, 6, 1] },
    { project: 0, code: "AGG-MSAND", vendorIdx: [0, 5, 0] },
    { project: 0, code: "RMC-M25", vendorIdx: [3, 3, 3] },
    { project: 0, code: "ELE-FRW25", vendorIdx: [4, 4, 4] },
    { project: 1, code: "STL-TMT16", vendorIdx: [6, 1, 6] },
    { project: 1, code: "CEM-PPC", vendorIdx: [2, 0, 2] },
    { project: 1, code: "MAS-AAC150", vendorIdx: [0, 5, 0] },
    { project: 1, code: "RMC-M30", vendorIdx: [3, 3, 3] },
    { project: 1, code: "PNT-INTEMU", vendorIdx: [7, 7, 7] },
    { project: 1, code: "AGG-20MM", vendorIdx: [5, 0, 5] },
  ];
  for (const plan of completedPlan) {
    const pr = projects[plan.project];
    const { id: materialId, m } = mats.get(plan.code)!;
    for (let k = 0; k < plan.vendorIdx.length; k++) {
      const { id: vendorId, v } = vendors[plan.vendorIdx[k]];
      const created = daysAgo(300 - k * 70 - Math.floor(rand() * 20));
      const q = m.unit === "bag" ? 1000 : m.unit === "tonne" ? 20 : m.unit === "m3" ? 50 : m.unit === "coil" ? 60 : m.unit === "litre" ? 600 : 400;
      const rate = r2(m.rate * v.price * (0.93 + rand() * 0.06));
      const sub = r2(q * rate);
      const gst = r2((sub * m.gst) / 100);
      const freight = m.unit === "tonne" ? 6000 : 2500;
      const promised = new Date(created.getTime() + (v.lead + 2) * DAY);
      const late = rand() > v.punctual ? 1 + Math.floor(rand() * 4) : 0;
      const received = new Date(promised.getTime() + late * DAY);
      const rejected = rand() > v.quality ? Math.round(q * 0.04) : 0;
      const accepted = q - rejected;
      poSeq++;
      grnSeq++;
      const po = await db.purchaseOrder.create({
        data: {
          number: `PO-${pr.p.code}-${created.getFullYear()}-${String(poSeq).padStart(4, "0")}`,
          projectId: pr.id,
          vendorId,
          status: "CLOSED",
          subtotal: sub,
          gstTotal: gst,
          freight,
          total: r2(sub + gst + freight),
          paymentTerms: v.terms,
          creditDays: v.credit,
          expectedDeliveryDate: promised,
          promisedDeliveryDate: promised,
          deliveryAddress: pr.p.siteAddress,
          sentAt: created,
          acceptedAt: new Date(created.getTime() + (6 + rand() * 40) * 3600_000),
          deliveredAt: received,
          closedAt: new Date(received.getTime() + 5 * DAY),
          createdAt: created,
          createdById: users.buyer.id,
          items: { create: { materialId, description: `${m.name} — ${m.spec}`, quantity: q, unit: m.unit, unitRate: rate, gstPercent: m.gst, amount: sub, receivedQty: q, acceptedQty: accepted } },
        },
        include: { items: true },
      });
      await db.rateHistory.create({ data: { projectId: pr.id, materialId, vendorId, poId: po.id, poNumber: po.number, qty: q, rate, date: created } });
      const grn = await db.gRN.create({
        data: {
          number: `GRN-${pr.p.code}-${received.getFullYear()}-${String(grnSeq).padStart(4, "0")}`,
          poId: po.id,
          projectId: pr.id,
          receivedAt: received,
          challanNo: `DC-${Math.floor(1000 + rand() * 9000)}`,
          receivedById: users.site.id,
          items: { create: { poItemId: po.items[0].id, materialId, deliveredQty: q, acceptedQty: accepted, rejectedQty: rejected, rejectionReason: rejected ? "Damaged / below spec" : null } },
          qualityCheck: { create: { specMatch: rejected === 0, noDamage: rejected === 0, packagingOk: true, testCertProvided: v.quality > 0.85, photoKeys: [] } },
        },
      });
      if (rejected) await db.returnRequest.create({ data: { grnId: grn.id, poId: po.id, vendorId, materialId, qty: rejected, reason: "Damaged / below spec", status: "REPLACED", resolvedAt: new Date(received.getTime() + 3 * DAY) } });
      const docsComplete = rand() < v.quality;
      const res = computeRating({
        finalRate: rate,
        lowestQuoteRate: r2(m.rate * 0.93),
        marketAvgRate: m.rate,
        previousRate: r2(m.rate * 0.97),
        promisedDate: promised.toISOString(),
        lots: [{ promisedDate: promised.toISOString(), actualDate: received.toISOString() }],
        deliveredQty: q,
        acceptedQty: accepted,
        specMatch: rejected === 0,
        noDamage: rejected === 0,
        testCertProvided: v.quality > 0.85,
        returnsCount: rejected ? 1 : 0,
        responseHours: 6 + rand() * 30,
        rfqWindowHours: 48,
        poAcceptHours: 6 + rand() * 40,
        dispatchUpdates: rand() < v.punctual ? 2 : 0,
        gstDocsOk: true,
        challanProvided: true,
        challanDocsUploaded: docsComplete,
        poAcceptedAsIs: rand() < v.punctual,
      });
      await db.vendorRating.create({
        data: {
          vendorId,
          projectId: pr.id,
          poId: po.id,
          totalScore: res.totalScore,
          stars: res.stars,
          createdAt: po.closedAt!,
          criteria: { create: res.criteria.map((c) => ({ key: c.key, weight: c.weight, autoScore: c.score, finalScore: c.score, details: c.details as never })) },
        },
      });
      const list = ratingsByVendor.get(vendorId) ?? [];
      list.push({ stars: res.stars, projectId: pr.id, at: po.closedAt! });
      ratingsByVendor.set(vendorId, list);
    }
  }
  for (const [vendorId, list] of ratingsByVendor) {
    list.sort((a, b) => b.at.getTime() - a.at.getTime());
    await db.vendor.update({ where: { id: vendorId }, data: { overallRating: rollingRating(list.map((x) => x.stars)), completedOrders: list.length } });
    for (const pr of projects) {
      const pl = list.filter((x) => x.projectId === pr.id);
      if (pl.length) await db.projectVendor.updateMany({ where: { vendorId, projectId: pr.id }, data: { rating: rollingRating(pl.map((x) => x.stars)), ratedOrders: pl.length } });
    }
  }

  console.log("Live RFQs with quotations (text / PDF / DOCX)…");
  const tpl = await db.rFQTemplate.findFirstOrThrow();
  async function bump0(key: string, value: number) {
    const c = await db.counter.findUnique({ where: { key } });
    if (!c || c.value < value) await db.counter.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  async function liveRfq(opts: { project: number; code: string; qty: number; vendorIdx: number[]; seq: number; quotes: { vendor: number; method: "TEXT" | "PDF" | "DOCX"; lines: string[]; fields?: Record<string, unknown> }[] }) {
    const pr = projects[opts.project];
    const { id: materialId, m } = mats.get(opts.code)!;
    const sentAt = daysAgo(1);
    const deadline = new Date(now.getTime() + 30 * 3600_000);
    const expected = new Date(now.getTime() + 7 * DAY);
    const rfq = await db.rFQ.create({
      data: {
        number: `RFQ-${pr.p.code}-${now.getFullYear()}-${String(opts.seq).padStart(4, "0")}`,
        projectId: pr.id,
        status: "PARTIALLY_RESPONDED",
        expectedDeliveryDate: expected,
        deadline,
        deliveryAddress: pr.p.siteAddress,
        notes: "Deliver in lots as per site schedule; test certificates mandatory.",
        templateId: tpl.id,
        createdById: users.buyer.id,
        createdAt: sentAt,
        items: { create: { materialId, quantity: opts.qty, unit: m.unit, spec: m.spec } },
      },
    });
    await bump0(`RFQ:${pr.p.code}:${now.getFullYear()}`, opts.seq);
    for (const vi of opts.vendorIdx) {
      const { id: vendorId, v } = vendors[vi];
      const token = newToken();
      const pv = book.find((b) => b.projectId === pr.id && b.vendorId === vendorId);
      const quote = opts.quotes.find((q) => q.vendor === vi);
      const rv = await db.rFQVendor.create({
        data: {
          rfqId: rfq.id,
          vendorId,
          tokenHash: hashToken(token),
          tokenCipher: encrypt(token),
          tokenExpiresAt: new Date(deadline.getTime() + DAY),
          deadline,
          status: quote ? "RESPONDED" : vi % 2 ? "OPENED" : "SENT",
          sentAt,
          openedAt: quote || vi % 2 ? new Date(sentAt.getTime() + 2 * 3600_000) : null,
          respondedAt: quote ? new Date(sentAt.getTime() + (4 + rand() * 10) * 3600_000) : null,
          distanceKm: pv?.distanceKm,
        },
      });
      const link = `${APP_URL}/vendor/rfq/${token}`;
      await db.emailLog.create({
        data: {
          idempotencyKey: `rfqv:${rv.id}:invite:`,
          to: [`sales@${slug(v.name).slice(0, 18)}.example`],
          subject: `RFQ ${rfq.number}: ${m.name} for ${pr.p.name}`,
          html: `<p>Dear ${v.contact},</p><p>NYATI invites you to quote for ${opts.qty} ${m.unit} of ${m.name}.</p><p><a href="${link}">Submit Quotation</a></p><p>${link}</p>`,
          status: "DEMO",
          provider: "demo",
          sentAt,
          relatedType: "RFQVendor",
          relatedId: rv.id,
          projectId: pr.id,
          createdAt: sentAt,
        },
      });
      if (quote) {
        const ref = `QT-${now.getFullYear()}-${String(opts.seq * 10 + vi).padStart(5, "0")}`;
        const q = await db.quotation.create({ data: { rfqVendorId: rv.id, rfqId: rfq.id, vendorId, referenceNo: ref } });
        let docKey: string | null = null;
        let mime = "";
        if (quote.method === "PDF") {
          docKey = await saveUpload(`quotations/${q.id}`, "quotation.pdf", await textPdf(quote.lines));
          mime = "application/pdf";
        }
        if (quote.method === "DOCX") {
          docKey = await saveUpload(`quotations/${q.id}`, "quotation.docx", textDocx(quote.lines));
          mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }
        const ver = await db.quotationVersion.create({
          data: {
            quotationId: q.id,
            versionNo: 1,
            method: quote.method,
            rawText: quote.method === "TEXT" ? quote.lines.join("\n") : null,
            vendorFields: (quote.fields ?? {}) as never,
            parseStatus: "PENDING",
            submittedAt: rv.respondedAt!,
            documents: docKey ? { create: { fileKey: docKey, fileName: `quotation.${quote.method.toLowerCase()}`, mimeType: mime, size: fs.statSync(path.resolve(".data/uploads", docKey)).size } } : undefined,
          },
        });
        await db.quotation.update({ where: { id: q.id }, data: { activeVersionId: ver.id } });
        await db.job.create({ data: { type: "PARSE_QUOTATION", payload: { versionId: ver.id } } });
      }
    }
    await db.notification.create({ data: { userId: users.buyer.id, projectId: pr.id, type: "QUOTATION", title: `Quotations received — ${rfq.number}`, body: `${opts.quotes.length} of ${opts.vendorIdx.length} vendors responded`, link: `/rfqs/${rfq.id}` } });
    return rfq;
  }

  const d = (n: number) => new Date(now.getTime() + n * DAY).toISOString().slice(0, 10);
  await liveRfq({
    project: 0,
    code: "CEM-OPC53",
    qty: 2000,
    seq: 1,
    vendorIdx: [0, 2, 5, 1],
    quotes: [
      {
        vendor: 0,
        method: "TEXT",
        lines: [
          "Shree Ganesh Building Materials — Quotation",
          "Quotation No: SGBM/Q/2611",
          "Item: OPC 53 Grade Cement (UltraTech / ACC), 50 kg bags",
          "Quantity: 2000 bags",
          "Unit Rate: Rs. 372 per bag",
          "GST @ 28%",
          "Freight charges: Rs. 8,000",
          "Unloading charges: Rs. 4,000",
          "Grand Total: Rs. 9,64,320",
          "Delivery within 3 days of PO",
          "Payment terms: 30 days credit",
          "Validity: 15 days",
        ],
        fields: { unitRate: 372, gstPercent: 28, deliveryDays: 3, paymentTerms: "30 days credit" },
      },
      {
        vendor: 2,
        method: "PDF",
        lines: [
          "SAHYADRI CEMENT DEPOT - QUOTATION",
          "Ref No: SCD-7781",
          "OPC 53 Grade Cement, 50 kg bag - Qty: 2000 bags",
          "Rate: Rs. 358 per bag (ex-works)",
          "GST @ 28%",
          "Transport charges: Rs. 14,000",
          "Total Amount: Rs. 9,30,480",
          "Delivery within 9 days",
          "Payment: Against delivery",
          "Validity: 7 days",
        ],
      },
      {
        vendor: 5,
        method: "DOCX",
        lines: [
          "Konkan Aggregates & Sand Co.",
          "Quotation No: KAS/2026/114",
          "Material: OPC 53 Grade Cement - Quantity: 1500 bags (balance not available)",
          "Unit Rate: Rs. 366 per bag",
          "GST @ 28%",
          "Freight: Rs. 18,000",
          "Grand Total: Rs. 7,20,720",
          "Delivery within 4 days",
          "Payment terms: 15 days credit",
          "Validity: 10 days",
          "Note: Only 1500 bags available from current stock",
        ],
      },
    ],
  });
  await liveRfq({
    project: 1,
    code: "STL-TMT12",
    qty: 25,
    seq: 1,
    vendorIdx: [1, 6],
    quotes: [
      {
        vendor: 1,
        method: "TEXT",
        lines: [
          "Deccan Steel Traders",
          "Quote # DST-552",
          "TMT Fe500D 12mm (JSW / Tata Tiscon) Quantity: 25 tonne",
          "Rate per tonne: Rs. 56,400",
          "GST @ 18%",
          "Loading charges: Rs. 3,500",
          "Freight: Rs. 9,000",
          "Total: Rs. 16,76,300",
          `Delivery by ${d(5)} (deliver within 5 days)`,
          "Payment terms: 21 days credit",
          "Validity: 7 days",
          "Warranty: Mill test certificate provided",
        ],
      },
      {
        vendor: 6,
        method: "PDF",
        lines: [
          "MUMBAI METRO STEEL",
          "Quotation No: MMS/889",
          "TMT Bar Fe500D 12 mm, Qty: 25 tonne",
          "Unit Rate: Rs. 54,900 per tonne",
          "GST @ 18%",
          "Freight: Rs. 21,000",
          "Grand Total: Rs. 16,40,550",
          "Delivery within 10 days",
          "Payment: Advance 50%, balance on delivery",
          "Validity: 5 days",
        ],
      },
    ],
  });

  console.log("Open order (accepted, in transit)…");
  // PO accepted by vendor, awaiting delivery (for GRN demo)
  {
    const pr = projects[0];
    const { id: materialId, m } = mats.get("AGG-MSAND")!;
    const vend = vendors[0];
    const q = 80;
    const rate = 1465;
    const sub = q * rate;
    poSeq++;
    const po = await db.purchaseOrder.create({
      data: {
        number: `PO-${pr.p.code}-${now.getFullYear()}-${String(poSeq).padStart(4, "0")}`,
        projectId: pr.id,
        vendorId: vend.id,
        status: "ACCEPTED",
        subtotal: sub,
        gstTotal: r2(sub * 0.05),
        freight: 3000,
        total: r2(sub * 1.05 + 3000),
        paymentTerms: vend.v.terms,
        creditDays: vend.v.credit,
        expectedDeliveryDate: new Date(now.getTime() + DAY),
        promisedDeliveryDate: new Date(now.getTime() + DAY),
        deliveryAddress: pr.p.siteAddress,
        sentAt: daysAgo(2),
        acceptedAt: daysAgo(2),
        createdById: users.buyer.id,
        items: { create: { materialId, description: `${m.name} — ${m.spec}`, quantity: q, unit: m.unit, unitRate: rate, gstPercent: m.gst, amount: sub } },
        deliveryUpdates: { create: { source: "VENDOR", status: "DISPATCHED", vehicleNo: "MH12 QW 4521", driverName: "Santosh", driverPhone: "+91 98230 77881", eta: new Date(now.getTime() + 20 * 3600_000) } },
      },
    });
    await db.rateHistory.create({ data: { projectId: pr.id, materialId, vendorId: vend.id, poId: po.id, poNumber: po.number, qty: q, rate, date: daysAgo(3) } });
  }
  const bump = async (key: string, value: number) => {
    const c = await db.counter.findUnique({ where: { key } });
    if (!c || c.value < value) await db.counter.upsert({ where: { key }, create: { key, value }, update: { value } });
  };
  for (const pr of PROJECTS) {
    await bump(`PO:${pr.code}:${now.getFullYear()}`, poSeq);
    await bump(`GRN:${pr.code}:${now.getFullYear()}`, grnSeq);
  }
  await bump(`QT:${now.getFullYear()}`, 100);

  console.log(KEEP ? "✔ Sample data added. Existing users keep their passwords; new sample users use nyati123." : "✔ Seed complete. Sign in at /login with admin@nyati.in / nyati123 (see README for all roles).");
  console.log("  Quotation parsing jobs are queued and run automatically within ~10 s of starting the app.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
