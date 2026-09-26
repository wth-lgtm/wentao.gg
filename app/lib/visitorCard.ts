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
  // Laptops and up. Below 1024 the card is at most 383 px wide (a phone, or the hero's 5/12
  // column on a tablet), where the kicker and the worst case ("33.9°S 151.2°E") cannot share
  // one line.
  coords: "LS",
  map: "P",
  city: "P",
  place: "P",
  ip: "P",
  isp: "P",
  // Every class. Often the most striking fact on the card (a company's name on office Wi-Fi,
  // "Mercor.io Corporation" behind "Zayo Bandwidth"). The row is always there, like ISP and
  // DIST, so the card's height is final from the first paint; when orgLine finds nothing the
  // ISP doesn't already say, it reads "—".
  org: "P",
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

/** Classes for an element shown from the field's first class up: on every class that is the
 *  display itself (a `contents` row stays `contents`, not a grid item). */
export function visibility(field: Field, display: Display = "block"): string {
  const first = FIELDS[field];
  return first === "P" ? display : FROM[first][display];
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

/** The ORG row's value: only when it names something the ISP row doesn't (else "—"). */
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
 * The IP the card prints: the edge cookie's (instant) when it is public, else the one the
 * lookup saw, else nothing — the row then reads "hidden". It used to fall back to the
 * cookie's value even when that was private, so a localhost visit whose lookups all failed
 * printed "127.0.0.1" on a card whose rule is that it never shows one.
 */
export function displayIp(cookieIp: string, lookupIp: string): string {
  if (!isPrivateIp(cookieIp)) return cookieIp;
  return isPrivateIp(lookupIp) ? "" : lookupIp;
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

// ── The caption: the honesty contract ────────────────────────────────────────────────
// Resolving the city hands the visitor's IP to ip-api (via /api/geo) and, when that comes back
// thin, to ipinfo, ipwho.is and geojs straight from the browser. So the caption names them in
// EVERY state, not only once a place is showing: while the lookups are running, and when all
// four came back empty (they were still asked). Each state is the same shape and about the same
// length, and the card reserves the tallest of the three from the first paint (VisitorIntel), so
// it doesn't change height when one replaces another. All three fit one line of a 1280-wide
// laptop's card at 17 px (measured in place: 409 / 421 / 420 px of 423), where the short-window
// budget is tightest; the emoji is the found state's alone, the width the others don't have.
export type CaptionState = "looking" | "found" | "none";
export const CAPTION_STATES: readonly CaptionState[] = ["looking", "found", "none"];
export const CAPTIONS: Record<CaptionState, string> = {
  looking: "asking ip-api, ipinfo, ipwho, geojs\u00A0— nothing\u00A0stored",
  found: "via ip-api, ipinfo, ipwho or geojs\u00A0— nothing\u00A0stored\u00A0\u{1F91D}",
  none: "ip-api, ipinfo, ipwho, geojs: no dice\u00A0— nothing\u00A0stored",
};
