import { approxRoadKm, transitHoursFor } from "./engine/geo";

export interface DistanceResult {
  km: number;
  hours: number;
  source: "GOOGLE" | "ORS" | "HAVERSINE";
}

type Pt = { lat: number; lng: number };

/** Driving distance with graceful fallback: Google → OpenRouteService → haversine × road factor. */
export async function drivingDistance(from: Pt, to: Pt): Promise<DistanceResult> {
  const provider = process.env.MAPS_PROVIDER ?? "haversine";
  try {
    if (provider === "google" && process.env.GOOGLE_MAPS_API_KEY) {
      const u = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      u.searchParams.set("origins", `${from.lat},${from.lng}`);
      u.searchParams.set("destinations", `${to.lat},${to.lng}`);
      u.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY);
      const j = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json();
      const el = j.rows?.[0]?.elements?.[0];
      if (el?.status === "OK") return { km: el.distance.value / 1000, hours: el.duration.value / 3600 + 1, source: "GOOGLE" };
    }
    if (provider === "ors" && process.env.ORS_API_KEY) {
      const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-hgv", {
        method: "POST",
        headers: { Authorization: process.env.ORS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      const s = j.routes?.[0]?.summary;
      if (s) return { km: s.distance / 1000, hours: s.duration / 3600 + 1, source: "ORS" };
    }
  } catch {
    // fall through to haversine
  }
  const km = approxRoadKm(from, to);
  return { km, hours: transitHoursFor(km), source: "HAVERSINE" };
}

/** Geocode an address (Google, if configured). Returns null when unavailable — UI then asks for a map pin / lat-lng. */
export async function geocode(address: string): Promise<Pt | null> {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("address", address);
      u.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY);
      const j = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json();
      const loc = j.results?.[0]?.geometry?.location;
      if (loc) return { lat: loc.lat, lng: loc.lng };
    } catch {
      /* ignore */
    }
  }
  if (process.env.ORS_API_KEY) {
    try {
      const u = new URL("https://api.openrouteservice.org/geocode/search");
      u.searchParams.set("api_key", process.env.ORS_API_KEY);
      u.searchParams.set("text", address);
      u.searchParams.set("size", "1");
      const j = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json();
      const c = j.features?.[0]?.geometry?.coordinates;
      if (c) return { lat: c[1], lng: c[0] };
    } catch {
      /* ignore */
    }
  }
  return CITY_COORDS[address.split(",").map((s) => s.trim().toLowerCase()).find((p) => CITY_COORDS[p]) ?? ""] ?? null;
}

/** Offline city-centroid fallback so distance works without any maps key. */
export const CITY_COORDS: Record<string, Pt> = {
  pune: { lat: 18.5204, lng: 73.8567 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  "navi mumbai": { lat: 19.033, lng: 73.0297 },
  thane: { lat: 19.2183, lng: 72.9781 },
  nashik: { lat: 19.9975, lng: 73.7898 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chakan: { lat: 18.7606, lng: 73.8636 },
  pimpri: { lat: 18.6298, lng: 73.7997 },
  hinjewadi: { lat: 18.5913, lng: 73.7389 },
  hosur: { lat: 12.7409, lng: 77.8253 },
  tumkur: { lat: 13.3379, lng: 77.1173 },
  satara: { lat: 17.6805, lng: 74.0183 },
  ahmednagar: { lat: 19.0952, lng: 74.7496 },
  panvel: { lat: 18.9894, lng: 73.1175 },
  bhiwandi: { lat: 19.2813, lng: 73.0483 },
  secunderabad: { lat: 17.4399, lng: 78.4983 },
};
