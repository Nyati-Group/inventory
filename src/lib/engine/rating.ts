// Vendor rating engine (§12). Pure functions; the service layer gathers the inputs.

export type RatingKey = "PRICE" | "DELIVERY" | "QUALITY" | "RESPONSIVENESS" | "COMPLIANCE";

export type RatingWeights = Record<RatingKey, number>;

export const DEFAULT_RATING_WEIGHTS: RatingWeights = {
  PRICE: 25,
  DELIVERY: 25,
  QUALITY: 25,
  RESPONSIVENESS: 15,
  COMPLIANCE: 10,
};

export const RATING_LABELS: Record<RatingKey, string> = {
  PRICE: "Price Competitiveness",
  DELIVERY: "Delivery Timeliness",
  QUALITY: "Quality & Quantity Accuracy",
  RESPONSIVENESS: "Responsiveness & Communication",
  COMPLIANCE: "Commercial & Documentation Compliance",
};

export interface RatingInput {
  // price
  finalRate: number;
  lowestQuoteRate: number | null;
  marketAvgRate: number | null;
  previousRate: number | null;
  // delivery
  promisedDate: string; // ISO
  lots: { promisedDate: string; actualDate: string }[]; // one per GRN
  // quality
  deliveredQty: number;
  acceptedQty: number;
  specMatch: boolean;
  noDamage: boolean;
  testCertProvided: boolean;
  returnsCount: number;
  // responsiveness
  responseHours: number | null; // RFQ sent → quotation submitted
  rfqWindowHours: number | null; // RFQ sent → deadline
  poAcceptHours: number | null;
  dispatchUpdates: number;
  // commercial & documentation compliance
  gstDocsOk: boolean; // vendor GSTIN on file
  challanProvided: boolean; // challan number recorded on every GRN
  challanDocsUploaded: boolean; // challan scan attached on every GRN
  poAcceptedAsIs: boolean; // PO accepted without change requests (agreed terms honoured)
}

export interface CriterionResult {
  key: RatingKey;
  weight: number;
  score: number; // 0–100
  details: Record<string, number | string | boolean | null>;
}

export interface RatingResult {
  criteria: CriterionResult[];
  totalScore: number; // 0–100
  stars: number; // 0–5
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
const DAY = 86_400_000;

export function priceScore(i: RatingInput) {
  let s = i.lowestQuoteRate && i.finalRate > 0 ? (100 * i.lowestQuoteRate) / i.finalRate : 85;
  if (i.marketAvgRate) s += clamp(((i.marketAvgRate - i.finalRate) / i.marketAvgRate) * 100, -15, 10);
  if (i.previousRate) s += clamp(((i.previousRate - i.finalRate) / i.previousRate) * 50, -10, 5);
  return clamp(s);
}

export function lotLateDays(lot: { promisedDate: string; actualDate: string }) {
  return Math.max(0, Math.ceil((new Date(lot.actualDate).getTime() - new Date(lot.promisedDate).getTime()) / DAY));
}

/** On-time = 100; −12.5 per day late (0 at 8 days). Averaged over lots. */
export function deliveryScoreFromLots(lots: { promisedDate: string; actualDate: string }[]) {
  if (!lots.length) return 50;
  const perLot = lots.map((l) => clamp(100 - lotLateDays(l) * 12.5));
  return perLot.reduce((a, b) => a + b, 0) / perLot.length;
}

export function qualityScore(i: RatingInput) {
  const ratio = i.deliveredQty > 0 ? i.acceptedQty / i.deliveredQty : 0;
  let s = ratio * 50 + (i.specMatch ? 20 : 0) + (i.noDamage ? 15 : 0) + (i.testCertProvided ? 15 : 0);
  s -= i.returnsCount * 10;
  return clamp(s);
}

export function responsivenessScore(i: RatingInput) {
  let quote = 20; // unknown
  if (i.responseHours !== null && i.rfqWindowHours && i.rfqWindowHours > 0) {
    quote = clamp((1 - i.responseHours / i.rfqWindowHours) * 40 + 10, 10, 40);
  }
  let accept = 15;
  if (i.poAcceptHours !== null) accept = i.poAcceptHours <= 24 ? 30 : i.poAcceptHours <= 72 ? 20 : 5;
  const dispatch = i.dispatchUpdates >= 2 ? 30 : i.dispatchUpdates === 1 ? 22 : 8;
  return clamp(quote + accept + dispatch);
}

export function complianceScore(i: RatingInput) {
  return (i.gstDocsOk ? 30 : 0) + (i.challanProvided ? 30 : 0) + (i.challanDocsUploaded ? 20 : 0) + (i.poAcceptedAsIs ? 20 : 0);
}

export function computeRating(i: RatingInput, weights: RatingWeights = DEFAULT_RATING_WEIGHTS): RatingResult {
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0) || 100;
  const lots = i.lots.length ? i.lots : [];
  const criteria: CriterionResult[] = [
    {
      key: "PRICE",
      weight: weights.PRICE,
      score: r1(priceScore(i)),
      details: {
        finalRate: i.finalRate,
        lowestQuoteRate: i.lowestQuoteRate,
        marketAvgRate: i.marketAvgRate,
        previousRate: i.previousRate,
      },
    },
    {
      key: "DELIVERY",
      weight: weights.DELIVERY,
      score: r1(deliveryScoreFromLots(lots)),
      details: { lots: lots.length, maxDaysLate: lots.length ? Math.max(...lots.map(lotLateDays)) : null },
    },
    {
      key: "QUALITY",
      weight: weights.QUALITY,
      score: r1(qualityScore(i)),
      details: {
        deliveredQty: i.deliveredQty,
        acceptedQty: i.acceptedQty,
        specMatch: i.specMatch,
        noDamage: i.noDamage,
        testCertProvided: i.testCertProvided,
        returns: i.returnsCount,
      },
    },
    {
      key: "RESPONSIVENESS",
      weight: weights.RESPONSIVENESS,
      score: r1(responsivenessScore(i)),
      details: { responseHours: i.responseHours, poAcceptHours: i.poAcceptHours, dispatchUpdates: i.dispatchUpdates },
    },
    {
      key: "COMPLIANCE",
      weight: weights.COMPLIANCE,
      score: r1(complianceScore(i)),
      details: {
        gstDocsOk: i.gstDocsOk,
        challanProvided: i.challanProvided,
        challanDocsUploaded: i.challanDocsUploaded,
        poAcceptedAsIs: i.poAcceptedAsIs,
      },
    },
  ];
  const total = criteria.reduce((s, c) => s + c.score * c.weight, 0) / totalW;
  return { criteria, totalScore: r1(total), stars: Math.round((total / 20) * 100) / 100 };
}

/** Re-total after manual ±1 star adjustments (1 star = 20 points). */
export function applyAdjustments(
  criteria: { key: RatingKey; weight: number; autoScore: number; adjustment: number }[],
) {
  const finals = criteria.map((c) => ({ ...c, finalScore: clamp(c.autoScore + c.adjustment * 20) }));
  const totalW = finals.reduce((s, c) => s + c.weight, 0) || 100;
  const total = finals.reduce((s, c) => s + c.finalScore * c.weight, 0) / totalW;
  return { criteria: finals, totalScore: r1(total), stars: Math.round((total / 20) * 100) / 100 };
}

/** Rolling rating: exponential decay toward recent orders (most recent first). */
export function rollingRating(starsNewestFirst: number[], decay = 0.8): number | null {
  if (!starsNewestFirst.length) return null;
  let num = 0;
  let den = 0;
  starsNewestFirst.forEach((s, i) => {
    const w = Math.pow(decay, i);
    num += s * w;
    den += w;
  });
  return Math.round((num / den) * 100) / 100;
}

export function ratingGrade(stars: number | null, completedOrders: number) {
  if (stars === null || completedOrders < 3) return { label: "New", tone: "neutral" as const };
  if (stars >= 4.5) return { label: "Excellent", tone: "success" as const };
  if (stars >= 3.5) return { label: "Good", tone: "brand" as const };
  if (stars >= 2.5) return { label: "Average (watch)", tone: "warning" as const };
  return { label: "Poor", tone: "danger" as const };
}
