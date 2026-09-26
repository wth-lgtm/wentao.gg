// The visitor card's layout harness: the hero around the card, at the windows the reviews
// measured, with the lookups mocked. Runs against a production build served on `PORT`
// (default 3301):
//
//   node scripts/verify-card.mjs [port] [check]      check: fit | shift | a11y | pointer | paint | all (default all)
//
// fit   At the short laptops (1280 × 633, 1366 × 657, 1280 × 720 — the most common laptop
//       windows) and around them, with a London readout, a long ISP and org, and an IPv6
//       address: the "Get in touch" button's bottom is inside the viewport, and the card,
//       the name, the split-flap, the button and the scroll arrow don't overlap. No
//       horizontal scroll.
//
// shift With the lookups answering late (/api/geo at 900 ms, /api/visit at 1400 ms, as the
//       review mocked them), the card's growth must not move the hero: the name's LAYOUT
//       position (offsetTop, so the entrance transform doesn't count) stays within 1 px from
//       the first frame to 4 s, and the page's total layout shift stays under the base
//       build's (820 × 1180 0.017, 1024 × 768 0.027, 1440 × 900 0.015; with reduced motion,
//       1024 × 768 0.042 — the base measured by the round-2 review).
//
// a11y  The card is a region named by its status line, and a screen reader's first line in it
//       is one plain sentence saying where the visitor is ("You're browsing from near London,
//       England, United Kingdom, about 5,350 miles from Wentao in San Francisco."); the row
//       labels and the distance are spoken as words; the card adds no aria-live region.
//
// pointer With a mouse (no touch), the fluid owns every empty point around the card: beside the
//       "Get in touch" button on its row, beside and above the card. The card and the button
//       themselves take the pointer. At 600 × 900 (a phone-width window, the button's row in
//       flow inside the card's wrapper), 768 × 1024, 900 × 700, 1024 × 768 and 1440 × 900.
//
// paint The world map's land is in the server HTML (on the card's first frame, with no
//       JavaScript), and the card never becomes the page's largest contentful paint: at a
//       phone, a tablet, a short laptop and a desktop the LCP element is the hero's own text,
//       painted with the first paint (a map drawn as an image outsized it, at 2.5 s on slow 4G).
//       The element is the hero's "San Francisco" line today: the h1 starts at opacity 0 for
//       its entrance, and an element that first paints invisible is not an LCP candidate —
//       the same on the base build; this check holds the card out of the race.
//
// Every readout is invented: documentation-range IPs (RFC 5737 / 3849) and made-up
// carriers, so a screenshot or a log line never holds a real visitor's IP, ISP or city.
// Playwright is not a dependency of this repo; point PLAYWRIGHT at an installed copy (and
// CHROME at a browser binary if that copy has none of its own).
const PW = process.env.PLAYWRIGHT ?? "/Users/wentaohe/.npm/_npx/520e866687cefe78/node_modules/playwright/index.mjs";
const { chromium } = await import(PW);
const port = process.argv[2] ?? "3301";
const only = process.argv[3] ?? "all";
const BASE = `http://localhost:${port}`;

export const READOUTS = {
  london: { ip: "203.0.113.42", city: "London", region: "England", country_code: "GB", latitude: 51.5074, longitude: -0.1278, isp: "Example Broadband Ltd", org: "Example Networks" },
  long: { ip: "198.51.100.23", city: "Llanfairpwllgwyngyll", region: "Wales", country_code: "GB", latitude: 53.2206, longitude: -4.2096, isp: "Example Very Long Internet Service Provider Holdings Limited", org: "Example Communications Infrastructure Partners International" },
  ipv6: { ip: "2001:db8:1f2b:4c00:8d3a:77ff:fe12:9abc", city: "Berlin", region: "Land Berlin", country_code: "DE", latitude: 52.52, longitude: 13.405, isp: "Example Deutsche Kommunikation AG", org: "Example Residential Broadband Netze GmbH" },
};

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const results = [];
const fail = (check, what) => results.push({ check, pass: false, what });
const pass = (check, what) => results.push({ check, pass: true, what });

async function open(w, h, { readout = "london", touch = false, geoDelay = 0, visitDelay = 0, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, colorScheme: "dark" });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await page.route("**/api/geo", async (r) => { await wait(geoDelay); r.fulfill({ json: readout === "null" ? {} : READOUTS[readout] }); });
  await page.route(/ipinfo\.io|ipwho\.is|geojs\.io/, (r) => r.abort());
  await page.route("**/api/visit", async (r) => { await wait(visitDelay); r.fulfill({ json: { count: 18342 } }); });
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  return { ctx, page };
}

// ── fit ────────────────────────────────────────────────────────────────────────────────
if (only === "all" || only === "fit") {
  const WINDOWS = [[1280, 633], [1366, 657], [1280, 720], [1024, 768], [900, 700], [1280, 800], [1440, 789], [1440, 900], [1920, 1080], [768, 1024], [820, 1180]];
  for (const [w, h] of WINDOWS) for (const readout of Object.keys(READOUTS)) {
    const { ctx, page } = await open(w, h, { readout });
    await page.waitForTimeout(2500); // the lookups answer at once; the status flips at 1.5 s
    const r = await page.evaluate(() => {
      const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; };
      const card = box(document.querySelector("[data-hero-card] .vcard"));
      const h1 = box(document.querySelector("[data-hero-h1] span"));
      const flap = box(document.querySelector(".split-flap"));
      const cta = box(document.querySelector("[data-hero-card] a[href='#connect']"));
      const arrow = box(document.querySelector("a[aria-label='Scroll to experience']"));
      const map = box(document.querySelector("[data-hero-card] [data-map]"));
      const ov = (a, b) => !!(a && b && !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y));
      return {
        vh: innerHeight, card, cta, map,
        overlaps: Object.entries({ "card/name": ov(card, h1), "card/flap": ov(card, flap), "card/cta": ov(card, cta), "cta/arrow": ov(cta, arrow), "card/arrow": ov(card, arrow), "name/cta": ov(h1, cta) }).filter(([, v]) => v).map(([k]) => k),
        overflowX: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const tag = `${w}x${h} ${readout}`;
    const ctaIn = r.cta && r.cta.b <= r.vh;
    (ctaIn ? pass : fail)("fit", `${tag}: CTA bottom ${Math.round(r.cta?.b)} of ${r.vh}; card ${Math.round(r.card.b - r.card.y)} tall, map ${Math.round(r.map.r - r.map.x)} wide`);
    (r.overlaps.length ? fail : pass)("fit", `${tag}: overlaps ${r.overlaps.join(", ") || "none"}`);
    (r.overflowX ? fail : pass)("fit", `${tag}: horizontal overflow ${r.overflowX}`);
    await ctx.close();
  }
}

// ── shift ──────────────────────────────────────────────────────────────────────────────
if (only === "all" || only === "shift") {
  const RUNS = [
    { w: 820, h: 1180, touch: true, base: 0.017 },
    { w: 1024, h: 768, base: 0.027 },
    { w: 1440, h: 900, base: 0.015 },
    { w: 1024, h: 768, base: 0.042, reduce: true },
    { w: 390, h: 844, touch: true, base: null },
  ];
  for (const run of RUNS) {
    const init = () => {
      window.__cls = 0;
      window.__h1 = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      const layoutY = (el) => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y; };
      const tick = () => {
        const h1 = document.querySelector("[data-hero-h1]");
        if (h1) window.__h1.push(layoutY(h1));
        if (performance.now() < 4000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const { ctx, page } = await open(run.w, run.h, { touch: run.touch, geoDelay: 900, visitDelay: 1400, init });
    if (run.reduce) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(4500);
    const r = await page.evaluate(() => ({ cls: window.__cls, ys: window.__h1 }));
    const tag = `${run.w}x${run.h}${run.touch ? " touch" : ""}${run.reduce ? " reduced-motion" : ""}`;
    const drift = Math.max(...r.ys) - Math.min(...r.ys);
    (drift <= 1 ? pass : fail)("shift", `${tag}: the name's layout y moved ${drift} px over ${r.ys.length} frames`);
    if (run.base !== null) (r.cls < run.base ? pass : fail)("shift", `${tag}: layout shift ${r.cls.toFixed(4)} (base ${run.base})`);
    else pass("shift", `${tag}: layout shift ${r.cls.toFixed(4)} (recorded)`);
    await ctx.close();
  }
}

// ── a11y ───────────────────────────────────────────────────────────────────────────────
if (only === "all" || only === "a11y") {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const { ctx, page } = await open(w, h, { touch: w < 768 });
    await page.waitForTimeout(2500);
    const snap = await page.locator("[data-hero-card] section").ariaSnapshot();
    const live = await page.evaluate(() => document.querySelectorAll("[data-hero-card] [aria-live]").length);
    const tag = `${w}x${h}`;
    (/^- region "WHERE YOU'RE AT"/.test(snap) ? pass : fail)("a11y", `${tag}: the card is a region named by its status`);
    (snap.includes("paragraph: You're browsing from near London, England, United Kingdom, about 5,350 miles from Wentao in San Francisco.") ? pass : fail)("a11y", `${tag}: the sentence`);
    (snap.includes("term: Internet provider") && snap.includes("definition: 5,350 miles away") ? pass : fail)("a11y", `${tag}: labels and distance spoken as words`);
    (live === 0 ? pass : fail)("a11y", `${tag}: no aria-live in the card (${live})`);
    await ctx.close();
  }
}

// ── pointer ────────────────────────────────────────────────────────────────────────────
if (only === "all" || only === "pointer") {
  for (const [w, h] of [[600, 900], [768, 1024], [900, 700], [1024, 768], [1440, 900]]) {
    const { ctx, page } = await open(w, h);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const fluid = document.querySelector("canvas.fixed");
      const card = document.querySelector("[data-hero-card] .vcard").getBoundingClientRect();
      const btn = document.querySelector("[data-hero-card] a[href='#connect']").getBoundingClientRect();
      const probe = (x, y) => {
        if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) return "offscreen";
        const el = document.elementFromPoint(x, y);
        return el === fluid ? "fluid" : el?.closest(".vcard") ? "card" : el?.closest("a[href='#connect']") ? "button" : `${el?.tagName}.${String(el?.className?.baseVal ?? el?.className ?? "").slice(0, 30)}`;
      };
      return {
        // the empty side of the button's row: right of it where it is left-aligned (below lg),
        // left of it where it sits at the card's right edge (lg and up)
        besideButton: probe(btn.left - card.left > card.right - btn.right ? btn.left - 40 : btn.right + 40, btn.top + btn.height / 2),
        rightOfCard: probe(card.right + 16, card.top + card.height / 2),
        aboveCard: probe(card.left + card.width / 2, card.top - 12),
        onCard: probe(card.left + card.width / 2, card.top + card.height / 2),
        onButton: probe(btn.left + btn.width / 2, btn.top + btn.height / 2),
      };
    });
    const tag = `${w}x${h}`;
    for (const k of ["besideButton", "rightOfCard", "aboveCard"]) (r[k] === "fluid" || r[k] === "offscreen" ? pass : fail)("pointer", `${tag}: ${k} → ${r[k]}`);
    (r.onCard === "card" ? pass : fail)("pointer", `${tag}: onCard → ${r.onCard}`);
    (r.onButton === "button" ? pass : fail)("pointer", `${tag}: onButton → ${r.onButton}`);
    await ctx.close();
  }
}

// ── paint ──────────────────────────────────────────────────────────────────────────────
if (only === "all" || only === "paint") {
  const html = await (await fetch(`${BASE}/`)).text();
  const at = html.indexOf('data-map="outline"');
  const svgEnd = html.indexOf("</svg>", at);
  const land = at > 0 && svgEnd > at && (html.slice(at, svgEnd).match(/<path /g) ?? []).length === 3 && html.slice(at, svgEnd).includes('<path d="M350 426');
  (land ? pass : fail)("paint", `server HTML: the outline's land is drawn inside [data-map] (${Math.round(html.length / 1024)} KB of HTML)`);
  for (const [w, h, touch] of [[390, 844, true], [768, 1024, true], [1280, 633, false], [1440, 900, false]]) {
    const init = () => {
      window.__lcp = null;
      window.__fcp = null;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__fcp = e.startTime; }).observe({ type: "paint", buffered: true });
    };
    const { ctx, page } = await open(w, h, { touch, init });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => {
      const e = window.__lcp?.element;
      return e ? { inCard: !!e.closest("[data-hero-card]"), inHero: !!e.closest("#about, header, nav, [class*='top-[4.5rem]']"), what: `${e.tagName} "${(e.textContent || "").trim().slice(0, 20)}"`, t: Math.round(window.__lcp.startTime), fcp: Math.round(window.__fcp ?? -1) } : null;
    });
    const ok = r && !r.inCard && r.inHero && r.t - r.fcp <= 100;
    (ok ? pass : fail)("paint", `${w}x${h}: LCP ${r?.what ?? "none"} at ${r?.t} ms (FCP ${r?.fcp} ms)${r?.inCard ? " — INSIDE THE CARD" : ""}`);
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.pass);
for (const r of results) if (!r.pass || process.env.VERBOSE) console.log(`${r.pass ? "ok  " : "FAIL"} [${r.check}] ${r.what}`);
console.log(JSON.stringify({ pass: failed.length === 0, checks: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
