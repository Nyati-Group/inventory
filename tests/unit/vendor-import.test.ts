import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { parseCsv, parseXlsx, gridToVendors, rowErrors } from "@/lib/vendor-import";

describe("vendor bulk upload parsing", () => {
  it("parses quoted CSV fields with commas, quotes and newlines", () => {
    const g = parseCsv('name,email,city,address\r\n"Shree Ganesh, Pune",a@x.in,Pune,"Plot 12, ""A"" Wing\nHadapsar"\r\n\r\n');
    expect(g).toHaveLength(2);
    expect(g[1][0]).toBe("Shree Ganesh, Pune");
    expect(g[1][3]).toBe('Plot 12, "A" Wing\nHadapsar');
  });

  it("maps common header spellings and splits lists", () => {
    const { rows, unknownColumns, missingRequired } = gridToVendors([
      ["Vendor Name", "Email ID", "Mobile No", "GST No", "City", "Category", "Credit Days", "Favourite colour"],
      ["Sahyadri Cement", "A@X.in; b@x.in", "9822012345.0", "27abcde1234f1z5", "Pune", "Cement; Steel", "30 days", "blue"],
    ]);
    expect(missingRequired).toEqual([]);
    expect(unknownColumns).toEqual(["Favourite colour"]);
    expect(rows[0]).toMatchObject({ row: 2, name: "Sahyadri Cement", emails: ["a@x.in", "b@x.in"], phone: "9822012345", gstin: "27ABCDE1234F1Z5", categories: ["Cement", "Steel"], creditDays: 30 });
    expect(rowErrors(rows[0])).toEqual([]);
  });

  it("reports missing required columns and bad rows", () => {
    expect(gridToVendors([["name", "phone"]]).missingRequired).toEqual(["email", "city"]);
    const { rows } = gridToVendors([["name", "email", "city", "gstin"], ["X", "not-an-email", "", "BADGST"]]);
    expect(rowErrors(rows[0])).toEqual(["Name is missing", "Invalid email: not-an-email", "City is missing", "Invalid GSTIN: BADGST"]);
  });

  it("reads an .xlsx sheet with shared strings, numbers and gaps", () => {
    const zip = new PizZip();
    zip.file("xl/workbook.xml", '<workbook xmlns:r="r"><sheets><sheet name="Vendors" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file("xl/sharedStrings.xml", "<sst><si><t>name</t></si><si><t>email</t></si><si><t>city</t></si><si><t>phone</t></si><si><r><t>Konkan </t></r><r><t>Aggregates &amp; Sand</t></r></si><si><t>k@x.in</t></si><si><t>Panvel</t></si></sst>");
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="D2"><v>9890011122</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>Inline Co</t></is></c><c r="B3" t="s"><v>5</v></c><c r="C3" t="s"><v>6</v></c></row></sheetData></worksheet>',
    );
    const grid = parseXlsx(zip.generate({ type: "nodebuffer" }));
    const { rows } = gridToVendors(grid);
    expect(rows[0]).toMatchObject({ name: "Konkan Aggregates & Sand", emails: ["k@x.in"], city: "", phone: "9890011122" });
    expect(rows[1]).toMatchObject({ name: "Inline Co", city: "Panvel" });
  });
});
