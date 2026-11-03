import { describe, it, expect } from "vitest";
import { computeRating, applyAdjustments, rollingRating, ratingGrade, deliveryScoreFromLots, qualityScore, type RatingInput } from "@/lib/engine/rating";

const perfect: RatingInput = {
  finalRate: 100,
  lowestQuoteRate: 100,
  marketAvgRate: 105,
  previousRate: 102,
  promisedDate: "2026-10-10T00:00:00Z",
  lots: [{ promisedDate: "2026-10-10T00:00:00Z", actualDate: "2026-10-09T10:00:00Z" }],
  deliveredQty: 100,
  acceptedQty: 100,
  specMatch: true,
  noDamage: true,
  testCertProvided: true,
  returnsCount: 0,
  responseHours: 4,
  rfqWindowHours: 48,
  poAcceptHours: 6,
  dispatchUpdates: 2,
  gstDocsOk: true,
  challanProvided: true,
  challanDocsUploaded: true,
  poAcceptedAsIs: true,
};

describe("rating engine", () => {
  it("a flawless order rates ~5 stars", () => {
    const r = computeRating(perfect);
    expect(r.criteria).toHaveLength(5);
    expect(r.stars).toBeGreaterThan(4.7);
    expect(r.stars).toBeLessThanOrEqual(5);
  });

  it("late delivery decays linearly per day", () => {
    expect(deliveryScoreFromLots([{ promisedDate: "2026-10-10T00:00:00Z", actualDate: "2026-10-10T00:00:00Z" }])).toBe(100);
    expect(deliveryScoreFromLots([{ promisedDate: "2026-10-10T00:00:00Z", actualDate: "2026-10-12T00:00:00Z" }])).toBe(75);
    expect(deliveryScoreFromLots([{ promisedDate: "2026-10-10T00:00:00Z", actualDate: "2026-10-20T00:00:00Z" }])).toBe(0);
  });

  it("quality reflects acceptance ratio, checks and returns", () => {
    expect(qualityScore(perfect)).toBe(100);
    expect(qualityScore({ ...perfect, acceptedQty: 80, specMatch: false, returnsCount: 1 })).toBe(60);
  });

  it("price compares the final rate with the lowest quote, market and our previous rate", () => {
    const best = computeRating(perfect).criteria.find((c) => c.key === "PRICE")!.score;
    const dear = computeRating({ ...perfect, finalRate: 120 }).criteria.find((c) => c.key === "PRICE")!.score;
    expect(best).toBe(100);
    expect(dear).toBeLessThan(70);
  });

  it("compliance reflects GST documents, challans and accepting the PO as agreed", () => {
    expect(computeRating(perfect).criteria.find((c) => c.key === "COMPLIANCE")!.score).toBe(100);
    const r = computeRating({ ...perfect, challanDocsUploaded: false, poAcceptedAsIs: false });
    expect(r.criteria.find((c) => c.key === "COMPLIANCE")!.score).toBe(60);
  });

  it("a poor order lands in the Poor band", () => {
    const r = computeRating({ ...perfect, finalRate: 130, lots: [{ promisedDate: "2026-10-10T00:00:00Z", actualDate: "2026-10-17T00:00:00Z" }], acceptedQty: 60, specMatch: false, noDamage: false, testCertProvided: false, returnsCount: 2, responseHours: 47, poAcceptHours: 100, dispatchUpdates: 0, gstDocsOk: false, challanProvided: false, challanDocsUploaded: false, poAcceptedAsIs: false });
    expect(r.stars).toBeLessThan(2.5);
    expect(ratingGrade(r.stars, 5).label).toBe("Poor");
  });

  it("manual adjustment moves a pointer by up to ±1 star (20 points)", () => {
    const base = computeRating(perfect).criteria.map((c) => ({ key: c.key, weight: c.weight, autoScore: 70, adjustment: 0 }));
    const up = applyAdjustments(base.map((c) => (c.key === "QUALITY" ? { ...c, adjustment: 1 } : c)));
    expect(up.criteria.find((c) => c.key === "QUALITY")!.finalScore).toBe(90);
    expect(up.totalScore).toBeCloseTo(75);
  });

  it("rolling rating weighs recent orders more", () => {
    expect(rollingRating([])).toBeNull();
    // simple means are 2.75 and 4.25; exponential decay pulls toward the newest order
    expect(rollingRating([5, 2, 2, 2])!).toBeCloseTo(3.02, 2);
    expect(rollingRating([2, 5, 5, 5])!).toBeCloseTo(3.98, 2);
    expect(rollingRating([4, 4, 4])).toBe(4);
  });

  it("grades", () => {
    expect(ratingGrade(4.6, 5).label).toBe("Excellent");
    expect(ratingGrade(4.0, 5).label).toBe("Good");
    expect(ratingGrade(3.0, 5).label).toBe("Average (watch)");
    expect(ratingGrade(4.9, 2).label).toBe("New");
  });
});
