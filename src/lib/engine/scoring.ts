// Comparison & recommendation engine (§8). Pure — no I/O — so it is unit-testable and
// can be re-run live in the browser for the what-if sliders.

export interface Weights {
  price: number;
  delivery: number;
  proximity: number;
  rating: number;
  commercial: number;
}

export const DEFAULT_WEIGHTS: Weights = { price: 40, delivery: 20, proximity: 10, rating: 20, commercial: 10 };
export const NEW_VENDOR_RATING = 3.5;
export const NEW_VENDOR_MIN_ORDERS = 3;

export interface QuoteInput {
  vendorId: string;
  vendorName: string;
  versionId: string;
  landedCost: number;
  unitRate: number;
  quantityOffered: number;
  deliveryDate: string | null; // ISO, promised by vendor
  distanceKm: number | null;
  transitHours: number | null;
  serviceRadiusKm: number;
  vendorRating: number | null; // 0–5
  completedOrders: number;
  onTimePct: number | null;
  creditDays: number | null;
  validityDays: number | null;
  warranty: string | null;
  deviations: string[];
  blacklisted: boolean;
  quoteSubmittedAt: string;
}

export interface ScoringContext {
  quantityRequired: number;
  expectedDate: string; // ISO
  maxDelayDays: number;
  now?: string;
}

export interface ScoredQuote extends QuoteInput {
  unitLanded: number;
  daysLate: number | null;
  effectiveRating: number;
  isNewVendor: boolean;
  priceScore: number;
  deliveryScore: number;
  proximityScore: number;
  ratingScore: number;
  commercialScore: number;
  totalScore: number;
  rank: number | null;
  disqualified: boolean;
  disqualifyReasons: string[];
  badges: string[];
}

export interface SplitSuggestion {
  parts: { vendorId: string; vendorName: string; quantity: number; unitLanded: number; cost: number }[];
  totalCost: number;
}

export interface ComparisonResult {
  scored: ScoredQuote[];
  recommended: ScoredQuote | null;
  runnerUp: ScoredQuote | null;
  explanation: string;
  whyNotCheapest: string | null;
  split: SplitSuggestion | null;
  averageLanded: number | null;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const DAY = 86_400_000;

export function normaliseWeights(w: Weights): Weights {
  const sum = w.price + w.delivery + w.proximity + w.rating + w.commercial;
  if (sum <= 0) return DEFAULT_WEIGHTS;
  const f = 100 / sum;
  return {
    price: w.price * f,
    delivery: w.delivery * f,
    proximity: w.proximity * f,
    rating: w.rating * f,
    commercial: w.commercial * f,
  };
}

export function deliveryScore(daysLate: number | null, maxDelayDays: number) {
  if (daysLate === null) return 50; // unknown promise — neutral
  if (daysLate <= 0) return 100;
  if (daysLate > maxDelayDays) return 0;
  return clamp(100 * (1 - daysLate / (maxDelayDays + 1)));
}

export function proximityScore(distanceKm: number | null, serviceRadiusKm: number, transitHours: number | null) {
  if (distanceKm === null) return 50;
  if (distanceKm > serviceRadiusKm) return 0;
  let s = 100 - (distanceKm / Math.max(serviceRadiusKm, 1)) * 70;
  if (transitHours !== null && transitHours > 24) s -= 10;
  return clamp(s, 0, 100);
}

export function commercialScore(q: Pick<QuoteInput, "creditDays" | "validityDays" | "warranty" | "deviations">) {
  const credit = Math.min((q.creditDays ?? 0) / 45, 1) * 40;
  const validity = Math.min((q.validityDays ?? 0) / 30, 1) * 20;
  const warranty = q.warranty && q.warranty.trim() ? 10 : 0;
  const devs = Math.max(0, 30 - 10 * q.deviations.length);
  return clamp(credit + validity + warranty + devs);
}

export function scoreQuotes(quotes: QuoteInput[], ctx: ScoringContext, weightsIn: Weights = DEFAULT_WEIGHTS): ComparisonResult {
  const w = normaliseWeights(weightsIn);
  const now = ctx.now ? new Date(ctx.now).getTime() : Date.now();
  const expected = new Date(ctx.expectedDate).getTime();

  const prelim = quotes.map((q) => {
    const unitLanded = q.quantityOffered > 0 ? q.landedCost / q.quantityOffered : Infinity;
    const daysLate = q.deliveryDate ? Math.ceil((new Date(q.deliveryDate).getTime() - expected) / DAY) : null;
    const isNewVendor = q.completedOrders < NEW_VENDOR_MIN_ORDERS || q.vendorRating === null;
    const effectiveRating = isNewVendor ? NEW_VENDOR_RATING : (q.vendorRating as number);
    const reasons: string[] = [];
    if (q.blacklisted) reasons.push("Vendor is blacklisted");
    if (q.quantityOffered + 1e-9 < ctx.quantityRequired)
      reasons.push(`Cannot meet quantity (${q.quantityOffered} of ${ctx.quantityRequired})`);
    if (daysLate !== null && daysLate > ctx.maxDelayDays)
      reasons.push(`Delivery ${daysLate} days late (max ${ctx.maxDelayDays})`);
    if (q.validityDays !== null && q.validityDays > 0) {
      const validTill = new Date(q.quoteSubmittedAt).getTime() + q.validityDays * DAY;
      if (validTill < now) reasons.push("Quotation validity expired");
    }
    return { q, unitLanded, daysLate, isNewVendor, effectiveRating, reasons };
  });

  const qualifiedUnit = prelim.filter((p) => p.reasons.length === 0).map((p) => p.unitLanded);
  const lowestUnit = Math.min(...(qualifiedUnit.length ? qualifiedUnit : prelim.map((p) => p.unitLanded)));

  const scored: ScoredQuote[] = prelim.map((p) => {
    const priceScore = Number.isFinite(p.unitLanded) && p.unitLanded > 0 ? clamp((100 * lowestUnit) / p.unitLanded) : 0;
    const dScore = deliveryScore(p.daysLate, ctx.maxDelayDays);
    const pScore = proximityScore(p.q.distanceKm, p.q.serviceRadiusKm, p.q.transitHours);
    const rScore = clamp(p.effectiveRating * 20);
    const cScore = commercialScore(p.q);
    const total =
      (priceScore * w.price + dScore * w.delivery + pScore * w.proximity + rScore * w.rating + cScore * w.commercial) / 100;
    return {
      ...p.q,
      unitLanded: p.unitLanded,
      daysLate: p.daysLate,
      effectiveRating: p.effectiveRating,
      isNewVendor: p.isNewVendor,
      priceScore: round1(priceScore),
      deliveryScore: round1(dScore),
      proximityScore: round1(pScore),
      ratingScore: round1(rScore),
      commercialScore: round1(cScore),
      totalScore: round1(total),
      rank: null,
      disqualified: p.reasons.length > 0,
      disqualifyReasons: p.reasons,
      badges: [],
    };
  });

  const qualified = scored.filter((s) => !s.disqualified).sort((a, b) => b.totalScore - a.totalScore || a.landedCost - b.landedCost);
  qualified.forEach((s, i) => (s.rank = i + 1));

  // Badges across qualified quotes (or all if none qualify)
  const pool = qualified.length ? qualified : scored;
  if (pool.length) {
    const cheapest = [...pool].sort((a, b) => a.unitLanded - b.unitLanded)[0];
    cheapest.badges.push("Lowest cost");
    const withDate = pool.filter((s) => s.deliveryDate);
    if (withDate.length) [...withDate].sort((a, b) => +new Date(a.deliveryDate!) - +new Date(b.deliveryDate!))[0].badges.push("Fastest delivery");
    [...pool].sort((a, b) => b.effectiveRating - a.effectiveRating)[0].badges.push("Best rated");
  }

  const recommended = qualified[0] ?? null;
  const runnerUp = qualified[1] ?? null;
  // Average over comparable (qualified) quotes; a partial-quantity quote would otherwise drag it down.
  const landedAll = (qualified.length ? qualified : scored).filter((s) => Number.isFinite(s.landedCost)).map((s) => s.landedCost);
  const averageLanded = landedAll.length ? landedAll.reduce((a, b) => a + b, 0) / landedAll.length : null;

  const explanation = recommended ? explain(recommended, runnerUp, averageLanded, ctx) : noRecommendation(scored);
  const cheapestQualified = qualified.length ? [...qualified].sort((a, b) => a.landedCost - b.landedCost)[0] : null;
  const whyNotCheapest =
    recommended && cheapestQualified && cheapestQualified.vendorId !== recommended.vendorId
      ? whyNot(recommended, cheapestQualified)
      : null;

  const split = suggestSplit(scored, ctx.quantityRequired, ctx.maxDelayDays);

  return { scored: [...qualified, ...scored.filter((s) => s.disqualified)], recommended, runnerUp, explanation, whyNotCheapest, split, averageLanded };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function money(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function deliveryPhrase(s: ScoredQuote) {
  if (s.daysLate === null) return "has not committed a delivery date";
  if (s.daysLate < 0) return `delivers ${-s.daysLate} day${s.daysLate === -1 ? "" : "s"} before need`;
  if (s.daysLate === 0) return "delivers on the required date";
  return `delivers ${s.daysLate} day${s.daysLate === 1 ? "" : "s"} late`;
}

function ratingPhrase(s: ScoredQuote) {
  if (s.isNewVendor) return `is a new vendor (neutral ${NEW_VENDOR_RATING}★ used)`;
  const onTime = s.onTimePct !== null ? ` with ${Math.round(s.onTimePct)}% on-time` : "";
  return `is rated ${s.effectiveRating.toFixed(1)}★${onTime}`;
}

function explain(r: ScoredQuote, runner: ScoredQuote | null, avg: number | null, _ctx: ScoringContext) {
  const parts: string[] = [];
  let price = money(r.landedCost);
  if (avg && avg > 0) {
    const diff = ((avg - r.landedCost) / avg) * 100;
    price += diff >= 0 ? ` (${diff.toFixed(1)}% below the average quote)` : ` (${(-diff).toFixed(1)}% above the average quote)`;
  }
  parts.push(price);
  parts.push(deliveryPhrase(r));
  if (r.distanceKm !== null) parts.push(`${Math.round(r.distanceKm)} km from site`);
  parts.push(ratingPhrase(r).replace(/^is /, ""));
  let text = `${r.vendorName} is recommended (score ${r.totalScore}/100): ${parts.join(", ")}.`;
  if (runner) {
    const delta = runner.landedCost - r.landedCost;
    const cmp =
      delta < 0
        ? `is cheaper by ${money(-delta)} but ${deliveryPhrase(runner)} and ${ratingPhrase(runner)}`
        : `costs ${money(delta)} more, ${deliveryPhrase(runner)} and ${ratingPhrase(runner)}`;
    text += ` Runner-up ${runner.vendorName} (score ${runner.totalScore}) ${cmp}.`;
  }
  return text;
}

function whyNot(r: ScoredQuote, cheapest: ScoredQuote) {
  const reasons: string[] = [];
  if (cheapest.deliveryScore < r.deliveryScore) reasons.push(deliveryPhrase(cheapest));
  if (cheapest.ratingScore < r.ratingScore) reasons.push(ratingPhrase(cheapest));
  if (cheapest.proximityScore < r.proximityScore && cheapest.distanceKm !== null)
    reasons.push(`is farther from site (${Math.round(cheapest.distanceKm)} km)`);
  if (cheapest.commercialScore < r.commercialScore) reasons.push("offers weaker commercial terms");
  const saving = r.landedCost - cheapest.landedCost;
  return `${cheapest.vendorName} is ${money(saving)} cheaper, but ${reasons.join(", ") || "scores lower overall"} — its overall score is ${cheapest.totalScore} vs ${r.totalScore}.`;
}

function noRecommendation(scored: ScoredQuote[]) {
  if (!scored.length) return "No quotations received yet.";
  return "No vendor passes all hard filters. Review the disqualification reasons, consider a split order, or re-issue the RFQ.";
}

/** Suggest awarding to two vendors when no single eligible vendor can supply the full quantity. */
export function suggestSplit(scored: ScoredQuote[], required: number, maxDelayDays: number): SplitSuggestion | null {
  const fullOk = scored.some((s) => !s.disqualified);
  if (fullOk) return null;
  const eligible = scored
    .filter((s) => !s.blacklisted && s.quantityOffered > 0 && (s.daysLate === null || s.daysLate <= maxDelayDays))
    .sort((a, b) => a.unitLanded - b.unitLanded);
  if (eligible.length < 2) return null;
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if (a.quantityOffered + b.quantityOffered >= required) {
        const qa = Math.min(a.quantityOffered, required);
        const qb = required - qa;
        const parts = [
          { vendorId: a.vendorId, vendorName: a.vendorName, quantity: qa, unitLanded: a.unitLanded, cost: qa * a.unitLanded },
          ...(qb > 0
            ? [{ vendorId: b.vendorId, vendorName: b.vendorName, quantity: qb, unitLanded: b.unitLanded, cost: qb * b.unitLanded }]
            : []),
        ];
        return { parts, totalCost: parts.reduce((s, p) => s + p.cost, 0) };
      }
    }
  }
  return null;
}

/** Vendor fit score used to order vendors in the RFQ form (§4.2). 0–100. */
export function vendorFitScore(v: {
  distanceKm: number | null;
  serviceRadiusKm: number;
  leadTimeDays: number;
  transitHours: number | null;
  daysUntilNeed: number;
  rating: number | null;
  completedOrders: number;
  preferred?: boolean;
}) {
  const withinRadius = v.distanceKm === null || v.distanceKm <= v.serviceRadiusKm;
  const etaDays = v.leadTimeDays + Math.ceil((v.transitHours ?? 8) / 10);
  const canMeet = etaDays <= v.daysUntilNeed;
  const feasibility = (withinRadius ? 50 : 0) + (canMeet ? 50 : Math.max(0, 50 - (etaDays - v.daysUntilNeed) * 10));
  const prox = proximityScore(v.distanceKm, v.serviceRadiusKm, v.transitHours);
  const rating = (v.completedOrders < NEW_VENDOR_MIN_ORDERS || v.rating === null ? NEW_VENDOR_RATING : v.rating) * 20;
  return round1(feasibility * 0.4 + prox * 0.2 + rating * 0.4 + (v.preferred ? 5 : 0));
}
