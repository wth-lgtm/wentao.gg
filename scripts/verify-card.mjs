// The visitor card's layout harness: the hero around the card, at the windows the reviews
// measured, with the lookups mocked. Runs against a production build served on `PORT`
// (default 3301):
//
//   node scripts/verify-card.mjs [port] [check]      check: fit | all (default all)
//
// fit   At the short laptops (1280 × 633, 1366 × 657, 1280 × 720 — the most common laptop
//       windows) and around them, with a London readout, a long ISP and org, and an IPv6
//       address: the "Get in touch" button's bottom is inside the viewport, and the card,
//       the name, the split-flap, the button and the scroll arrow don't overlap. No
//       horizontal scroll.
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

await browser.close();
const failed = results.filter((r) => !r.pass);
for (const r of results) if (!r.pass || process.env.VERBOSE) console.log(`${r.pass ? "ok  " : "FAIL"} [${r.check}] ${r.what}`);
console.log(JSON.stringify({ pass: failed.length === 0, checks: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
