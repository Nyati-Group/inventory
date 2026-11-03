import { describe, it, expect } from "vitest";
import { scoreQuotes, deliveryScore, proximityScore, commercialScore, normaliseWeights, vendorFitScore, suggestSplit, DEFAULT_WEIGHTS, type QuoteInput } from "@/lib/engine/scoring";

const base: Omit<QuoteInput, "vendorId" | "vendorName" | "versionId" | "landedCost" | "unitRate"> = {
  quantityOffered: 100,
  deliveryDate: "2026-11-10T00:00:00.000Z",
  distanceKm: 20,
  transitHours: 2,
  serviceRadiusKm: 100,
  vendorRating: 4.5,
  completedOrders: 10,
  onTimePct: 95,
  creditDays: 30,
  validityDays: 15,
  warranty: null,
  deviations: [],
  blacklisted: false,
  quoteSubmittedAt: "2026-11-03T00:00:00.000Z",
};
const q = (id: string, landed: number, over: Partial<QuoteInput> = {}): QuoteInput => ({ ...base, vendorId: id, vendorName: `Vendor ${id}`, versionId: `v${id}`, landedCost: landed, unitRate: landed / 118 / 1.0, ...over });
const ctx = { quantityRequired: 100, expectedDate: "2026-11-10T00:00:00.000Z", maxDelayDays: 7, now: "2026-11-04T00:00:00.000Z" };

describe("component scores", () => {
  it("delivery: on time = 100, linear decay, 0 beyond max delay", () => {
    expect(deliveryScore(-2, 7)).toBe(100);
    expect(deliveryScore(0, 7)).toBe(100);
    expect(deliveryScore(4, 7)).toBe(50);
    expect(deliveryScore(8, 7)).toBe(0);
    expect(deliveryScore(null, 7)).toBe(50);
  });
  it("proximity: outside service radius scores 0; closer is better", () => {
    expect(proximityScore(150, 100, 3)).toBe(0);
    expect(proximityScore(10, 100, 1)).toBeGreaterThan(proximityScore(80, 100, 3));
    expect(proximityScore(null, 100, null)).toBe(50);
  });
  it("commercial: credit, validity, warranty and absence of deviations", () => {
    expect(commercialScore({ creditDays: 45, validityDays: 30, warranty: "1 yr", deviations: [] })).toBe(100);
    expect(commercialScore({ creditDays: 0, validityDays: 0, warranty: null, deviations: ["a", "b", "c"] })).toBe(0);
  });
  it("normalises weights that do not sum to 100", () => {
    const w = normaliseWeights({ price: 20, delivery: 10, proximity: 5, rating: 10, commercial: 5 });
    expect(w.price + w.delivery + w.proximity + w.rating + w.commercial).toBeCloseTo(100);
    expect(w.price).toBeCloseTo(40);
  });
});

describe("scoreQuotes", () => {
  it("price score = 100 × lowest / vendor (per unit landed)", () => {
    const r = scoreQuotes([q("A", 100_000), q("B", 125_000)], ctx);
    const a = r.scored.find((s) => s.vendorId === "A")!;
    const b = r.scored.find((s) => s.vendorId === "B")!;
    expect(a.priceScore).toBe(100);
    expect(b.priceScore).toBe(80);
  });

  it("recommends a slightly dearer, on-time, better-rated vendor over a cheap late one and explains why", () => {
    const cheapLate = q("CHEAP", 96_000, { deliveryDate: "2026-11-15T00:00:00.000Z", vendorRating: 3.2, distanceKm: 90 });
    const good = q("GOOD", 100_000, { deliveryDate: "2026-11-08T00:00:00.000Z", vendorRating: 4.7 });
    const r = scoreQuotes([cheapLate, good], ctx, DEFAULT_WEIGHTS);
    expect(r.recommended?.vendorId).toBe("GOOD");
    expect(r.runnerUp?.vendorId).toBe("CHEAP");
    expect(r.explanation).toContain("Vendor GOOD is recommended");
    expect(r.whyNotCheapest).toMatch(/Vendor CHEAP is .* cheaper/);
    expect(r.recommended?.badges).toContain("Fastest delivery");
    expect(r.scored.find((s) => s.vendorId === "CHEAP")!.badges).toContain("Lowest cost");
  });

  it("hard filters disqualify but still return the vendor with a reason", () => {
    const r = scoreQuotes(
      [q("OK", 100_000), q("BL", 90_000, { blacklisted: true }), q("PART", 80_000, { quantityOffered: 60 }), q("LATE", 85_000, { deliveryDate: "2026-11-25T00:00:00.000Z" }), q("EXP", 88_000, { validityDays: 1, quoteSubmittedAt: "2026-11-01T00:00:00.000Z" })],
      ctx,
    );
    const by = (id: string) => r.scored.find((s) => s.vendorId === id)!;
    expect(r.recommended?.vendorId).toBe("OK");
    expect(by("BL").disqualifyReasons[0]).toMatch(/blacklisted/);
    expect(by("PART").disqualifyReasons[0]).toMatch(/Cannot meet quantity/);
    expect(by("LATE").disqualifyReasons[0]).toMatch(/days late/);
    expect(by("EXP").disqualifyReasons[0]).toMatch(/validity expired/);
    expect(by("BL").rank).toBeNull();
  });

  it("new vendors (<3 orders) use the neutral 3.5 rating", () => {
    const r = scoreQuotes([q("NEW", 100_000, { completedOrders: 1, vendorRating: 5 })], ctx);
    expect(r.scored[0].effectiveRating).toBe(3.5);
    expect(r.scored[0].ratingScore).toBe(70);
  });

  it("what-if weights change the ranking", () => {
    const cheap = q("CHEAP", 90_000, { vendorRating: 3.0 });
    const rated = q("RATED", 100_000, { vendorRating: 5.0 });
    expect(scoreQuotes([cheap, rated], ctx, { price: 80, delivery: 5, proximity: 5, rating: 5, commercial: 5 }).recommended?.vendorId).toBe("CHEAP");
    expect(scoreQuotes([cheap, rated], ctx, { price: 10, delivery: 10, proximity: 10, rating: 60, commercial: 10 }).recommended?.vendorId).toBe("RATED");
  });

  it("suggests a split order when no single vendor can supply the full quantity", () => {
    const r = scoreQuotes([q("A", 60_000, { quantityOffered: 60 }), q("B", 50_000, { quantityOffered: 50 })], ctx);
    expect(r.recommended).toBeNull();
    expect(r.split?.parts.map((p) => p.quantity).reduce((a, b) => a + b, 0)).toBe(100);
    expect(r.split?.parts[0].vendorId).toBe("A"); // both ₹1000/unit; stable order keeps A first
  });

  it("returns no split when a full-quantity vendor exists", () => {
    const r = scoreQuotes([q("FULL", 100_000)], ctx);
    expect(suggestSplit(r.scored, 100, 7)).toBeNull();
  });
});

describe("vendorFitScore", () => {
  it("prefers near, feasible, well-rated vendors", () => {
    const near = vendorFitScore({ distanceKm: 10, serviceRadiusKm: 100, leadTimeDays: 1, transitHours: 1, daysUntilNeed: 7, rating: 4.6, completedOrders: 5 });
    const far = vendorFitScore({ distanceKm: 250, serviceRadiusKm: 200, leadTimeDays: 6, transitHours: 9, daysUntilNeed: 3, rating: 3.0, completedOrders: 5 });
    expect(near).toBeGreaterThan(far);
  });
});
