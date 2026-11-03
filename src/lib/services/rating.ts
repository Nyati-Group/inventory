import { db } from "../db";
import { num } from "../utils";
import { getSettings } from "../settings";
import { computeRating, applyAdjustments, rollingRating, ratingGrade, type RatingInput, type RatingKey } from "../engine/rating";
import { marketStats, type MarketRate } from "../market-rates";
import { audit } from "../audit";
import { notifyRoles } from "../notifications";
import type { SessionUser } from "../auth";

const hoursBetween = (a: Date | null | undefined, b: Date | null | undefined) =>
  a && b ? Math.max(0, (b.getTime() - a.getTime()) / 3600_000) : null;

/** Gather the automatic inputs for the 5-pointer rating of a closed PO. */
export async function ratingInputsForPo(poId: string): Promise<RatingInput> {
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: {
      items: true,
      vendor: true,
      grns: { include: { items: true, qualityCheck: true } },
      returnRequests: true,
      deliveryUpdates: true,
      quotationVersion: { include: { quotation: { include: { versions: { orderBy: { versionNo: "asc" }, take: 1 }, rfqVendor: true } } } },
      rfq: { include: { quotations: { include: { activeVersion: true } } } },
    },
  });
  const line = po.items[0];
  const finalRate = num(line.unitRate);
  const quoteRates = (po.rfq?.quotations ?? []).map((q) => num(q.activeVersion?.unitRate)).filter((r) => r > 0);
  const snapshot = await db.marketRateSnapshot.findFirst({ where: { materialId: line.materialId, projectId: po.projectId }, orderBy: { fetchedAt: "desc" } });
  const market = snapshot ? marketStats(snapshot.results as unknown as MarketRate[]) : null;
  const prev = await db.rateHistory.findFirst({
    where: { projectId: po.projectId, materialId: line.materialId, date: { lt: po.createdAt }, NOT: { poId: po.id } },
    orderBy: { date: "desc" },
  });
  const changeRequests = await db.auditLog.count({ where: { entityType: "PurchaseOrder", entityId: po.id, action: "CHANGE_REQUESTED" } });
  const promised = po.promisedDeliveryDate ?? po.expectedDeliveryDate;
  const qcs = po.grns.map((g) => g.qualityCheck).filter(Boolean);
  const delivered = po.grns.flatMap((g) => g.items).reduce((s, i) => s + num(i.deliveredQty), 0);
  const accepted = po.grns.flatMap((g) => g.items).reduce((s, i) => s + num(i.acceptedQty), 0);
  const rv = po.quotationVersion?.quotation.rfqVendor;
  const firstVersion = po.quotationVersion?.quotation.versions[0];

  return {
    finalRate,
    lowestQuoteRate: quoteRates.length ? Math.min(...quoteRates) : null,
    marketAvgRate: market?.avg ?? null,
    previousRate: prev ? num(prev.rate) : null,
    promisedDate: promised.toISOString(),
    lots: po.grns.map((g) => ({ promisedDate: promised.toISOString(), actualDate: g.receivedAt.toISOString() })),
    deliveredQty: delivered,
    acceptedQty: accepted,
    specMatch: qcs.every((q) => q!.specMatch),
    noDamage: qcs.every((q) => q!.noDamage),
    testCertProvided: qcs.some((q) => q!.testCertProvided),
    returnsCount: po.returnRequests.length,
    responseHours: hoursBetween(rv?.sentAt, firstVersion?.submittedAt),
    rfqWindowHours: hoursBetween(rv?.sentAt, rv?.deadline),
    poAcceptHours: hoursBetween(po.sentAt, po.acceptedAt),
    dispatchUpdates: po.deliveryUpdates.filter((d) => d.source === "VENDOR").length,
    gstDocsOk: !!po.vendor.gstin,
    challanProvided: po.grns.length > 0 && po.grns.every((g) => !!g.challanNo),
    challanDocsUploaded: po.grns.length > 0 && po.grns.every((g) => !!g.challanKey),
    poAcceptedAsIs: !!po.acceptedAt && changeRequests === 0,
  };
}

export async function computeRatingForPo(poId: string) {
  const existing = await db.vendorRating.findUnique({ where: { poId } });
  if (existing) return existing;
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  const input = await ratingInputsForPo(poId);
  const { ratingWeights } = await getSettings();
  const r = computeRating(input, ratingWeights);
  const rating = await db.vendorRating.create({
    data: {
      vendorId: po.vendorId,
      projectId: po.projectId,
      poId,
      totalScore: r.totalScore,
      stars: r.stars,
      criteria: {
        create: r.criteria.map((c) => ({ key: c.key, weight: c.weight, autoScore: c.score, finalScore: c.score, details: c.details as never })),
      },
    },
  });
  await audit({ label: "system" }, "VendorRating", rating.id, "AUTO_RATED", { after: { stars: r.stars, po: po.number }, projectId: po.projectId });
  await refreshVendorRollups(po.vendorId, po.projectId);
  return rating;
}

/** Update the vendor's rolling overall rating and the per-project rating (feedback loop into scoring). */
export async function refreshVendorRollups(vendorId: string, projectId: string) {
  const all = await db.vendorRating.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, select: { stars: true, projectId: true } });
  const overall = rollingRating(all.map((r) => r.stars));
  const proj = all.filter((r) => r.projectId === projectId);
  const vendor = await db.vendor.update({ where: { id: vendorId }, data: { overallRating: overall, completedOrders: all.length } });
  await db.projectVendor.updateMany({ where: { vendorId, projectId }, data: { rating: rollingRating(proj.map((r) => r.stars)), ratedOrders: proj.length } });
  const grade = ratingGrade(overall, all.length);
  if (grade.label === "Poor" && vendor.status === "ACTIVE")
    await notifyRoles(projectId, ["PROCUREMENT_MANAGER"], {
      type: "VENDOR_POOR",
      title: `${vendor.name} rated Poor (${overall?.toFixed(2)}★)`,
      body: "Consider putting this vendor On hold.",
      link: `/vendors/${vendorId}`,
    });
}

/** Manual override: ±1 star per pointer with mandatory comment (logged). */
export async function adjustRating(
  ratingId: string,
  adjustments: { key: RatingKey; adjustment: number; comment: string }[],
  feedback: string | undefined,
  user: SessionUser,
) {
  const rating = await db.vendorRating.findUniqueOrThrow({ where: { id: ratingId }, include: { criteria: true } });
  for (const a of adjustments) {
    if (a.adjustment < -1 || a.adjustment > 1) throw new Error("Adjustment must be within ±1 star");
    if (a.adjustment !== 0 && !a.comment.trim()) throw new Error("A comment is required for every adjustment");
  }
  const merged = rating.criteria.map((c) => {
    const a = adjustments.find((x) => x.key === c.key);
    return { key: c.key as RatingKey, weight: c.weight, autoScore: c.autoScore, adjustment: a?.adjustment ?? c.adjustment, comment: a?.comment ?? c.comment };
  });
  const r = applyAdjustments(merged);
  await db.$transaction(async (tx) => {
    for (const c of r.criteria) {
      const m = merged.find((x) => x.key === c.key)!;
      await tx.vendorRatingCriterion.update({
        where: { ratingId_key: { ratingId, key: c.key } },
        data: { adjustment: c.adjustment, finalScore: c.finalScore, comment: m.comment },
      });
    }
    await tx.vendorRating.update({ where: { id: ratingId }, data: { totalScore: r.totalScore, stars: r.stars, feedback, overriddenById: user.id } });
    await audit(user, "VendorRating", ratingId, "MANUAL_OVERRIDE", { before: { stars: rating.stars }, after: { stars: r.stars, adjustments, feedback }, projectId: rating.projectId }, tx);
  });
  await refreshVendorRollups(rating.vendorId, rating.projectId);
}
