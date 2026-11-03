import { db } from "../db";
import { num, numOrNull } from "../utils";
import { scoreQuotes, type QuoteInput, type Weights, type ComparisonResult } from "../engine/scoring";

export async function vendorOnTimePct(vendorIds: string[]) {
  const rows = await db.vendorRatingCriterion.findMany({
    where: { key: "DELIVERY", rating: { vendorId: { in: vendorIds } } },
    select: { autoScore: true, rating: { select: { vendorId: true } } },
  });
  const map = new Map<string, { on: number; total: number }>();
  for (const r of rows) {
    const m = map.get(r.rating.vendorId) ?? { on: 0, total: 0 };
    m.total += 1;
    if (r.autoScore >= 99.9) m.on += 1;
    map.set(r.rating.vendorId, m);
  }
  return (id: string) => {
    const m = map.get(id);
    return m && m.total ? (m.on / m.total) * 100 : null;
  };
}

export function projectWeights(s: { weightPrice: number; weightDelivery: number; weightProximity: number; weightRating: number; weightCommercial: number } | null): Weights {
  if (!s) return { price: 40, delivery: 20, proximity: 10, rating: 20, commercial: 10 };
  return { price: s.weightPrice, delivery: s.weightDelivery, proximity: s.weightProximity, rating: s.weightRating, commercial: s.weightCommercial };
}

/** Load everything needed to score an RFQ's active quotations. */
export async function comparisonInputs(rfqId: string) {
  const rfq = await db.rFQ.findUniqueOrThrow({
    where: { id: rfqId },
    include: {
      items: { include: { material: true } },
      project: { include: { settings: true } },
      vendors: { include: { vendor: true } },
      quotations: { include: { activeVersion: true, vendor: true } },
    },
  });
  const pvs = await db.projectVendor.findMany({ where: { projectId: rfq.projectId, vendorId: { in: rfq.vendors.map((v) => v.vendorId) } } });
  const pvBy = new Map(pvs.map((p) => [p.vendorId, p]));
  const onTime = await vendorOnTimePct(rfq.vendors.map((v) => v.vendorId));
  const item = rfq.items[0];

  const quotes: QuoteInput[] = rfq.quotations
    .filter((q) => q.activeVersion && q.activeVersion.landedCost !== null && q.rfqVendorId)
    .map((q) => {
      const v = q.activeVersion!;
      const pv = pvBy.get(q.vendorId);
      const projectRated = pv && pv.ratedOrders >= 3 && pv.rating !== null;
      return {
        vendorId: q.vendorId,
        vendorName: q.vendor.name,
        versionId: v.id,
        landedCost: num(v.landedCost),
        unitRate: num(v.unitRate),
        quantityOffered: v.quantity !== null ? num(v.quantity) : num(item.quantity),
        deliveryDate: v.deliveryDate?.toISOString() ?? null,
        distanceKm: pv?.distanceKm ?? null,
        transitHours: pv?.transitHours ?? null,
        serviceRadiusKm: q.vendor.serviceRadiusKm,
        vendorRating: projectRated ? num(pv!.rating) : numOrNull(q.vendor.overallRating),
        completedOrders: q.vendor.completedOrders,
        onTimePct: onTime(q.vendorId),
        creditDays: v.creditDays,
        validityDays: v.validityDays,
        warranty: v.warranty,
        deviations: v.deviations,
        blacklisted: q.vendor.status === "BLACKLISTED" || !!pv?.isBlacklisted,
        quoteSubmittedAt: v.submittedAt.toISOString(),
      };
    });

  const ctx = {
    quantityRequired: num(item.quantity),
    expectedDate: rfq.expectedDeliveryDate.toISOString(),
    maxDelayDays: rfq.project.settings?.maxDelayDays ?? 7,
  };
  return { rfq, item, quotes, ctx, weights: projectWeights(rfq.project.settings) };
}

/** Re-score and persist a ComparisonRun. Called on every new/revised/confirmed quotation. */
export async function recomputeComparison(rfqId: string): Promise<ComparisonResult & { runId: string }> {
  const { rfq, quotes, ctx, weights } = await comparisonInputs(rfqId);
  const result = scoreQuotes(quotes, ctx, weights);
  const responded = rfq.vendors.filter((v) => v.status === "RESPONDED").length;

  const run = await db.$transaction(async (tx) => {
    await tx.comparisonRun.updateMany({ where: { rfqId, isLatest: true }, data: { isLatest: false } });
    return tx.comparisonRun.create({
      data: {
        rfqId,
        weights: weights as never,
        recommendedVendorId: result.recommended?.vendorId ?? null,
        runnerUpVendorId: result.runnerUp?.vendorId ?? null,
        explanation: result.explanation,
        whyNotCheapest: result.whyNotCheapest,
        splitSuggestion: (result.split ?? undefined) as never,
        respondedCount: responded,
        invitedCount: rfq.vendors.length,
        scores: {
          create: result.scored.map((s) => ({
            vendorId: s.vendorId,
            quotationVersionId: s.versionId,
            landedCost: s.landedCost,
            priceScore: s.priceScore,
            deliveryScore: s.deliveryScore,
            proximityScore: s.proximityScore,
            ratingScore: s.ratingScore,
            commercialScore: s.commercialScore,
            totalScore: s.totalScore,
            rank: s.rank,
            disqualified: s.disqualified,
            disqualifyReason: s.disqualifyReasons.join("; ") || null,
            badges: s.badges,
          })),
        },
      },
    });
  });
  return { ...result, runId: run.id };
}
