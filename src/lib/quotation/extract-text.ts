import PizZip from "pizzip";
import path from "node:path";

export interface TextExtraction {
  text: string;
  method: "pdf-text" | "docx" | "xlsx" | "plain" | "none";
  note?: string;
}

/** Text layer of a PDF via pdfjs-dist (legacy Node build), loaded at runtime so webpack doesn't bundle it. */
async function pdfText(buf: Buffer) {
  const pdfjs = (await import(/* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
  }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // Rebuild lines from text items (hasEOL marks line ends).
    pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join(""));
  }
  await doc.destroy();
  return pages.join("\n");
}

/** Extract raw text from an uploaded quotation. Scanned PDFs/images return empty text (handled by vision LLM or manual review). */
export async function extractText(buf: Buffer, mime: string): Promise<TextExtraction> {
  if (mime === "application/pdf") {
    const text = (await pdfText(buf)).trim();
    return text.length > 20
      ? { text, method: "pdf-text" }
      : { text: "", method: "none", note: "PDF has no text layer (scanned) — OCR/vision required" };
  }
  if (mime.includes("wordprocessingml") || mime === "application/msword") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: buf });
    return { text: r.value.trim(), method: "docx" };
  }
  if (mime.includes("spreadsheetml")) {
    const zip = new PizZip(buf);
    const shared = zip.file("xl/sharedStrings.xml")?.asText() ?? "";
    const strings = [...shared.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
    const sheet = zip.file("xl/worksheets/sheet1.xml")?.asText() ?? "";
    const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
      [...row[1].matchAll(/<c[^>]*?(t="s")?[^>]*>(?:<v>([^<]*)<\/v>)?/g)]
        .map((c) => (c[1] ? strings[Number(c[2])] : c[2]) ?? "")
        .join("\t"),
    );
    return { text: rows.join("\n").trim(), method: "xlsx" };
  }
  if (mime.startsWith("text/")) return { text: buf.toString("utf8").trim(), method: "plain" };
  return { text: "", method: "none", note: "Image quotation — vision extraction or manual entry required" };
}
