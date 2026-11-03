const ROAD_FACTOR = 1.3; // straight-line → approx. driving distance
const AVG_TRUCK_KMPH = 35;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function approxRoadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.round(haversineKm(a, b) * ROAD_FACTOR * 10) / 10;
}

/** Transit hours for a loaded truck incl. ~1 h loading/unloading. */
export function transitHoursFor(km: number) {
  return Math.round((km / AVG_TRUCK_KMPH + 1) * 10) / 10;
}

/** Estimated days from order to site: vendor lead time + transit (rounded up to whole days). */
export function estimatedDeliveryDays(leadTimeDays: number, transitHours: number | null) {
  return leadTimeDays + Math.ceil((transitHours ?? 8) / 10);
}
