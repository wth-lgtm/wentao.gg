// Great-circle maths for the visitor card. Everything here is derived from the lat/lon
// the geo lookup already returned — zero extra network, no new data collected.

export type LatLon = { lat: number; lon: number };

// Where Wentao actually is. The distance readout is phrased from HIS side ("4,130 KM
// AWAY"), which reads as him telling you where he stands rather than the site pointing
// at you.
export const HOME: LatLon = { lat: 37.7749, lon: -122.4194 }; // San Francisco, CA

const R_KM = 6371.0088; // IUGG mean Earth radius
const KM_PER_MI = 1.609344;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km (haversine). */
export function greatCircleKm(a: LatLon, b: LatLon): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(b.lon - a.lon);
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toVec = ({ lat, lon }: LatLon): [number, number, number] => {
  const p = rad(lat);
  const l = rad(lon);
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};

/**
 * `steps + 1` points along the TRUE great circle between a and b, slerped on the unit
 * sphere. Not a curve bowed in projection space: on an equirectangular map the real
 * route from San Francisco to London bows NORTH, and a perpendicular quadratic would
 * bow it the wrong way entirely.
 */
export function greatCirclePoints(a: LatLon, b: LatLon, steps: number): LatLon[] {
  const A = toVec(a);
  const B = toVec(b);
  const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const omega = Math.acos(dot);
  // Coincident (or antipodal, where the route is undefined) → just the endpoints.
  if (omega < 1e-9 || Math.abs(Math.PI - omega) < 1e-9) return [a, b];
  const sin = Math.sin(omega);
  const out: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w1 = Math.sin((1 - t) * omega) / sin;
    const w2 = Math.sin(t * omega) / sin;
    const x = A[0] * w1 + B[0] * w2;
    const y = A[1] * w1 + B[1] * w2;
    const z = A[2] * w1 + B[2] * w2;
    out.push({ lat: deg(Math.asin(Math.min(1, Math.max(-1, z)))), lon: deg(Math.atan2(y, x)) });
  }
  return out;
}

/**
 * Human-facing distance. IP geolocation is city-accurate at best, so the trailing
 * digits are noise that visibly changes between reloads — round hard. Imperial for
 * the US and UK, metric everywhere else.
 */
export function formatDistance(km: number, cc: string): string {
  const imperial = cc === "US" || cc === "GB";
  const value = imperial ? km / KM_PER_MI : km;
  const unit = imperial ? "MI" : "KM";
  // Same metro: a number here would read as a rounding bug, and a good slice of the
  // audience is in the Bay Area.
  if (km < 25) return "SAME FOG AS YOU";
  const rounded = value < 100 ? Math.round(value / 5) * 5 : Math.round(value / 10) * 10;
  return `${rounded.toLocaleString("en-US")} ${unit} AWAY`;
}
