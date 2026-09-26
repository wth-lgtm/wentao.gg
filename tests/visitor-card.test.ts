import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CAPTIONS,
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

test("CAPTIONS: every state names all four lookups and says nothing is stored", () => {
  for (const [state, text] of Object.entries(CAPTIONS)) {
    for (const p of ["ip-api", "ipinfo", "ipwho", "geojs"]) assert.ok(text.includes(p), `${state} names ${p}`);
    assert.ok(text.includes("nothing\u00A0stored"), `${state} says nothing is stored`);
    // The dash is tied to the word before it, so no line ever starts with "—".
    assert.ok(!/ —/.test(text) && text.includes("\u00A0—"), `${state}: the dash never starts a line`);
  }
  // One shape, about one length: swapping states doesn't change the card's height.
  const lens = Object.values(CAPTIONS).map((t) => [...t].length);
  assert.ok(Math.max(...lens) - Math.min(...lens) <= 8, `lengths ${lens}`);
  // Each is one line of a 457 px card at 17 px (measured in place ≤ 421 px of 423): ≤ 54 code points.
  for (const [state, text] of Object.entries(CAPTIONS)) assert.ok([...text].length <= 54, `${state} is ${[...text].length} code points`);
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

test("FIELDS: every fact about you is on every screen; only the coordinates wait for a laptop", () => {
  const classes: ScreenClass[] = ["P", "T", "LS", "DS", "XL"];
  const always: Field[] = ["status", "map", "city", "place", "ip", "isp", "org", "dist", "peeks", "caption"];
  for (const f of always) for (const c of classes) assert.ok(shownOn(f, c), `${f} on ${c}`);
  // The coordinates can't share the kicker's line in a card under 384 px (phones, and the
  // tablet's 5/12 column); laptops and up show them.
  for (const c of ["P", "T"] as ScreenClass[]) assert.ok(!shownOn("coords", c), `coords dropped on ${c}`);
  for (const c of classes.slice(2)) assert.ok(shownOn("coords", c), `coords on ${c}`);
  // A field, once shown, stays shown on every wider class.
  for (const f of Object.keys(FIELDS) as Field[]) {
    const seen = classes.map((c) => shownOn(f, c));
    assert.ok(seen.every((s, i) => i === 0 || s || !seen[i - 1]), `${f} monotone`);
  }
  // The classes the card renders are literal Tailwind classes (the scanner sees them).
  assert.equal(visibility("org", "contents"), "contents"); // an every-class row keeps its display
  assert.equal(visibility("coords", "inline"), "hidden lg:inline");
  assert.equal(visibility("ip"), "block");
});

// ── The type ramp (globals.css "VISITOR CARD") against the site scale ──────────────
// The card's type is the chapters' scale (DESIGN-3D §1.8) row for row, at the scale's own
// screen classes (§1.1), height included. The CSS is evaluated here as a browser would: the
// base .vcard block, then every `@media (…) { .vcard { … } }` whose conditions hold at the
// window, in source order.
type Win = [number, number];
function cardVars(w: number, h: number): Record<string, string> {
  const css = readFileSync("app/globals.css", "utf8");
  const section = css.slice(css.indexOf("/* ===== VISITOR CARD"));
  const out: Record<string, string> = {};
  const grab = (body: string) => {
    for (const m of body.matchAll(/--vc-([a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  };
  const base = section.match(/\n\.vcard \{([^}]*)\}/);
  assert.ok(base, ".vcard block");
  grab(base[1]);
  for (const m of section.matchAll(/@media ([^{]+)\{\s*\.vcard \{([^}]*)\}\s*\}/g)) {
    const conds = m[1].trim().split(/\s+and\s+/);
    const holds = conds.every((c) => {
      const q = c.match(/^\((min|max)-(width|height):\s*(\d+)px\)$/);
      assert.ok(q, `unparsed media condition ${c}`);
      const v = q[2] === "width" ? w : h;
      return q[1] === "min" ? v >= +q[3] : v <= +q[3];
    });
    if (holds) grab(m[2]);
  }
  return out;
}
// A value in px at a viewport width: "17px" or "clamp(15px, 4.1vw, 17px)".
function px(v: string, vw: number): number {
  const c = v.match(/^clamp\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)vw,\s*(\d+(?:\.\d+)?)px\)$/);
  if (c) return Math.min(+c[3], Math.max(+c[1], (+c[2] * vw) / 100));
  const p = v.match(/^(\d+(?:\.\d+)?)px$/);
  assert.ok(p, `unparsed size ${v}`);
  return +p[1];
}
function type(w: number, h: number) {
  const v = cardVars(w, h);
  return { label: px(v.label, w), head: px(v.head, w), meta: px(v.meta, w), caption: px(v.caption, w) };
}

// §1.1, in its order: L by height first, then width, then short/tall.
type Cls = "P" | "L" | "T" | "LS" | "LT" | "DS" | "DT" | "XL";
function screenClass(w: number, h: number): Cls {
  if (h <= 500) return "L";
  if (w < 768) return "P";
  if (w < 1024) return "T";
  if (w < 1440) return h < 800 ? "LS" : "LT";
  if (w < 1920) return h < 800 ? "DS" : "DT";
  return h >= 800 ? "XL" : "DS";
}
const clampPx = (lo: number, vw: number, hi: number) => (w: number) => Math.min(hi, Math.max(lo, (vw * w) / 100));
// §1.8, transcribed (px). `kicker` is the category kicker (mono caps; phones have none, and
// use the index numeral's 14).
const SCALE: Record<Cls, { kicker: number; meta: (w: number) => number; role: (w: number) => number; name: (w: number) => number }> = {
  P: { kicker: 14, meta: clampPx(15, 4.1, 17), role: clampPx(18, 4.9, 20), name: clampPx(26, 7.2, 31) },
  L: { kicker: 14, meta: () => 15, role: () => 18, name: () => 26 },
  T: { kicker: 16, meta: () => 18, role: () => 23, name: () => 38 },
  LS: { kicker: 16, meta: () => 17, role: () => 21, name: () => 36 },
  LT: { kicker: 16, meta: () => 18, role: () => 23, name: () => 40 },
  DS: { kicker: 16, meta: () => 18, role: () => 23, name: () => 42 },
  DT: { kicker: 17, meta: () => 19, role: () => 25, name: () => 46 },
  XL: { kicker: 18, meta: () => 20, role: () => 28, name: () => 48 },
};
// Each class's reference windows (§1.1), plus the short laptops the review measured.
const WINDOWS: Win[] = [
  [360, 800], [375, 667], [390, 844], [430, 932],
  [844, 390], [932, 430],
  [768, 1024], [820, 1180], [900, 700],
  [1024, 768], [1280, 720], [1280, 633], [1366, 657],
  [1280, 800], [1180, 820], [1024, 1366],
  [1440, 789],
  [1440, 900], [1512, 982], [1728, 1117],
  [1920, 1080], [2560, 1440], [1920, 780],
];
const r1 = (n: number) => Math.round(n * 10) / 10;

test("type ramp: labels are the kicker row, data rows and the caption the meta row, at every class", () => {
  for (const [w, h] of WINDOWS) {
    const cls = screenClass(w, h);
    const t = type(w, h);
    const s = SCALE[cls];
    // T's one exception: the card is in the hero's 5/12 column there (277–383 px, narrower
    // than a phone's card), so it takes the phone row at its floor, as L does.
    const row = cls === "T" ? SCALE.L : s;
    assert.equal(t.label, row.kicker, `${w}x${h} (${cls}) label`);
    assert.equal(r1(t.meta), r1(row.meta(w)), `${w}x${h} (${cls}) meta`);
    assert.equal(t.caption, t.meta, `${w}x${h} (${cls}) caption = meta`);
  }
});

test("type ramp: the city sits a rung above role and under name, and clears 24 on phones", () => {
  for (const [w, h] of WINDOWS) {
    const cls = screenClass(w, h);
    const t = type(w, h);
    const s = SCALE[cls === "T" ? "L" : cls]; // T takes the phone row at its floor (see above)
    assert.ok(t.head > s.role(w) + 3 && t.head < s.name(w), `${w}x${h} (${cls}) city ${t.head} vs role ${s.role(w)} / name ${s.name(w)}`);
    if (cls === "P" || cls === "L" || cls === "T") assert.ok(t.head >= 24, `${w}x${h} city ${t.head} under the phone name floor`);
  }
});

test("type ramp: the binding floors (laptop and up meta ≥ 16, kicker ≥ 16; phones meta ≥ 15)", () => {
  for (const [w, h] of WINDOWS) {
    const cls = screenClass(w, h);
    const t = type(w, h);
    if (cls === "P" || cls === "L" || cls === "T") {
      assert.ok(t.meta >= 15 && t.caption >= 15, `${w}x${h} phone-row meta ${t.meta}`);
      assert.ok(t.label >= 14, `${w}x${h} phone label ${t.label}`);
    } else {
      for (const k of ["meta", "caption", "label"] as const) assert.ok(t[k] >= 16, `${w}x${h} (${cls}) ${k} ${t[k]}`);
    }
  }
});

test("type ramp: never shrinks as the card widens, at a fixed height", () => {
  // The card NARROWS once, from a 430 phone (382 px) to a 768 tablet's 5/12 column (277 px),
  // so the phone and tablet runs are checked separately; from the tablet up it only grows.
  for (const h of [633, 720, 900, 1080]) for (const run of [[360, 375, 390, 430], [768, 900, 1023, 1024, 1280, 1440, 1920, 2560]]) {
    let prev = { label: 0, head: 0, meta: 0, caption: 0 };
    for (const w of run) {
      const cur = type(w, h);
      for (const k of Object.keys(cur) as (keyof typeof cur)[]) assert.ok(cur[k] >= prev[k], `${k} shrinks at ${w}x${h}`);
      prev = cur;
    }
  }
});
