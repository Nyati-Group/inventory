// Unit normalisation. Each unit maps to a dimension and a factor relative to that dimension's base unit.
// Base units: weight=kg, volume=m3, count=nos, length=m, area=sqm.

type Dim = "weight" | "volume" | "count" | "length" | "area";

const UNITS: Record<string, { dim: Dim; factor: number }> = {
  kg: { dim: "weight", factor: 1 },
  g: { dim: "weight", factor: 0.001 },
  quintal: { dim: "weight", factor: 100 },
  qtl: { dim: "weight", factor: 100 },
  tonne: { dim: "weight", factor: 1000 },
  ton: { dim: "weight", factor: 1000 },
  t: { dim: "weight", factor: 1000 },
  mt: { dim: "weight", factor: 1000 },
  bag: { dim: "weight", factor: 50 }, // standard 50 kg cement bag
  m3: { dim: "volume", factor: 1 },
  cum: { dim: "volume", factor: 1 },
  cbm: { dim: "volume", factor: 1 },
  cft: { dim: "volume", factor: 0.0283168 },
  brass: { dim: "volume", factor: 2.83168 }, // 100 cft
  l: { dim: "volume", factor: 0.001 },
  ltr: { dim: "volume", factor: 0.001 },
  litre: { dim: "volume", factor: 0.001 },
  nos: { dim: "count", factor: 1 },
  no: { dim: "count", factor: 1 },
  pcs: { dim: "count", factor: 1 },
  pc: { dim: "count", factor: 1 },
  each: { dim: "count", factor: 1 },
  unit: { dim: "count", factor: 1 },
  m: { dim: "length", factor: 1 },
  rm: { dim: "length", factor: 1 },
  rmt: { dim: "length", factor: 1 },
  ft: { dim: "length", factor: 0.3048 },
  coil: { dim: "length", factor: 90 }, // standard 90 m wire coil
  sqm: { dim: "area", factor: 1 },
  sqft: { dim: "area", factor: 0.092903 },
};

const ALIASES: Record<string, string> = {
  bags: "bag",
  kgs: "kg",
  coils: "coil",
  "cu.m": "m3",
  "cu m": "m3",
  "cubic meter": "m3",
  "cubic metre": "m3",
  "m³": "m3",
  "cu.ft": "cft",
  "cubic feet": "cft",
  tonnes: "tonne",
  tons: "ton",
  "metric ton": "mt",
  number: "nos",
  numbers: "nos",
  pieces: "pcs",
  piece: "pcs",
  litres: "litre",
  liters: "litre",
  liter: "litre",
  "sq.ft": "sqft",
  "sq ft": "sqft",
  "sq.m": "sqm",
  "sq m": "sqm",
  meter: "m",
  metre: "m",
  meters: "m",
  metres: "m",
  "running meter": "rm",
};

export function canonicalUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  let s = u.trim().toLowerCase().replace(/^per\s+/, "").replace(/^\/\s*/, "");
  s = ALIASES[s] ?? s;
  if (UNITS[s]) return s;
  const stripped = s.replace(/[.\s]/g, "");
  if (UNITS[stripped]) return stripped;
  return null;
}

export function sameDimension(a: string, b: string) {
  const ca = canonicalUnit(a);
  const cb = canonicalUnit(b);
  return !!ca && !!cb && UNITS[ca].dim === UNITS[cb].dim;
}

/**
 * Dimension and base-unit factor of a unit. Besides plain units it understands pack sizes as written on
 * web listings and quotations: "50 kg bag", "40kg bag", "20 L can", "per 1000 nos", "25 kg".
 */
export function unitInfo(u: string | null | undefined): { dim: Dim; factor: number } | null {
  if (!u) return null;
  const c = canonicalUnit(u);
  if (c) return UNITS[c];
  const s = u.trim().toLowerCase().replace(/^per\s+/, "").replace(/^\/\s*/, "");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([a-z³.]+(?:\s[a-z]+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  const base = canonicalUnit(m[2]) ?? canonicalUnit(m[2].split(/\s/)[0]);
  if (!base || !(n > 0)) return null;
  return { dim: UNITS[base].dim, factor: n * UNITS[base].factor };
}

/** Convert a quantity expressed in `from` units to `to` units. Returns null if incompatible. */
export function convertQty(q: number, from: string, to: string): number | null {
  const cf = unitInfo(from);
  const ct = unitInfo(to);
  if (!cf || !ct || cf.dim !== ct.dim) return null;
  return (q * cf.factor) / ct.factor;
}

/** Convert a rate (₹ per `from`) into ₹ per `to`. Returns null if incompatible. */
export function convertRate(rate: number, from: string, to: string): number | null {
  const cf = unitInfo(from);
  const ct = unitInfo(to);
  if (!cf || !ct || cf.dim !== ct.dim) return null;
  return (rate * ct.factor) / cf.factor;
}
