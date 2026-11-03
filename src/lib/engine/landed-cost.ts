export interface LandedLine {
  quantity: number;
  unitRate: number;
  gstPercent: number;
}

export interface LandedInput {
  items: LandedLine[];
  freight?: number;
  loading?: number;
  other?: number;
  statedTotal?: number | null;
}

export interface LandedResult {
  subtotal: number;
  gstTotal: number;
  charges: number;
  landedCost: number;
  mismatch: boolean;
  mismatchAmount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Landed cost = Σ(qty × rate) + GST on lines + freight + loading + other.
 * Flags a mismatch when the vendor's stated total differs by more than max(₹10, 0.5 %).
 */
export function computeLanded(input: LandedInput): LandedResult {
  let subtotal = 0;
  let gstTotal = 0;
  for (const l of input.items) {
    const amt = l.quantity * l.unitRate;
    subtotal += amt;
    gstTotal += (amt * (l.gstPercent || 0)) / 100;
  }
  const charges = (input.freight ?? 0) + (input.loading ?? 0) + (input.other ?? 0);
  const landedCost = r2(subtotal + gstTotal + charges);
  let mismatch = false;
  let mismatchAmount = 0;
  if (input.statedTotal !== null && input.statedTotal !== undefined && input.statedTotal > 0) {
    mismatchAmount = r2(input.statedTotal - landedCost);
    const tolerance = Math.max(10, landedCost * 0.005);
    mismatch = Math.abs(mismatchAmount) > tolerance;
  }
  return { subtotal: r2(subtotal), gstTotal: r2(gstTotal), charges: r2(charges), landedCost, mismatch, mismatchAmount };
}
