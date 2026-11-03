import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import fs from "node:fs/promises";
import path from "node:path";

const NAVY = rgb(0x11 / 255, 0x2c / 255, 0x49 / 255);
const BLUE = rgb(0x01 / 255, 0x4b / 255, 0x85 / 255);
const TINT = rgb(0xe6 / 255, 0xee / 255, 0xf5 / 255);
const BORDER = rgb(0xe2 / 255, 0xe8 / 255, 0xf0 / 255);
const MUTED = rgb(0x64 / 255, 0x74 / 255, 0x8b / 255);
const INK = rgb(0x0f / 255, 0x17 / 255, 0x2a / 255);

/** Standard PDF fonts are WinAnsi — replace characters they cannot encode. */
const safe = (s: string) => s.replace(/₹/g, "Rs.").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

class Doc {
  pdf!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  W = 595.28;
  H = 841.89;
  M = 40;

  static async create() {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.font = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    d.newPage();
    return d;
  }
  newPage() {
    this.page = this.pdf.addPage([this.W, this.H]);
    this.y = this.H - this.M;
  }
  ensure(h: number) {
    if (this.y - h < this.M + 30) this.newPage();
  }
  text(s: string, x: number, size = 10, font = this.font, color = INK) {
    this.page.drawText(safe(s), { x, y: this.y, size, font, color });
  }
  wrap(s: string, width: number, size = 10, font = this.font) {
    const out: string[] = [];
    for (const para of safe(s).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(t, size) > width && line) {
          out.push(line);
          line = word;
        } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  async header(company: string, title: string, sub: string) {
    const band = 84;
    this.page.drawRectangle({ x: 0, y: this.H - band, width: this.W, height: band, color: NAVY });
    let textX = this.M;
    const logo = await this.logo();
    if (logo) {
      // Logo is blue on transparent with a white "N" — place it on a white tile, as in the app.
      const h = 62;
      const w = (h * logo.width) / logo.height;
      this.page.drawRectangle({ x: this.M - 6, y: this.H - band + 5, width: w + 12, height: h + 12, color: rgb(1, 1, 1) });
      this.page.drawImage(logo, { x: this.M, y: this.H - band + 11, width: w, height: h });
      textX = this.M + w + 18;
    } else {
      this.page.drawText("NYATI", { x: textX, y: this.H - 45, size: 24, font: this.bold, color: rgb(1, 1, 1) });
    }
    this.page.drawText(safe(company), { x: textX, y: logo ? this.H - 47 : this.H - 62, size: 9, font: this.font, color: rgb(0.85, 0.9, 0.95) });
    const tw = this.bold.widthOfTextAtSize(safe(title), 14);
    this.page.drawText(safe(title), { x: this.W - this.M - tw, y: this.H - 40, size: 14, font: this.bold, color: rgb(1, 1, 1) });
    const sw = this.font.widthOfTextAtSize(safe(sub), 9);
    this.page.drawText(safe(sub), { x: this.W - this.M - sw, y: this.H - 56, size: 9, font: this.font, color: rgb(0.85, 0.9, 0.95) });
    this.y = this.H - band - 25;
  }
  /** public/nyati-logo.png (PNG copy of the supplied logo); null if missing so documents still render. */
  async logo() {
    try {
      return await this.pdf.embedPng(await fs.readFile(path.join(process.cwd(), "public", "nyati-logo.png")));
    } catch {
      return null;
    }
  }
  section(title: string) {
    this.ensure(30);
    this.y -= 6;
    this.text(title.toUpperCase(), this.M, 9, this.bold, BLUE);
    this.y -= 14;
  }
  kv(rows: [string, string][]) {
    const kw = 150;
    for (const [k, v] of rows) {
      const lines = this.wrap(v || "-", this.W - 2 * this.M - kw - 12, 10);
      const h = Math.max(18, lines.length * 12 + 6);
      this.ensure(h);
      this.page.drawRectangle({ x: this.M, y: this.y - h + 12, width: kw, height: h, color: TINT, borderColor: BORDER, borderWidth: 0.5 });
      this.page.drawRectangle({ x: this.M + kw, y: this.y - h + 12, width: this.W - 2 * this.M - kw, height: h, borderColor: BORDER, borderWidth: 0.5 });
      this.text(k, this.M + 6, 9, this.bold, NAVY);
      lines.forEach((l, i) => this.page.drawText(l, { x: this.M + kw + 6, y: this.y - i * 12, size: 10, font: this.font, color: INK }));
      this.y -= h;
    }
    this.y -= 8;
  }
  table(headers: string[], widths: number[], rows: string[][], alignRight: number[] = []) {
    const total = this.W - 2 * this.M;
    const ws = widths.map((w) => (w / widths.reduce((a, b) => a + b, 0)) * total);
    const drawRow = (cells: string[], isHead: boolean) => {
      this.ensure(20);
      let x = this.M;
      this.page.drawRectangle({ x: this.M, y: this.y - 6, width: total, height: 18, color: isHead ? NAVY : undefined, borderColor: BORDER, borderWidth: 0.5 });
      cells.forEach((c, i) => {
        const f = isHead ? this.bold : this.font;
        const s = safe(c);
        const tw = f.widthOfTextAtSize(s, 9);
        const tx = alignRight.includes(i) ? x + ws[i] - tw - 5 : x + 5;
        this.page.drawText(s, { x: tx, y: this.y, size: 9, font: f, color: isHead ? rgb(1, 1, 1) : INK });
        x += ws[i];
      });
      this.y -= 18;
    };
    drawRow(headers, true);
    rows.forEach((r) => drawRow(r, false));
    this.y -= 10;
  }
  paragraph(s: string, size = 9, color = INK) {
    for (const l of this.wrap(s, this.W - 2 * this.M, size)) {
      this.ensure(14);
      this.page.drawText(l, { x: this.M, y: this.y, size, font: this.font, color });
      this.y -= size + 3;
    }
    this.y -= 6;
  }
  signature(left: string, right: string) {
    this.ensure(70);
    this.y -= 40;
    this.page.drawLine({ start: { x: this.M, y: this.y + 12 }, end: { x: this.M + 170, y: this.y + 12 }, thickness: 0.5, color: MUTED });
    this.page.drawLine({ start: { x: this.W - this.M - 170, y: this.y + 12 }, end: { x: this.W - this.M, y: this.y + 12 }, thickness: 0.5, color: MUTED });
    this.text(left, this.M, 9, this.font, MUTED);
    this.text(right, this.W - this.M - 170, 9, this.font, MUTED);
  }
  footer(note: string) {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      p.drawText(safe(`${note}   |   Page ${i + 1} of ${pages.length}`), { x: this.M, y: 22, size: 7, font: this.font, color: MUTED });
    });
  }
}

export interface RfqDocData {
  rfq_no: string;
  company_name: string;
  project_name: string;
  project_code: string;
  material: string;
  category: string;
  spec: string;
  quantity: string;
  unit: string;
  delivery_date: string;
  delivery_address: string;
  deadline: string;
  payment_terms: string;
  notes: string;
  terms: string;
  site_contact: string;
  vendor_name: string;
  issue_date: string;
  template_version: string;
}

export const RFQ_PLACEHOLDERS: (keyof RfqDocData)[] = [
  "rfq_no", "material", "quantity", "unit", "delivery_date", "delivery_address", "deadline", "project_name",
  "company_name", "terms", "spec", "category", "payment_terms", "notes", "site_contact", "vendor_name", "issue_date",
];

export async function renderRfqPdf(d: RfqDocData): Promise<Buffer> {
  const doc = await Doc.create();
  await doc.header(d.company_name, "REQUEST FOR QUOTATION", `${d.rfq_no}  |  Issued ${d.issue_date}`);
  doc.section("Project");
  doc.kv([
    ["Project", `${d.project_name} (${d.project_code})`],
    ["Delivery address", d.delivery_address],
    ["Site contact", d.site_contact],
  ]);
  doc.section("Requirement");
  doc.table(["#", "Material", "Specification", "Quantity", "Unit"], [4, 30, 36, 14, 10], [["1", d.material, d.spec || "-", d.quantity, d.unit]], [3]);
  doc.kv([
    ["Expected delivery date", d.delivery_date],
    ["Quotation deadline", d.deadline],
    ["Payment terms (preferred)", d.payment_terms || "As per vendor offer"],
    ["Notes", d.notes || "-"],
  ]);
  doc.section("Your quotation must include");
  doc.paragraph(
    "Unit rate (pre-tax), GST %, freight/transport, loading/unloading charges, total landed price, delivery time or date, payment terms, validity, warranty (if applicable) and any deviations from the specification. Submit through the secure link in the email.",
  );
  doc.section("Terms & conditions");
  doc.paragraph(d.terms);
  doc.signature("For NYATI — Procurement", "Vendor seal & signature");
  doc.footer(`${d.rfq_no} · Template v${d.template_version} · Generated by NYATI Procurement`);
  return Buffer.from(await doc.pdf.save({ useObjectStreams: false }));
}

/** Fill an uploaded .docx template ({{placeholder}} syntax). */
export function fillDocxTemplate(template: Buffer, data: Record<string, string>): Buffer {
  const zip = new PizZip(template);
  const tpl = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "{{", end: "}}" }, nullGetter: () => "" });
  tpl.render(data);
  return tpl.getZip().generate({ type: "nodebuffer" }) as Buffer;
}

export interface PoDocData {
  po_no: string;
  date: string;
  company_name: string;
  company_gstin: string;
  project: string;
  vendor_name: string;
  vendor_address: string;
  vendor_gstin: string;
  rfq_no: string;
  quotation_ref: string;
  items: { description: string; hsn: string; qty: string; unit: string; rate: string; gst: string; amount: string }[];
  subtotal: string;
  gst: string;
  freight: string;
  total: string;
  delivery_address: string;
  delivery_date: string;
  payment_terms: string;
  receiving: string;
  terms: string;
}

export async function renderPoPdf(d: PoDocData): Promise<Buffer> {
  const doc = await Doc.create();
  await doc.header(d.company_name, "PURCHASE ORDER", `${d.po_no}  |  ${d.date}`);
  doc.section("Supplier");
  doc.kv([
    ["Vendor", d.vendor_name],
    ["Address", d.vendor_address],
    ["Vendor GSTIN", d.vendor_gstin || "-"],
    ["Reference", `RFQ ${d.rfq_no} · Quotation ${d.quotation_ref}`],
  ]);
  doc.section("Order lines");
  doc.table(
    ["#", "Description", "HSN", "Qty", "Unit", "Rate", "GST %", "Amount"],
    [4, 30, 10, 10, 8, 12, 8, 14],
    d.items.map((it, i) => [String(i + 1), it.description, it.hsn, it.qty, it.unit, it.rate, it.gst, it.amount]),
    [3, 5, 6, 7],
  );
  doc.kv([
    ["Sub-total", d.subtotal],
    ["GST", d.gst],
    ["Freight & other charges", d.freight],
    ["Order total", d.total],
  ]);
  doc.section("Delivery & payment");
  doc.kv([
    ["Delivery address", d.delivery_address],
    ["Delivery schedule", d.delivery_date],
    ["Receiving hours / constraints", d.receiving || "-"],
    ["Payment terms", d.payment_terms],
    ["Buyer GSTIN", d.company_gstin || "-"],
  ]);
  doc.section("Terms & conditions");
  doc.paragraph(d.terms);
  doc.signature("Authorised signatory — NYATI", "Accepted by vendor");
  doc.footer(`${d.po_no} · Generated by NYATI Procurement`);
  return Buffer.from(await doc.pdf.save({ useObjectStreams: false }));
}
