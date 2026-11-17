import { describe, it, expect } from "vitest";
import { computeLanded } from "@/lib/engine/landed-cost";
import { canonicalUnit, convertRate, convertQty, sameDimension } from "@/lib/engine/units";
import { heuristicExtract } from "@/lib/quotation/extract";
import { mongoUrl } from "@/lib/mongo-url";
import { rfqVendorLink, poVendorLink, rfqLinkExpiry, portalUrlIsLocal, whatsappShareUrl } from "@/lib/vendor-links";

describe("landed cost", () => {
  it("Σ(qty × rate) + GST + freight + loading + other", () => {
    const r = computeLanded({ items: [{ quantity: 2000, unitRate: 372, gstPercent: 28 }], freight: 8000, loading: 4000, statedTotal: 964_320 });
    expect(r.subtotal).toBe(744_000);
    expect(r.gstTotal).toBe(208_320);
    expect(r.landedCost).toBe(964_320);
    expect(r.mismatch).toBe(false);
  });
  it("flags a stated-total mismatch beyond tolerance", () => {
    const r = computeLanded({ items: [{ quantity: 10, unitRate: 1000, gstPercent: 18 }], statedTotal: 12_500 });
    expect(r.landedCost).toBe(11_800);
    expect(r.mismatch).toBe(true);
    expect(r.mismatchAmount).toBe(700);
  });
  it("tolerates rounding differences", () => {
    expect(computeLanded({ items: [{ quantity: 3, unitRate: 333.33, gstPercent: 18 }], statedTotal: 1180 }).mismatch).toBe(false);
  });
});

describe("unit normalisation", () => {
  it("canonicalises aliases and plurals", () => {
    expect(canonicalUnit("Bags")).toBe("bag");
    expect(canonicalUnit("per MT")).toBe("mt");
    expect(canonicalUnit("cu.m")).toBe("m3");
    expect(canonicalUnit("m³")).toBe("m3");
    expect(canonicalUnit("widgets")).toBeNull();
  });
  it("converts rates between units of the same dimension", () => {
    expect(convertRate(400, "bag", "tonne")).toBe(8000); // 50 kg bags
    expect(convertRate(56_000, "tonne", "kg")).toBe(56);
    expect(convertRate(5000, "brass", "cft")).toBeCloseTo(50);
    expect(convertRate(100, "bag", "m3")).toBeNull();
  });
  it("converts quantities", () => {
    expect(convertQty(2, "tonne", "bag")).toBe(40);
    expect(sameDimension("kg", "quintal")).toBe(true);
  });
});

describe("rule-based quotation extraction", () => {
  const ctx = { rfqNo: "RFQ-1", material: "OPC 53 Cement", spec: null, quantity: 2000, unit: "bag", expectedDeliveryDate: "2026-11-10T00:00:00Z", deliveryAddress: "Pune" };
  it("reads rate, GST, freight, total, delivery and terms from typed text", () => {
    const e = heuristicExtract(
      ["Quotation No: SG/11", "Quantity: 2000 bags", "Unit Rate: Rs. 372 per bag", "GST @ 28%", "Freight charges: Rs. 8,000", "Unloading charges: Rs. 4,000", "Grand Total: Rs. 9,64,320", "Delivery within 3 days", "Payment terms: 30 days credit", "Validity: 15 days"].join("\n"),
      ctx,
    );
    expect(e.quotation_no).toBe("SG/11");
    expect(e.items[0].unit_rate).toBe(372);
    expect(e.items[0].gst_percent).toBe(28);
    expect(e.freight).toBe(8000);
    expect(e.loading_charges).toBe(4000);
    expect(e.grand_total).toBe(964_320);
    expect(e.delivery_days).toBe(3);
    expect(e.validity_days).toBe(15);
    expect(e.payment_terms).toMatch(/30 days/);
    expect(e.confidence).toBeGreaterThanOrEqual(0.7);
  });
  it("gives low confidence when key fields are missing", () => {
    expect(heuristicExtract("We can supply cement, please call.", ctx).confidence).toBeLessThan(0.7);
  });
});

describe("MongoDB connection string", () => {
  it("inserts MONGODB_DB into an Atlas SRV URI and keeps the query string", () => {
    expect(mongoUrl({ MONGODB_URI: "mongodb+srv://u:p@cluster0.ab.mongodb.net/?retryWrites=true&w=majority", MONGODB_DB: "nyati_procurement" })).toBe(
      "mongodb+srv://u:p@cluster0.ab.mongodb.net/nyati_procurement?retryWrites=true&w=majority",
    );
  });
  it("MONGODB_DB overrides a database already in the URI", () => {
    expect(mongoUrl({ MONGODB_URI: "mongodb://localhost:27017/old?replicaSet=rs0", MONGODB_DB: "nyati" })).toBe("mongodb://localhost:27017/nyati?replicaSet=rs0");
  });
  it("uses the database in the URI when MONGODB_DB is empty", () => {
    expect(mongoUrl({ MONGODB_URI: "mongodb://h:27017/nyati" })).toBe("mongodb://h:27017/nyati");
  });
  it("requires a database name", () => {
    expect(() => mongoUrl({ MONGODB_URI: "mongodb://h:27017" })).toThrow(/MONGODB_DB/);
  });
  it("falls back to DATABASE_URL", () => {
    expect(mongoUrl({ DATABASE_URL: "mongodb://x/y" })).toBe("mongodb://x/y");
  });
});

describe("vendor links", () => {
  it("uses VENDOR_PORTAL_URL, then APP_URL", () => {
    process.env.APP_URL = "https://app.nyati.in/";
    delete process.env.VENDOR_PORTAL_URL;
    expect(rfqVendorLink("tok")).toBe("https://app.nyati.in/vendor/rfq/tok");
    process.env.VENDOR_PORTAL_URL = "https://vendors.nyati.in";
    expect(poVendorLink("tok")).toBe("https://vendors.nyati.in/vendor/po/tok");
    expect(portalUrlIsLocal()).toBe(false);
    process.env.VENDOR_PORTAL_URL = "http://localhost:3000";
    expect(portalUrlIsLocal()).toBe(true);
  });
  it("RFQ links expire VENDOR_LINK_GRACE_HOURS after the deadline", () => {
    process.env.VENDOR_LINK_GRACE_HOURS = "12";
    const d = new Date("2026-11-10T10:00:00Z");
    expect(rfqLinkExpiry(d).toISOString()).toBe("2026-11-10T22:00:00.000Z");
  });
  it("WhatsApp share adds the India code to 10-digit numbers", () => {
    expect(whatsappShareUrl("+91 98220 11223", "hi")).toBe("https://wa.me/919822011223?text=hi");
    expect(whatsappShareUrl("9822011223", "a b")).toBe("https://wa.me/919822011223?text=a%20b");
  });
});

describe("pack-size units from web listings", () => {
  it("converts '50 kg bag' and '40kg bag' rates", () => {
    expect(convertRate(350, "50 kg bag", "bag")).toBeCloseTo(350);
    expect(convertRate(300, "40kg bag", "bag")).toBeCloseTo(375);
    expect(convertRate(7, "kg", "50 kg bag")).toBeCloseTo(350);
  });
  it("converts '20 L can' and 'per 1000 nos'", () => {
    expect(convertRate(2000, "20 L can", "litre")).toBeCloseTo(100);
    expect(convertRate(8000, "per 1000 nos", "nos")).toBeCloseTo(8);
  });
  it("rejects unrelated units", () => {
    expect(convertRate(100, "50 kg bag", "m3")).toBeNull();
  });
});

import { wrapLabel } from "@/components/chart-ticks";
describe("chart label wrapping", () => {
  it("wraps vendor names onto two lines when there is room", () => {
    expect(wrapLabel("Shree Ganesh Building Materials", 19)).toEqual(["Shree Ganesh", "Building Materials"]);
  });
  it("shortens with an ellipsis when the bar is narrow", () => {
    const l = wrapLabel("Shree Ganesh Building Materials", 10);
    expect(l).toHaveLength(2);
    expect(l.every((x) => x.length <= 10)).toBe(true);
    expect(l[1].endsWith("…")).toBe(true);
  });
  it("keeps short names intact", () => {
    expect(wrapLabel("ACC", 10)).toEqual(["ACC"]);
  });
});
