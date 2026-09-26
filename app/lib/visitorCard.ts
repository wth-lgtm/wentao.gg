// The visitor card's content rules, as pure functions the card renders and the tests hold.
// The card's one job is to tell a visitor where they are browsing from, at a glance: the
// PLACE leads (city large, then region and country), the network facts follow, and the
// caption naming the third-party lookups is never dropped (it is the honesty contract).
//
// Screen-class rules live in FIELDS: a field is shown on a class or dropped with
// display:none — never abbreviated, never ellipsised, never cut mid-word. The matrix in the
// PR body and /tmp/.../content-matrix.md is this table.

export type ScreenClass = "P" | "T" | "LS" | "DS" | "XL";

// Tailwind breakpoints: P < 768 ≤ T (md) < 1024 ≤ LS (lg) < 1440 ≤ DS < 1920 ≤ XL.
export type Field =
  | "status"
  | "coords"
  | "map"
  | "city"
  | "place"
  | "ip"
  | "isp"
  | "org"
  | "dist"
  | "peeks"
  | "caption";

// The first class a field appears on; it stays on every wider class.
export const FIELDS: Record<Field, ScreenClass> = {
  status: "P",
  coords: "T", // on a phone the kicker and the coordinates cannot share one line at 14 px
  map: "P",
  city: "P",
  place: "P",
  ip: "P",
  isp: "P",
  org: "T", // a second network row; on a phone the carrier alone says it
  dist: "P",
  peeks: "P",
  caption: "P",
};

const ORDER: ScreenClass[] = ["P", "T", "LS", "DS", "XL"];
export function shownOn(field: Field, cls: ScreenClass): boolean {
  return ORDER.indexOf(cls) >= ORDER.indexOf(FIELDS[field]);
}

// Written out whole, because Tailwind finds classes by scanning source text: a class
// assembled from pieces at runtime would never be generated.
type Display = "contents" | "flex" | "block" | "inline";
const FROM: Record<Exclude<ScreenClass, "P">, Record<Display, string>> = {
  T: { contents: "hidden md:contents", flex: "hidden md:flex", block: "hidden md:block", inline: "hidden md:inline" },
  LS: { contents: "hidden lg:contents", flex: "hidden lg:flex", block: "hidden lg:block", inline: "hidden lg:inline" },
  DS: { contents: "hidden min-[1440px]:contents", flex: "hidden min-[1440px]:flex", block: "hidden min-[1440px]:block", inline: "hidden min-[1440px]:inline" },
  XL: { contents: "hidden min-[1920px]:contents", flex: "hidden min-[1920px]:flex", block: "hidden min-[1920px]:block", inline: "hidden min-[1920px]:inline" },
};

/** Classes for an element shown from the field's first class up ("" = every class). */
export function visibility(field: Field, display: Display = "block"): string {
  const first = FIELDS[field];
  return first === "P" ? "" : FROM[first][display];
}

export function flagFromCode(cc: unknown): string {
  if (typeof cc !== "string" || !/^[A-Za-z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** "United States" for "US" — the browser's own region names, so no table ships. */
export function countryName(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(cc.toUpperCase()) ?? cc.toUpperCase();
  } catch {
    return cc.toUpperCase();
  }
}

/**
 * The place, as two lines: the headline and the line under it.
 * - city known: "Oakland" / "California, United States 🇺🇸"
 * - country only: "United States 🇺🇸" / null — the country is a fact we have; a city we
 *   don't have is not invented, and no distance is measured to a country's centroid.
 * - nothing: null (the card shows its searching / withheld copy instead).
 */
export function placeLines(city: string, region: string, cc: string): { head: string; sub: string | null } | null {
  const c = city.trim();
  const r = region.trim();
  const country = countryName(cc);
  const flag = flagFromCode(cc);
  const withFlag = (s: string) => (flag ? `${s} ${flag}` : s);
  if (c) {
    // A city-state (Singapore, Singapore) or a region that repeats the city says it once.
    const rest = [r && r.toLowerCase() !== c.toLowerCase() ? r : "", country].filter(Boolean).join(", ");
    return { head: c, sub: rest ? withFlag(rest) : flag || null };
  }
  if (country) return { head: withFlag(country), sub: null };
  return null;
}

/** "37.8°N 122.3°W": one decimal (~11 km) — IP geolocation is no better than a city. */
export function formatCoords(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}°${v < 0 ? neg : pos}`;
  return `${f(lat, "N", "S")} ${f(lon, "E", "W")}`;
}

/**
 * An IP in breakable pieces. IPv4 never needs a break; an IPv6 address is up to 39
 * characters with no spaces, so it breaks only AFTER a colon (each piece ends in one),
 * never inside a group. The pieces rejoin byte-identical, so copying the row copies the IP.
 */
export function ipPieces(ip: string): string[] {
  if (!ip.includes(":")) return [ip];
  return ip.split(/(?<=:)/);
}

/** The ORG row: only when it names something the ISP row doesn't. */
export function orgLine(isp: string, org: string): string | null {
  const o = org.trim();
  if (!o) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(o) === norm(isp) ? null : o;
}

// Loopback / private-range IPs (e.g. ::1 on localhost) are never shown; the public IP the
// geo provider saw is preferred.
export function isPrivateIp(ip: string): boolean {
  return (
    !ip ||
    ip === "::1" ||
    ip === "0.0.0.0" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith("fe80") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
}

/**
 * The region out of the edge cookie's "City, Region, Country 🇺🇸" (proxy.ts), so the
 * first paint can already say "California" before /api/geo answers. Only a three-part
 * string has a region in the middle; anything else says nothing rather than guessing.
 */
export function regionFromLocation(location: string, city: string): string {
  const parts = location
    .replace(/\s*[\u{1F1E6}-\u{1F1FF}]{2}\s*$/u, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length === 3 && parts[0] === city.trim() ? parts[1] : "";
}
