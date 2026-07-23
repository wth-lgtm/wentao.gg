// Shared reader for the `visitor-greeting-data` cookie set by proxy.ts (Vercel edge
// middleware). Client-side only. Everything here is the visitor's OWN data echoed back
// to them for the hero's greeting + "visitor intel" card — nothing is persisted.

export interface VisitorData {
  timePeriod: string;
  location: string; // "City, Region, Country 🇺🇸" (may be "")
  ip: string; // visitor's own IP (may be "")
  lat: number | null; // approximate latitude (may be null off-grid / on localhost)
  lon: number | null; // approximate longitude
}

const EMPTY: VisitorData = {
  timePeriod: "morning",
  location: "",
  ip: "",
  lat: null,
  lon: null,
};

function toCoord(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function getVisitorData(): VisitorData {
  if (typeof document === "undefined") return EMPTY;

  const match = document.cookie.match(/visitor-greeting-data=([^;]+)/);
  if (!match) return EMPTY;

  try {
    // The cookie is written once URL-encoded; occasionally double-encoded in transit.
    let raw = decodeURIComponent(match[1]);
    if (raw.includes("%")) raw = decodeURIComponent(raw);
    const parsed = JSON.parse(raw) as Partial<VisitorData>;
    const lat = toCoord(parsed.lat);
    const lon = toCoord(parsed.lon);
    // Treat the null-island (0,0) placeholder some edges emit as "no fix".
    const hasFix = lat !== null && lon !== null && !(lat === 0 && lon === 0);
    return {
      timePeriod: parsed.timePeriod || "morning",
      location: parsed.location || "",
      ip: typeof parsed.ip === "string" ? parsed.ip : "",
      lat: hasFix ? lat : null,
      lon: hasFix ? lon : null,
    };
  } catch {
    return EMPTY;
  }
}
