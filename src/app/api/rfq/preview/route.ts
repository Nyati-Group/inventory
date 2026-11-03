import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { assertProjectAccess } from "@/lib/project-context";
import { renderRfqPdf } from "@/lib/pdf";
import { fmtDate, fmtDateTime, qty } from "@/lib/utils";

/** Live preview of the RFQ PDF from the (unsaved) RFQ form. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const projectId = q.get("projectId") ?? "";
  await assertProjectAccess(user, projectId);
  const [project, material, tpl, s] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    db.material.findUniqueOrThrow({ where: { id: q.get("materialId") ?? "" }, include: { category: true } }),
    db.rFQTemplate.findFirst({ where: { isActive: true }, orderBy: { version: "desc" } }),
    getSettings(),
  ]);
  const pdf = await renderRfqPdf({
    rfq_no: `RFQ-${project.code}-${new Date().getFullYear()}-XXXX (preview)`,
    company_name: s.companyName,
    project_name: project.name,
    project_code: project.code,
    material: material.name,
    category: material.category.name,
    spec: material.spec ?? "",
    quantity: qty(Number(q.get("quantity") ?? 0)),
    unit: material.unit,
    delivery_date: q.get("expected") ? fmtDate(q.get("expected")!) : "—",
    delivery_address: q.get("address") ?? project.siteAddress,
    deadline: q.get("deadline") ? fmtDateTime(q.get("deadline")!) : "—",
    payment_terms: q.get("payment") ?? "",
    notes: q.get("notes") ?? "",
    terms: tpl?.terms ?? s.defaultTerms,
    site_contact: [project.siteContactName, project.siteContactPhone].filter(Boolean).join(", ") || "-",
    vendor_name: "",
    issue_date: fmtDate(new Date()),
    template_version: String(tpl?.version ?? 1),
  });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=rfq-preview.pdf" } });
}
