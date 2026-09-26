import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FIELDS,
  countryName,
  displayIp,
  flagFromCode,
  formatCoords,
  ipPieces,
  isPrivateIp,
  orgLine,
  placeLines,
  regionFromLocation,
  shownOn,
  visibility,
  type Field,
  type ScreenClass,
} from "../app/lib/visitorCard";

// The visitor card's content rules: what it says about where you are, on which screens,
// and at what size. The card's job is one glance — "you're in Oakland, California" — so
// the place leads, nothing is truncated, and the providers' caption is never dropped.

const US = flagFromCode("US");

test("placeLines: the city leads, region and country follow, the flag closes", () => {
  assert.deepEqual(placeLines("Oakland", "California", "US"), { head: "Oakland", sub: `California, United States ${US}` });
  // A region that repeats the city says it once.
  assert.deepEqual(placeLines("Tokyo", "Tokyo", "JP"), { head: "Tokyo", sub: `Japan ${flagFromCode("JP")}` });
  // No region: the country alone.
  assert.deepEqual(placeLines("London", "", "GB"), { head: "London", sub: `United Kingdom ${flagFromCode("GB")}` });
  // Whitespace from a provider is not a value.
  assert.deepEqual(placeLines("  Oakland ", " ", "US"), { head: "Oakland", sub: `United States ${US}` });
});

test("placeLines: a country-only fix says the country and invents no city", () => {
  assert.deepEqual(placeLines("", "", "US"), { head: `United States ${US}`, sub: null });
  assert.equal(placeLines("", "", ""), null);
  assert.equal(placeLines("", "Kansas", "zz!"), null);
});

test("countryName / flagFromCode: the browser's own names, and nothing for junk", () => {
  assert.equal(countryName("us"), "United States");
  assert.equal(countryName("DE"), "Germany");
  assert.equal(countryName(""), "");
  assert.equal(countryName("USA"), "");
  assert.equal(flagFromCode("us"), "\u{1F1FA}\u{1F1F8}");
  assert.equal(flagFromCode("U"), "");
  assert.equal(flagFromCode(42), "");
});

test("formatCoords: one decimal, hemispheres spelled, nothing for a bad fix", () => {
  assert.equal(formatCoords(37.7749, -122.4194), "37.8°N 122.4°W");
  assert.equal(formatCoords(-33.8688, 151.2093), "33.9°S 151.2°E");
  assert.equal(formatCoords(0, 0), "0.0°N 0.0°E");
  assert.equal(formatCoords(null, 10), null);
  assert.equal(formatCoords(NaN, 10), null);
  assert.equal(formatCoords(91, 10), null);
});

test("ipPieces: IPv6 breaks only after a colon, and rejoins byte-identical", () => {
  assert.deepEqual(ipPieces("203.0.113.42"), ["203.0.113.42"]);
  const v6 = "2001:db8:1f2b:4c00:8d3a:77ff:fe12:9abc";
  const parts = ipPieces(v6);
  assert.equal(parts.join(""), v6);
  assert.ok(parts.slice(0, -1).every((p) => p.endsWith(":")));
  assert.ok(parts.every((p) => p.length <= 5), "no piece longer than one group and its colon");
  assert.equal(ipPieces("2001:db8::1").join(""), "2001:db8::1");
});

test("orgLine: only when it names something the ISP doesn't", () => {
  assert.equal(orgLine("Example Telecom K.K.", "Example Telecom K.K."), null);
  assert.equal(orgLine("Example Telecom K.K.", "example telecom kk"), null);
  assert.equal(orgLine("Zayo Bandwidth", "Mercor.io Corporation"), "Mercor.io Corporation");
  assert.equal(orgLine("Zayo Bandwidth", "  "), null);
});

test("isPrivateIp: loopback and private ranges are never shown", () => {
  for (const ip of ["", "::1", "127.0.0.1", "10.1.2.3", "192.168.0.4", "172.16.0.1", "172.31.9.9", "fe80::1", "fd00::2"])
    assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["203.0.113.42", "172.32.0.1", "2001:db8::1", "8.8.8.8"]) assert.ok(!isPrivateIp(ip), ip);
});

test("displayIp: the cookie's public IP, else the lookup's, never a private one", () => {
  assert.equal(displayIp("203.0.113.42", "198.51.100.7"), "203.0.113.42"); // the instant one wins
  assert.equal(displayIp("::1", "198.51.100.7"), "198.51.100.7"); // localhost: the lookup's
  assert.equal(displayIp("127.0.0.1", ""), ""); // every lookup failed: "hidden", not 127.0.0.1
  assert.equal(displayIp("", "10.0.0.2"), "");
});

test("regionFromLocation: the edge cookie's middle part, or nothing", () => {
  assert.equal(regionFromLocation(`Oakland, California, United States ${US}`, "Oakland"), "California");
  assert.equal(regionFromLocation(`London, United Kingdom ${flagFromCode("GB")}`, "London"), "");
  assert.equal(regionFromLocation(`Kansas, United States ${US}`, ""), "");
  assert.equal(regionFromLocation("Oakland, California, United States", "Berkeley"), "");
});

test("FIELDS: the place, the IP, the distance and the caption are on every screen", () => {
  const classes: ScreenClass[] = ["P", "T", "LS", "DS", "XL"];
  const always: Field[] = ["status", "map", "city", "place", "ip", "isp", "dist", "peeks", "caption"];
  for (const f of always) for (const c of classes) assert.ok(shownOn(f, c), `${f} on ${c}`);
  // Phones drop the two second-order facts; tablets and up show them.
  for (const f of ["coords", "org"] as Field[]) {
    assert.ok(!shownOn(f, "P"), `${f} dropped on phones`);
    for (const c of classes.slice(1)) assert.ok(shownOn(f, c), `${f} on ${c}`);
  }
  // A field, once shown, stays shown on every wider class.
  for (const f of Object.keys(FIELDS) as Field[]) {
    const seen = classes.map((c) => shownOn(f, c));
    assert.ok(seen.every((s, i) => i === 0 || s || !seen[i - 1]), `${f} monotone`);
  }
  // The classes the card renders are literal Tailwind classes (the scanner sees them).
  assert.equal(visibility("org", "contents"), "hidden md:contents");
  assert.equal(visibility("coords", "inline"), "hidden md:inline");
  assert.equal(visibility("ip"), "");
});

// ── The type ramp (globals.css "VISITOR CARD") against the site scale ──────────────
// DESIGN-3D §1.8: phones meta ≥ 15 px; laptop and up meta 16–19; the headline a rung above.
function ramp(): Record<string, Record<string, string>> {
  const css = readFileSync("app/globals.css", "utf8");
  const out: Record<string, Record<string, string>> = {};
  const grab = (key: string, body: string) => {
    out[key] = { ...(out[key] ?? {}) };
    for (const m of body.matchAll(/--vc-(label|head|meta|caption):\s*([^;]+);/g)) out[key][m[1]] = m[2].trim();
  };
  const base = css.match(/\n\.vcard \{([^}]*)\}/);
  assert.ok(base, ".vcard block");
  grab("P", base[1]);
  for (const [bp, key] of [["768px", "T"], ["1440px", "DS"], ["1920px", "XL"]] as const) {
    const m = css.match(new RegExp(`@media \\(min-width: ${bp}\\) \\{\\s*\\.vcard \\{([^}]*)\\}`));
    assert.ok(m, `.vcard at ${bp}`);
    grab(key, m[1]);
  }
  // Each class inherits what it doesn't restate.
  out.T = { ...out.P, ...out.T };
  out.LS = { ...out.T };
  out.DS = { ...out.LS, ...out.DS };
  out.XL = { ...out.DS, ...out.XL };
  return out;
}
// A value in px at a viewport width: "17px" or "clamp(15px, 4.1vw, 16px)".
function px(v: string, vw: number): number {
  const c = v.match(/^clamp\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)vw,\s*(\d+(?:\.\d+)?)px\)$/);
  if (c) return Math.min(+c[3], Math.max(+c[1], (+c[2] * vw) / 100));
  const p = v.match(/^(\d+(?:\.\d+)?)px$/);
  assert.ok(p, `unparsed size ${v}`);
  return +p[1];
}

test("type ramp: phones (375 / 390 / 430) clear the floors", () => {
  const r = ramp().P;
  for (const vw of [375, 390, 430]) {
    assert.ok(px(r.meta, vw) >= 15, `meta ${px(r.meta, vw)} at ${vw}`);
    assert.ok(px(r.caption, vw) >= 15, `caption at ${vw}`);
    assert.ok(px(r.label, vw) >= 14, `label at ${vw}`);
    assert.ok(px(r.head, vw) >= 22 && px(r.head, vw) > px(r.meta, vw) + 5, `headline a rung above meta at ${vw}`);
  }
});

test("type ramp: laptop and up sit in 16–19 for meta, and never shrink as the screen grows", () => {
  const all = ramp();
  const at: [ScreenClass, number][] = [["T", 768], ["LS", 1280], ["DS", 1440], ["XL", 1920]];
  for (const [cls, vw] of at.slice(1)) {
    const m = px(all[cls].meta, vw);
    assert.ok(m >= 16 && m <= 19, `${cls} meta ${m}`);
    assert.ok(px(all[cls].head, vw) >= 24, `${cls} headline`);
  }
  let prev = { label: 0, head: 0, meta: 0, caption: 0 };
  for (const [cls, vw] of [["P", 430] as [ScreenClass, number], ...at]) {
    const cur = { label: px(all[cls].label, vw), head: px(all[cls].head, vw), meta: px(all[cls].meta, vw), caption: px(all[cls].caption, vw) };
    for (const k of Object.keys(cur) as (keyof typeof cur)[]) assert.ok(cur[k] >= prev[k], `${k} shrinks at ${cls}`);
    prev = cur;
  }
});
