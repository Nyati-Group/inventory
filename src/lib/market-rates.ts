import { z } from "zod";
import { db } from "./db";
import { num } from "./utils";
import { llmAvailable, llmJson } from "./llm";
import { convertRate, canonicalUnit } from "./engine/units";
import { approxRoadKm } from "./engine/geo";
import { CITY_COORDS } from "./geo";

export interface MarketRate {
  supplier: string;
  city: string | null;
  rate: number; // as quoted
  unit: string; // as quoted
  normalisedRate: number | null; // ₹ per material unit
  sourceUrl: string | null;
  sourceSite?: string | null;
  availability: string | null;
  distanceKm?: number | null;
  inVendorBook?: boolean;
}

export interface MaterialQuery {
  name: string;
  spec: string | null;
  unit: string;
  category: string;
}

/** Provider interface — implementations search the public web for indicative prices. */
export interface MarketRateProvider {
  name: string;
  isDemo: boolean;
  search(m: MaterialQuery, city: string): Promise<MarketRate[]>;
}

type Snippet = { title: string; url: string; content: string };

const PriceList = z.object({
  prices: z.array(
    z.object({
      supplier: z.string(),
      city: z.string(),
      rate: z.number(),
      unit: z.string(),
      source_url: z.string(),
      availability: z.string(),
    }),
  ),
});

async function extractPrices(m: MaterialQuery, snippets: Snippet[]): Promise<MarketRate[]> {
  if (!snippets.length) return [];
  if (llmAvailable()) {
    const out = await llmJson({
      system:
        "Extract indicative Indian market prices for the requested construction material from web search snippets. Only include prices explicitly present in the snippets, for the same material/grade. Use the snippet URL as source_url. Use \"\" for unknown text.",
      parts: [
        {
          text: `Material: ${m.name}${m.spec ? ` (${m.spec})` : ""}, unit ${m.unit}.\n\n${snippets
            .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.content}`)
            .join("\n\n")}`,
        },
      ],
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prices: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                supplier: { type: "string" },
                city: { type: "string" },
                rate: { type: "number" },
                unit: { type: "string" },
                source_url: { type: "string" },
                availability: { type: "string" },
              },
              required: ["supplier", "city", "rate", "unit", "source_url", "availability"],
            },
          },
        },
        required: ["prices"],
      },
      validate: PriceList,
    });
    return out.prices.map((p) => ({
      supplier: p.supplier || "Unknown supplier",
      city: p.city || null,
      rate: p.rate,
      unit: p.unit || m.unit,
      normalisedRate: convertRate(p.rate, p.unit || m.unit, m.unit),
      sourceUrl: p.source_url || null,
      availability: p.availability || null,
    }));
  }
  // Regex fallback: "₹ 380 per bag", "Rs. 52,000/tonne"
  const re = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per)\s*([a-zA-Z³]+)/gi;
  const out: MarketRate[] = [];
  for (const s of snippets) {
    for (const mm of s.content.matchAll(re)) {
      const rate = Number(mm[1].replace(/,/g, ""));
      const unit = mm[2];
      if (!canonicalUnit(unit)) continue;
      out.push({
        supplier: s.title.slice(0, 60),
        city: null,
        rate,
        unit,
        normalisedRate: convertRate(rate, unit, m.unit),
        sourceUrl: s.url,
        availability: null,
      });
    }
  }
  return out;
}

class TavilyProvider implements MarketRateProvider {
  name = "tavily";
  isDemo = false;
  async search(m: MaterialQuery, city: string) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: `${m.name} ${m.spec ?? ""} price per ${m.unit} ${city} India supplier`,
        max_results: 8,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const j = (await res.json()) as { results: { title: string; url: string; content: string }[] };
    return extractPrices(m, j.results ?? []);
  }
}

class SerperProvider implements MarketRateProvider {
  name = "serper";
  isDemo = false;
  async search(m: MaterialQuery, city: string) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ q: `${m.name} ${m.spec ?? ""} price per ${m.unit} ${city}`, gl: "in", num: 10 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const j = (await res.json()) as { organic?: { title: string; link: string; snippet: string }[] };
    return extractPrices(m, (j.organic ?? []).map((o) => ({ title: o.title, url: o.link, content: o.snippet })));
  }
}

const WebPriceList = z.object({
  prices: z.array(
    z.object({
      supplier: z.string(),
      city: z.string(),
      rate: z.number(),
      unit: z.string(),
      source_site: z.string(),
      source_url: z.string(),
      availability: z.string(),
    }),
  ),
});

/** Gemini with Google Search grounding: searches the live web and returns the listings it found. */
class GeminiSearchProvider implements MarketRateProvider {
  name = "gemini-search";
  isDemo = false;
  async search(m: MaterialQuery, city: string) {
    const material = `${m.name}${m.spec ? ` (${m.spec})` : ""}`;
    const out = await llmJson({
      webSearch: true,
      system:
        "You find current indicative market prices for construction materials in India using Google Search. " +
        "Only report prices you actually found on a web page in the search results (supplier sites, IndiaMART, TradeIndia, JustDial, dealer price lists, news). Never estimate or invent a price. " +
        "Match the same material and grade; skip listings for a different grade or product. Prefer suppliers in or near the given city, then elsewhere in the same state. " +
        `Rates are in INR, excluding GST where the page says so. If the listing is in the requested unit, set unit to exactly "${m.unit}"; otherwise give the unit as written (e.g. "50 kg bag", "tonne", "kg"). ` +
        'source_site is the website name or domain (e.g. "indiamart.com"); source_url is the page link. availability: stock or delivery note if stated, else "". Return up to 8 listings; an empty list if none were found.',
      parts: [{ text: `Material: ${material}. Category: ${m.category}. Requested unit: ${m.unit}. Project site: ${city}, India. Find current prices per ${m.unit}.` }],
      schema: {
        type: "object",
        properties: {
          prices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                supplier: { type: "string" },
                city: { type: "string" },
                rate: { type: "number" },
                unit: { type: "string" },
                source_site: { type: "string" },
                source_url: { type: "string" },
                availability: { type: "string" },
              },
              required: ["supplier", "city", "rate", "unit", "source_site", "source_url", "availability"],
            },
          },
        },
        required: ["prices"],
      },
      validate: WebPriceList,
    });
    return out.prices
      .filter((p) => p.rate > 0)
      .map((p) => ({
        supplier: p.supplier || p.source_site || "Online listing",
        city: p.city || null,
        rate: p.rate,
        unit: p.unit || m.unit,
        normalisedRate: convertRate(p.rate, p.unit || m.unit, m.unit),
        sourceUrl: /^https?:\/\//.test(p.source_url) ? p.source_url : null,
        sourceSite: p.source_site || null,
        availability: p.availability || null,
      }));
  }
}

/**
 * Demo provider — used when no search API key is configured. Results are synthetic, derived from our own
 * purchase history, and are clearly labelled as demo data in the UI.
 */
class DemoProvider implements MarketRateProvider {
  name = "demo";
  isDemo = true;
  constructor(private baseRate: number) {}
  async search(m: MaterialQuery, city: string) {
    const nearby = Object.keys(CITY_COORDS).filter((c) => c !== city.toLowerCase()).slice(0, 3);
    const seed = [...m.name].reduce((a, c) => a + c.charCodeAt(0), 0);
    const cities = [city, ...nearby.map((c) => c[0].toUpperCase() + c.slice(1))];
    return Array.from({ length: 5 }, (_, i) => {
      const f = 0.9 + (((seed * (i + 3)) % 23) / 100);
      const rate = Math.round(this.baseRate * f);
      return {
        supplier: `Demo market listing ${String.fromCharCode(65 + i)}`,
        city: cities[i % cities.length],
        rate,
        unit: m.unit,
        normalisedRate: rate,
        sourceUrl: null,
        availability: i % 4 === 3 ? "Limited stock" : "In stock",
      };
    });
  }
}

export function marketProvider(baseRate: number): MarketRateProvider {
  const p = process.env.MARKET_RATE_PROVIDER;
  if (p === "tavily" && process.env.TAVILY_API_KEY) return new TavilyProvider();
  if (p === "serper" && process.env.SERPER_API_KEY) return new SerperProvider();
  // Gemini web search is the default whenever a Gemini key is set (unless MARKET_RATE_PROVIDER="demo").
  if (p !== "demo" && llmAvailable()) return new GeminiSearchProvider();
  return new DemoProvider(baseRate);
}

const TTL_MS = 24 * 3600_000;

/** Cached (24 h) market rates for a material near a project. `force` bypasses the cache (Refresh button). */
export async function getMarketRates(materialId: string, projectId: string, force = false) {
  if (!force) {
    // Once a real search provider is configured, old simulated (demo) snapshots are not reused.
    const live = !marketProvider(0).isDemo;
    const cached = await db.marketRateSnapshot.findFirst({
      where: { materialId, projectId, expiresAt: { gt: new Date() }, ...(live ? { provider: { not: "demo" } } : {}) },
      orderBy: { fetchedAt: "desc" },
    });
    if (cached) return cached;
  }
  const [material, project, stock] = await Promise.all([
    db.material.findUniqueOrThrow({ where: { id: materialId }, include: { category: true } }),
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    db.materialProjectStock.findUnique({ where: { projectId_materialId: { projectId, materialId } } }),
  ]);
  const lastAny = await db.rateHistory.findFirst({ where: { materialId }, orderBy: { date: "desc" } });
  const base = num(stock?.lastRate) || num(lastAny?.rate) || 100;
  const provider = marketProvider(base);
  let results: MarketRate[] = [];
  let error: string | null = null;
  try {
    results = await provider.search({ name: material.name, spec: material.spec, unit: material.unit, category: material.category.name }, project.city);
  } catch (e) {
    error = `Market rate search failed: ${(e as Error).message}`;
  }
  // Rank by proximity to the project site, flag suppliers already in the vendor book
  const book = await db.projectVendor.findMany({ where: { projectId }, include: { vendor: { select: { name: true } } } });
  const bookNames = book.map((b) => b.vendor.name.toLowerCase());
  for (const r of results) {
    const c = r.city ? CITY_COORDS[r.city.toLowerCase()] : undefined;
    r.distanceKm = c && project.lat && project.lng ? approxRoadKm({ lat: project.lat, lng: project.lng }, c) : null;
    r.inVendorBook = bookNames.some((n) => n.includes(r.supplier.toLowerCase()) || r.supplier.toLowerCase().includes(n));
  }
  results.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  return db.marketRateSnapshot.create({
    data: {
      materialId,
      projectId,
      provider: provider.name,
      query: `${material.name} ${material.spec ?? ""} near ${project.city}`,
      results: results as never,
      error,
      expiresAt: new Date(Date.now() + (error ? 15 * 60_000 : TTL_MS)),
    },
  });
}

export function marketStats(results: MarketRate[]) {
  const rates = results.map((r) => r.normalisedRate).filter((x): x is number => typeof x === "number" && x > 0);
  if (!rates.length) return null;
  return {
    avg: rates.reduce((a, b) => a + b, 0) / rates.length,
    min: Math.min(...rates),
    max: Math.max(...rates),
    count: rates.length,
  };
}
