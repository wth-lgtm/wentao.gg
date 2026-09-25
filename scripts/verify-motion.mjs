#!/usr/bin/env node
// The reading chapters' verification harness (DESIGN.md §8 PR 1 "Acceptance", §9). Runs against a REVIEW build
// (`NEXT_PUBLIC_REVIEW_FLAGS=1 npm run build`: its window.__chapters / ?chapterDebug surface compiles out of a
// production build) served on :3301 (`npx next start -p 3301 -H 127.0.0.1`) in system Chrome through playwright-core, on the
// real GPU (--angle=metal, the default) or SwiftShader. Every named check prints its own numbers as one JSON line
// ({check, viewport, theme, pass, ...numbers}), so every headline number in the PR body is backed by a check.
//
//   node scripts/verify-motion.mjs [--url=http://127.0.0.1:3301/] [--angle=metal|swiftshader]
//        [--themes=dark,light] [--viewports=1440x900,390x844m,…] [--reduce] [--out=DIR] [--baseline=DIR]
//        [--only=check,check] [--shots]
//
// Viewport grammar: WxH (desktop, DPR 1, fine pointer) | WxHt (tablet: iPad emulation, DPR 2, touch) | WxHm
// (phone: iPhone emulation, DPR 2, touch). The default is the owner's matrix (2026-09-24, "Dynamically fit onto
// any sort of browser size and also different iPhone or smartphone screen sizes"): nine desktops, four tablets,
// seven phones, two landscape phones — plus live resizes across the pin/flow boundary.
//
// PRIVACY: the hero's visitor card shows the viewer's public IP and ISP. Every screenshot here masks
// [data-hero-card] (Playwright's `mask`), and nothing else in the hero is captured.
//
// Checks (per viewport × theme unless noted):
//   chapterModes            the mode each chapter chose, its panel height, the band, the stage
//   layoutSane              owner matrix: at five scrolls per chapter nothing overflows the viewport, no row overlaps
//                           another or leaves its panel, no text is clipped, the title never overlaps the panel
//   pinnedOnlyWhenFits      pinned: the panel inside the band and every row inside the panel, at pins 0…1
//   oneActive               exactly one active entry and one active line while engaged; none when disengaged
//   activeItemMonotone      scrolling down in 30 px steps never moves the mark back
//   noSkipOnNotch           1-, 2- and 3-notch wheels and PageDown: every beat between start and end, in order
//   headNeverLeads          pinned: the rail head at or above the next uncommitted row in every sampled frame
//   commitOnBeat            each step lands 0–12 ms after a 100 ms boundary (median p95 of 3 runs; Metal only)
//   railMatchesPin          --pin-progress = chapterPin ± 0.002, two frames after each scrollTo
//   findReachesEveryItem    window.find reaches every entry's name and dates line, painted inside its panel
//   findHitsOnlyVisibleText "2024", "2022", "2021", "2017": the first hit is list text, never the wheel
//   focusFollows / tabLeavesChapter   pinned and flow: Tab through the links, the lit entry is the focused one; Tab leaves
//   anchorsAtPin0           a hard load of /#experience lands at the section top, pin 0, the first entry marked;
//                           a flow chapter (/#education) lands at its top with a mark, the CSS rail agreeing with the dots
//   keepPlaceOnResize       1440×900 → 1440×700 → back, mid-Experience, mid-Education and below: ± 40 px
//   liveReduceToggle        emulateMedia reduce mid-Education: static, the shown row stays on the reading line
//   hashLoadFailsBand       a hard load of /#education where Experience fails bandFits lands on Education
//   liveResizes             drags across the pin/flow boundary; the place holds and layoutSane holds at each size
//   reducedStatic           --reduce: no pinned mode, no data-active, no --pin-progress
//   liveReduceStopsCanvases rain still, field and card unmounted within 1 s of a live Reduce Motion toggle
//   fluidInPin              the pinned stage's gaps hit-test to the fluid canvas
//   glassBlurIntact         Metal: the pinned panel's backdrop stays blurred (Spike 0's hf metric vs raw and control)
//   contrastRows            pixel contrast over the live canvases, inactive ≥ 4.5, active line ≥ 7, index ≥ 4.5, tints ΔL* ≥ 3
//   accentBudget            accent-derived paint only inside the active entry (none at all in the static still)
//   titleClearOfPacks       the pinned title's box against the live jack bodies (window.__field), fresh page at rest
//   zeroRafMidChapter       at rest mid-chapter the chapter code runs 0 callbacks (rAF recorded, debug URL)
//   rafPlain                rAF calls/exec per second at rest on a PLAIN URL: top, mid-Experience, mid-Education
//   docHeight               docH = Spike 0's docH − the old chapters + the measured chapters ± 40; pinned = vh × svh
//   restAtTopIdentical      the field at the top: passes 42, bodies 21, programs 3, no errors
//   restAtTopPixels         SSIM ≥ 0.99 against Spike 0's f4b738f first screens (capture-top.mjs)
//   (fix round 1)
//   keepPlaceHeightOnly     a height-only resize with a flow chapter on a non-last entry: the mark is the live-line row
//   resizeMidScroll         a resize while the reader is still scrolling: their place holds ± 40 px (not the last rest)
//   textSpacing             WCAG 1.4.12 CSS and a 24 px root at every size: layoutSane (title glyphs included) holds
//   touchTargets            every row link by elementFromPoint: its centre hits it, vertical reach ≥ 24 px
//   printNeutral            print emulation changes no mode or mark, prints the marks neutral; the round trip moves nothing
//   hashLoadCls             hard loads of /#experience, /#education, /#projects: non-input CLS ≤ 0.01 each, no dial shift
//                           (every phone and tablet, three desktops; the first theme)
//   framesMidChapter        CDP frames produced per second mid-chapter at rest (recorded)
//   flowFillZeroJs          a flow scroll writes nothing to the rail; the fill's tip rides the reading line
//   lcpInHero / contexts    the LCP element stays in the hero (never a chapter); WebGL contexts ≤ 3 desktop / 1 phone
// contrastRows also runs at 1440x700 (EXTRA): both chapters flow in the site's glass at a desktop size.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { captureTop, ssimFiles, masksFromSidecar } from "./capture-top.mjs";

const PW = process.env.PLAYWRIGHT_CORE ?? "/tmp/shots/node_modules/playwright-core/index.mjs";
const { chromium } = await import(PW);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ANGLE = {
  metal: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  swiftshader: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
};
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MATRIX = [
  "1280x720", "1366x768", "1440x900", "1440x789", "1470x832", "1512x982", "1728x1117", "1920x1080", "2560x1440",
  "768x1024t", "820x1180t", "1180x820t", "1024x1366t",
  "375x667m", "375x812m", "390x844m", "393x852m", "430x932m", "360x800m", "412x915m",
  "844x390m", "932x430m",
];
// the heavier checks run where the brief's screenshots and budgets are taken; the rest run everywhere
const CORE = new Set(["1440x900", "390x844m"]);
// beyond the owner's matrix: a desktop window too short to pin (both chapters flow in the site's own glass),
// where contrastRows proves the FLOW panels over the live canvases as well as the pinned one
const EXTRA = ["1440x700"];
const CONTRAST = new Set([...CORE, ...EXTRA]);

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const URL_ = (args.url ?? "http://127.0.0.1:3301/").replace(/\/?$/, "/");
const ANGLE_NAME = args.angle ?? "metal";
const THEMES = String(args.themes ?? "dark,light").split(",");
const VIEWPORTS = String(args.viewports ?? [...MATRIX, ...EXTRA].join(",")).split(",");
const REDUCE = !!args.reduce;
const OUT = args.out ?? "/tmp/wentao-gg-research/pr1/verify-motion";
const BASELINE = args.baseline ?? "/tmp/wentao-gg-research/baseline";
const ONLY = args.only ? new Set(String(args.only).split(",")) : null;
const SHOTS = !!args.shots;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const want = (name) => !ONLY || ONLY.has(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function report(check, vp, theme, pass, numbers = {}) {
  const row = { check, viewport: vp, theme, pass: pass === null ? "info" : !!pass, ...numbers };
  results.push(row);
  console.log(JSON.stringify(row));
  return row;
}

export function parseVp(spec) {
  const m = /^(\d+)x(\d+)([mt])?$/.exec(spec);
  if (!m) throw new Error(`bad viewport ${spec}`);
  const kind = m[3] === "m" ? "phone" : m[3] === "t" ? "tablet" : "desktop";
  return { spec, width: +m[1], height: +m[2], kind, mobile: kind !== "desktop", dpr: kind === "desktop" ? 1 : 2 };
}

const browser = await chromium.launch({ executablePath: CHROME, args: ANGLE[ANGLE_NAME] ?? ANGLE.metal });

// ---------------------------------------------------------------------------------------------------------------
// page plumbing

async function openPage(vp, theme, { hash = "", reduce = REDUCE, extra = "", plain = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    userAgent: vp.kind === "phone" ? IPHONE_UA : vp.kind === "tablet" ? IPAD_UA : undefined,
    colorScheme: theme,
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("theme", t); } catch {}
    const R = (window.__raf = { calls: 0, exec: 0 });
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { R.calls++; return orig((ts) => { R.exec++; return cb(ts); }); };
    window.__vm = { log: [] };
    // WebGL contexts created (one per canvas), for `contexts`
    const G = (window.__gl = { contexts: 0 });
    const seen = new WeakSet();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const c = getContext.call(this, type, ...rest);
      if (c && /webgl/.test(String(type)) && !seen.has(this)) { seen.add(this); G.contexts++; }
      return c;
    };
    // layout shifts, for `hashLoadCls`
    window.__shifts = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ t: Math.round(e.startTime), v: e.value, input: e.hadRecentInput, dial: e.sources.some((x) => x.node && x.node.nodeType === 1 && !!x.node.closest?.(".ch-dial")) }); }).observe({ type: "layout-shift", buffered: true });
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const mo = new MutationObserver((recs) => {
        const t = performance.now();
        for (const r of recs) {
          const el = r.target;
          if (!(el instanceof HTMLElement) || !el.hasAttribute("data-beat")) continue;
          const ch = el.closest("[data-chapter]");
          window.__vm.log.push({ t, chapter: ch ? ch.dataset.chapter : null, beat: Number(el.dataset.beat), on: el.hasAttribute("data-active") });
        }
      });
      mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-active"] });
    });
  }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" && !/_vercel|Failed to load resource|MIME type/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  if (plain) {
    // the page as a visitor gets it: no ?chapterDebug, no ?jacksDebug (their hooks cost frames of their own)
    await page.goto(`${URL_}${hash}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page, errors };
  }
  await page.goto(`${URL_}?chapterDebug=1&jacksDebug=1${extra}${hash}`, { waitUntil: "load" });
  // tuning only (OC-T search): --panel-fill=NN overrides the pinned panel's glass fill to NN % of --card;
  // --inactive-legend sets the pinned panel's inactive lines in --legend (light theme only)
  if (args["panel-fill"]) await page.addStyleTag({ content: `.chapter[data-mode="pinned"] .ch-panel { --glass-tint: color-mix(in oklab, var(--card) ${args["panel-fill"]}%, transparent) !important; }` });
  if (args["flow-fill"]) await page.addStyleTag({ content: `.chapter[data-mode="flow"] .ch-panel { --glass-tint: color-mix(in oklab, var(--card) ${args["flow-fill"]}%, transparent) !important; }` });
  if (args["inactive-legend"]) await page.addStyleTag({ content: args["inactive-legend"] === "all" ? `.chapter .ch-sub:not([data-active]) { color: var(--legend) !important; }` : `.light .chapter[data-mode="pinned"] .ch-sub:not([data-active]) { color: var(--legend) !important; }` });
  await page.waitForFunction(() => window.__chapters && window.__chapters.ready && window.__chapters.evaluations > 0, null, { timeout: 30000, polling: 100 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  return { ctx, page, errors };
}

const list = (page) => page.evaluate(() => window.__chapters.list);
const chapter = async (page, id) => (await list(page)).find((c) => c.id === id);
const scrollTo = (page, y) => page.evaluate((yy) => window.scrollTo({ top: Math.max(0, Math.round(yy)), behavior: "instant" }), y);
const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

/** wait until the commit has settled: two frames for the read phase, then no step pending, twice 150 ms apart */
async function settled(page, timeout = 8000) {
  await frames(page, 2);
  const idle = () => page.waitForFunction(() => window.__chapters.list.every((c) => !c.pending && !c.held), null, { timeout, polling: 40 });
  await idle();
  await sleep(150);
  await idle();
}

/** page geometry of a chapter from the DOM (not the director's cache) */
function geoOf(page, id) {
  return page.evaluate((cid) => {
    const s = document.getElementById(cid);
    const r = s.getBoundingClientRect();
    const stage = s.querySelector(".ch-stage");
    const rows = [...s.querySelectorAll("li[data-item]")].map((li) => { const b = li.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY }; });
    return { top: r.top + scrollY, height: r.height, stageH: stage.clientHeight, mode: s.dataset.mode, rows, vh: innerHeight, vw: innerWidth, clientH: document.documentElement.clientHeight };
  }, id);
}

/** the scroll that puts beat k in charge: pinned → the middle of its slot; flow → its row just past the reading line */
async function yForBeat(page, id, beat) {
  const c = await chapter(page, id);
  const g = await geoOf(page, id);
  if (c.mode === "pinned") {
    const held = 15 + 15 + c.layout.reduce((n, s) => n + s, 0) * 10;
    const pin = (15 + (beat + 0.5) * 10) / held;
    return g.top + pin * (g.height - g.stageH);
  }
  const line = Math.round(0.62 * g.clientH);
  return c.beatTops[beat] - line + 12;
}

const shotPath = (name) => path.join(OUT, `${name}.png`);
async function shot(page, name, opts = {}) {
  await page.screenshot({ path: shotPath(name), mask: [page.locator("[data-hero-card]")], ...opts });
  return shotPath(name);
}

// ---------------------------------------------------------------------------------------------------------------
// checks

async function chapterModes(page, vp, theme) {
  const L = await list(page);
  const pinMatches = await page.evaluate(() => matchMedia("screen and (prefers-reduced-motion: no-preference) and (forced-colors: none) and (min-width: 700px) and (min-height: 720px)").matches);
  const probe = await page.evaluate(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;height:100vh;height:100svh;visibility:hidden"; document.body.appendChild(d); const h = d.offsetHeight; d.remove(); return h; });
  const narrow = vp.width < 1024;
  const band = probe - 136 - (narrow ? 88 : 0);
  const modes = Object.fromEntries(L.map((c) => [c.id, c.mode]));
  const rows = L.map((c) => ({ id: c.id, mode: c.mode, panelH: c.panelH, band, fits: c.panelH <= band, slack: band - c.panelH }));
  // the decision must be the rule: static only when motion is off; pinned only for a pin-set chapter that fits
  const ok = L.every((c) => {
    if (REDUCE) return c.mode === "static";
    if (c.id === "education") return c.mode === "flow";
    if (!pinMatches) return c.mode === "flow";
    return c.mode === (c.panelH <= band ? "pinned" : "flow") || (c.mode === "pinned" && c.panelH <= band + 16);
  });
  return report("chapterModes", vp.spec, theme, ok, { modes, pinQuery: pinMatches, stage100svh: probe, rows });
}

/** owner matrix: nothing overlaps, clips or leaves the viewport — at five scrolls through each chapter */
async function layoutSane(page, vp, theme, label = "layoutSane") {
  const L = await list(page);
  const problems = [];
  let samples = 0;
  for (const c of L) {
    const g = await geoOf(page, c.id);
    const ys = [0.02, 0.25, 0.5, 0.75, 0.98].map((f) => g.top - g.vh * 0.2 + f * (g.height));
    for (const y of ys) {
      await scrollTo(page, y);
      await frames(page, 2);
      samples++;
      const p = await page.evaluate((cid) => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
        const s = document.getElementById(cid);
        const panel = s.querySelector(".ch-panel").getBoundingClientRect();
        // the title's painted glyphs (its text range), not its box: a word that overflows its box (a text-spacing
        // override, a large default font) runs under the panel while the box still sits beside it
        const titleRange = document.createRange();
        titleRange.selectNodeContents(s.querySelector(".ch-title-text"));
        const title = titleRange.getBoundingClientRect();
        const dial = s.querySelector(".ch-dial").getBoundingClientRect();
        if (panel.left < -0.5 || panel.right > vw + 0.5) out.push(`panel x ${panel.left.toFixed(0)}–${panel.right.toFixed(0)} outside 0–${vw}`);
        if (title.left < -0.5 || title.right > vw + 0.5) out.push(`title x ${title.left.toFixed(0)}–${title.right.toFixed(0)}`);
        // the title never overlaps the panel (two columns: beside it; one column: above it)
        const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        if (overlap(title, panel)) out.push("title overlaps the panel");
        if (overlap(dial, panel)) out.push("dial overlaps the panel");
        const items = [...s.querySelectorAll("li[data-item]")].map((li) => li.getBoundingClientRect());
        items.forEach((r, i) => {
          if (r.left < panel.left - 0.5 || r.right > panel.right + 0.5) out.push(`entry ${i} leaves the panel horizontally`);
          if (r.top < panel.top - 0.5 || r.bottom > panel.bottom + 0.5) out.push(`entry ${i} leaves the panel vertically`);
          if (i > 0 && r.top < items[i - 1].bottom - 0.5) out.push(`entry ${i} overlaps entry ${i - 1}`);
        });
        // clipped text: the painted glyphs (a Range over the text, not the box — hit areas overhang on purpose)
        // must lie inside the panel (list text) or the viewport (the title), and nothing may sit in an
        // overflow-hidden box narrower than its text
        for (const el of s.querySelectorAll(".ch-name, .ch-role, .ch-line, .ch-stack, .ch-index, .ch-title-text")) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const r = range.getBoundingClientRect();
          if (r.width === 0) continue;
          const inDial = !!el.closest(".ch-dial");
          const box = inDial ? { left: 0, right: vw } : panel;
          if (r.right > box.right + 0.5 || r.left < box.left - 0.5) out.push(`text clipped at the ${inDial ? "viewport" : "panel"} edge: "${el.textContent.slice(0, 30)}"`);
          const ov = getComputedStyle(el).overflowX;
          if (ov !== "visible" && el.scrollWidth > el.clientWidth + 1) out.push(`text clipped by its box: "${el.textContent.slice(0, 30)}"`);
        }
        // head rows never overlap their lines
        for (const li of s.querySelectorAll("li[data-item]")) {
          const head = li.querySelector(".ch-head").getBoundingClientRect();
          for (const sub of li.querySelectorAll("[data-sub]")) { const b = sub.getBoundingClientRect(); if (b.top < head.bottom - 0.5) out.push(`a line overlaps its head row (entry ${li.dataset.item})`); }
        }
        return out;
      }, c.id);
      for (const m of p) problems.push(`${c.id}@${Math.round(y)}: ${m}`);
    }
  }
  const uniq = [...new Set(problems)];
  return report(label, vp.spec, theme, uniq.length === 0, { samples, problems: uniq.slice(0, 12), problemCount: uniq.length });
}

async function pinnedOnlyWhenFits(page, vp, theme) {
  const L = await list(page);
  const pinned = L.filter((c) => c.mode === "pinned");
  if (!pinned.length) return report("pinnedOnlyWhenFits", vp.spec, theme, null, { note: "no pinned chapter at this viewport" });
  const bad = [];
  let frames_ = 0;
  for (const c of pinned) {
    const g = await geoOf(page, c.id);
    for (const pin of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      await scrollTo(page, g.top + pin * (g.height - g.stageH));
      await frames(page, 2);
      frames_++;
      const r = await page.evaluate((cid) => {
        const s = document.getElementById(cid);
        const stage = s.querySelector(".ch-stage").getBoundingClientRect();
        const panel = s.querySelector(".ch-panel").getBoundingClientRect();
        const rows = [...s.querySelectorAll("li[data-item]")].map((li) => li.getBoundingClientRect());
        return { stageTop: stage.top, panelTop: panel.top, panelBottom: panel.bottom, vh: innerHeight, rowsInside: rows.every((b) => b.top >= panel.top - 0.5 && b.bottom <= panel.bottom + 0.5) };
      }, c.id);
      const bandTop = r.stageTop + 96, bandBottom = r.stageTop + r.vh - 40;
      if (Math.abs(r.stageTop) > 0.5) bad.push(`${c.id} pin ${pin}: stage not docked (${r.stageTop})`);
      if (r.panelTop < bandTop - 0.5 || r.panelBottom > bandBottom + 0.5) bad.push(`${c.id} pin ${pin}: panel ${r.panelTop.toFixed(0)}–${r.panelBottom.toFixed(0)} outside band ${bandTop}–${bandBottom}`);
      if (!r.rowsInside) bad.push(`${c.id} pin ${pin}: a row outside the panel`);
    }
  }
  return report("pinnedOnlyWhenFits", vp.spec, theme, bad.length === 0, { framesChecked: frames_, problems: bad });
}

async function activeCounts(page) {
  return page.evaluate(() => ({ items: document.querySelectorAll("li[data-item][data-active]").length, subs: document.querySelectorAll("[data-sub][data-active]").length }));
}

async function oneActive(page, vp, theme) {
  const L = await list(page);
  const rows = [];
  let ok = true;
  for (const c of L) {
    for (let b = 0; b < c.layout.length; b++) {
      await scrollTo(page, await yForBeat(page, c.id, b));
      await settled(page);
      const n = await activeCounts(page);
      const s = await chapter(page, c.id);
      const good = REDUCE ? n.items === 0 && n.subs === 0 : n.items === 1 && n.subs === 1 && s.shown === b;
      if (!good) ok = false;
      rows.push({ id: c.id, beat: b, shown: s.shown, ...n });
    }
  }
  // disengaged: at the very top and at the very bottom of the page nothing is marked
  await scrollTo(page, 0); await settled(page);
  const top = await activeCounts(page);
  await scrollTo(page, 1e6); await settled(page);
  const bottom = await activeCounts(page);
  if (top.items || top.subs || bottom.items || bottom.subs) ok = false;
  return report("oneActive", vp.spec, theme, ok, { engaged: rows, atTop: top, atBottom: bottom });
}

async function activeItemMonotone(page, vp, theme) {
  const L = await list(page);
  const out = {};
  let ok = true;
  for (const c of L) {
    const g = await geoOf(page, c.id);
    const from = c.mode === "pinned" ? g.top - 20 : c.beatTops[0] - Math.round(0.62 * g.clientH) - 40;
    const to = c.mode === "pinned" ? g.top + g.height - g.stageH + 10 : c.beatTops[c.beatTops.length - 1] - Math.round(0.62 * g.clientH) + 60;
    const seq = [];
    for (let y = from; y <= to; y += 30) {
      await scrollTo(page, y);
      await settled(page);
      seq.push((await chapter(page, c.id)).shown);
    }
    const engaged = seq.filter((b) => b >= 0);
    const mono = engaged.every((b, i) => i === 0 || b >= engaged[i - 1]);
    const covers = new Set(engaged).size === c.layout.length;
    if (!mono || !covers) ok = false;
    out[c.id] = { steps: seq.length, sequence: seq.join(""), monotone: mono, everyBeatSeen: covers };
  }
  return report("activeItemMonotone", vp.spec, theme, ok, out);
}

/** the logged step sequence for one chapter since `since`: contiguous (±1) from `start` to `end` */
function stepsSince(log, id, since) {
  return log.filter((e) => e.chapter === id && e.on && e.t >= since).map((e) => e.beat);
}

async function noSkipOnNotch(page, vp, theme) {
  const L = await list(page);
  const runs = [];
  let ok = true;
  for (const c of L) {
    if (c.layout.length < 2) continue;
    const moves = [["wheel1", 1], ["wheel2", 2], ["wheel3", 3], ["pagedown", 0]];
    for (const [name, notches] of moves) {
      await scrollTo(page, await yForBeat(page, c.id, 0));
      await settled(page);
      const start = (await chapter(page, c.id)).shown;
      const t0 = await page.evaluate(() => performance.now());
      await page.mouse.move(Math.round(vp.width * 0.5), Math.round(vp.height * 0.5));
      if (notches) {
        for (let i = 0; i < notches; i++) { await page.mouse.wheel(0, 100); await sleep(16); }
      } else {
        await page.keyboard.press("PageDown");
      }
      await sleep(700);
      await settled(page);
      const end = (await chapter(page, c.id)).shown;
      const log = await page.evaluate(() => window.__vm.log);
      const seq = stepsSince(log, c.id, t0);
      const lastBeat = c.layout.length - 1;
      // engaged at the end: every beat from start to end, in order; left the gate: the sequence up to the clear
      let prev = start;
      let contiguous = true;
      // from nothing shown, the first step is a dock (straight onto the target); every step after it is ±1
      for (const b of seq) { if (prev >= 0 && Math.abs(b - prev) !== 1) contiguous = false; prev = b; }
      const good = contiguous && (end < 0 || seq.length === 0 || seq[seq.length - 1] === end);
      if (!good) ok = false;
      runs.push({ id: c.id, move: name, start, end, steps: seq.join(","), contiguous, last: lastBeat });
    }
  }
  return report("noSkipOnNotch", vp.spec, theme, ok, { runs });
}

/** pinned: sample every frame while scrolling; the displayed head never passes rowYs[shown + 1] */
async function headNeverLeads(page, vp, theme) {
  const L = await list(page);
  const c = L.find((x) => x.mode === "pinned");
  if (!c) return report("headNeverLeads", vp.spec, theme, null, { note: "no pinned chapter" });
  const g = await geoOf(page, c.id);
  await scrollTo(page, g.top - 50);
  await settled(page);
  await page.evaluate((cid) => {
    const s = document.getElementById(cid);
    const fill = s.querySelector(".ch-rail-fill");
    const rail = s.querySelector(".ch-rail");
    const dots = [...s.querySelectorAll(".ch-dot")];
    window.__head = { worst: -Infinity, frames: 0, stop: false };
    const tick = () => {
      if (window.__head.stop) return;
      const rr = rail.getBoundingClientRect();
      const m = new DOMMatrixReadOnly(getComputedStyle(fill).transform);
      const head = m.d * rr.height;
      const shown = window.__chapters.list.find((x) => x.id === cid).shown;
      const next = dots[shown + 1];
      if (next) {
        const b = next.getBoundingClientRect();
        window.__head.worst = Math.max(window.__head.worst, head - (b.top + b.height / 2 - rr.top));
      }
      window.__head.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, c.id);
  // a slow walk, a fast flick, a walk back
  for (let y = g.top - 50; y <= g.top + g.height - g.stageH + 50; y += 45) { await scrollTo(page, y); await sleep(35); }
  await scrollTo(page, g.top); await sleep(80);
  await scrollTo(page, g.top + (g.height - g.stageH)); await sleep(600);
  for (let y = g.top + g.height - g.stageH; y >= g.top; y -= 90) { await scrollTo(page, y); await sleep(20); }
  await sleep(400);
  const r = await page.evaluate(() => { window.__head.stop = true; return { worst: window.__head.worst, frames: window.__head.frames }; });
  return report("headNeverLeads", vp.spec, theme, r.worst <= 0.75, { framesSampled: r.frames, worstLeadPx: +r.worst.toFixed(2) });
}

/** one more riffle run: three sweeps through Experience, first entry → last → first, each a riffle of every entry */
async function commitRun(page) {
  const c = await chapter(page, "experience");
  if (!c || c.mode === "static") return [];
  const t0 = await page.evaluate(() => performance.now());
  for (let k = 0; k < 3; k++) {
    await scrollTo(page, await yForBeat(page, c.id, c.layout.length - 1)); await settled(page);
    await scrollTo(page, await yForBeat(page, c.id, 0)); await settled(page);
  }
  return page.evaluate((t) => window.__vm.log.filter((e) => e.on && e.t >= t).map((e) => e.t), t0);
}

/** each step lands 0–12 ms after a 100 ms boundary. One run's p95 swung 2.8–12.6 ms at 2560 × 1440 on the same
 *  build, so the assertion is on the MEDIAN p95 of three runs: the steps the earlier checks logged, and two
 *  dedicated riffle runs */
async function commitOnBeat(page, vp, theme) {
  const first = await page.evaluate(() => window.__vm.log.filter((e) => e.on).map((e) => e.t));
  const runs = [first, await commitRun(page), await commitRun(page)];
  // signed offset from the nearest boundary: a step that fired early reads as a small negative number
  const phases = runs.map((ts) => ts.map((t) => { const m = t % 100; return m >= 50 ? m - 100 : m; }).sort((a, b) => a - b));
  const q = (phase, p) => +phase[Math.min(phase.length - 1, Math.floor(p * phase.length))].toFixed(2);
  const all = phases.flat().sort((a, b) => a - b);
  if (all.length < 5) return report("commitOnBeat", vp.spec, theme, null, { note: "too few steps logged", steps: all.length });
  const p95s = phases.filter((ph) => ph.length >= 5).map((ph) => q(ph, 0.95));
  const medianP95 = [...p95s].sort((a, b) => a - b)[Math.floor(p95s.length / 2)];
  const asserted = ANGLE_NAME === "metal";
  return report("commitOnBeat", vp.spec, theme, asserted ? medianP95 <= 12 && all[0] >= -0.5 : null, { runs: phases.map((ph) => ph.length), p95PerRunMs: p95s, medianP95ms: medianP95, minMs: +all[0].toFixed(2), p50ms: q(all, 0.5), maxMs: +all[all.length - 1].toFixed(2), asserted });
}

async function railMatchesPin(page, vp, theme) {
  const L = await list(page);
  const c = L.find((x) => x.mode === "pinned");
  if (!c) return report("railMatchesPin", vp.spec, theme, null, { note: "no pinned chapter" });
  const g = await geoOf(page, c.id);
  let worst = 0;
  const rows = [];
  for (const f of [0, 0.13, 0.37, 0.5, 0.71, 0.96, 1]) {
    await scrollTo(page, g.top + f * (g.height - g.stageH));
    await frames(page, 2);
    const r = await page.evaluate((cid) => {
      const s = document.getElementById(cid);
      const rect = s.getBoundingClientRect();
      const stageH = s.querySelector(".ch-stage").clientHeight;
      const travel = rect.height - stageH;
      const pin = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      const written = parseFloat(getComputedStyle(s.querySelector(".ch-rail")).getPropertyValue("--pin-progress"));
      return { pin, written };
    }, c.id);
    const d = Math.abs(r.pin - r.written);
    worst = Math.max(worst, Number.isFinite(d) ? d : 1);
    rows.push({ pin: +r.pin.toFixed(4), written: r.written });
  }
  return report("railMatchesPin", vp.spec, theme, worst <= 0.002, { worstDiff: +worst.toFixed(4), rows });
}

async function findChecks(page, vp, theme) {
  const texts = await page.evaluate(() => [...document.querySelectorAll("[data-chapter] .ch-name, [data-chapter] .ch-sub .ch-line:first-child")].map((e) => e.textContent.trim().split(/\s·\s/)[0]).filter(Boolean));
  const miss = [];
  for (const t of texts) {
    const r = await page.evaluate((needle) => {
      window.getSelection().removeAllRanges();
      window.scrollTo({ top: 0, behavior: "instant" });
      const found = window.find(needle, true, false, false, false, false, false);
      if (!found) return { found };
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      const rr = range.getBoundingClientRect();
      const host = range.startContainer.parentElement;
      const panel = host.closest(".ch-panel, .ch-dial");
      const pr = panel ? panel.getBoundingClientRect() : null;
      return { found, inChapter: !!host.closest("[data-chapter]"), hidden: !!host.closest("[aria-hidden='true']"), rect: [rr.left, rr.top, rr.width, rr.height], inPanel: !!pr && rr.left >= pr.left - 1 && rr.right <= pr.right + 1 && rr.width > 0 };
    }, t);
    if (!r.found || !r.inChapter || r.hidden || !r.inPanel) miss.push({ text: t, ...r });
  }
  report("findReachesEveryItem", vp.spec, theme, miss.length === 0, { searched: texts.length, misses: miss });
  const years = ["2024", "2022", "2021", "2017"];
  const hits = [];
  for (const y of years) {
    const r = await page.evaluate((needle) => {
      window.getSelection().removeAllRanges();
      const ex = document.getElementById("experience");
      window.scrollTo({ top: ex.getBoundingClientRect().top + scrollY - 10, behavior: "instant" });
      const found = window.find(needle, true, false, false, false, false, false);
      if (!found) return { found };
      const range = window.getSelection().getRangeAt(0);
      const host = range.startContainer.parentElement;
      const rr = range.getBoundingClientRect();
      const clip = host.closest(".ch-panel");
      const cr = clip ? clip.getBoundingClientRect() : null;
      return { found, hidden: !!host.closest("[aria-hidden='true'], [inert]"), inWheel: !!host.closest(".yw"), visible: rr.width > 0 && rr.height > 0, insideClip: !!cr && rr.left >= cr.left - 1 && rr.right <= cr.right + 1 && rr.top >= cr.top - 1 && rr.bottom <= cr.bottom + 1, text: host.textContent.trim().slice(0, 40) };
    }, y);
    hits.push({ needle: y, ...r });
  }
  const ok = hits.every((h) => h.found && !h.hidden && !h.inWheel && h.visible && h.insideClip);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  return report("findHitsOnlyVisibleText", vp.spec, theme, ok, { hits });
}

/** Tab through one chapter's links from the element before it: after each step the marked entry is the one the
 *  focus ring is in (pinned: its beat; flow: its row brought onto the reading line), and Tab leaves in DOM order */
async function focusChapter(page, vp, id) {
  const g = await geoOf(page, id);
  await scrollTo(page, g.top - vp.height);
  await settled(page);
  await page.evaluate((cid) => {
    const s = document.getElementById(cid);
    const all = [...document.querySelectorAll("a[href], button:not([disabled])")].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed");
    const firstIn = all.findIndex((e) => s.contains(e));
    all[firstIn - 1].focus({ preventScroll: true });
  }, id);
  const steps = [];
  let left = null;
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    await sleep(650);
    await settled(page);
    const r = await page.evaluate((cid) => {
      const a = document.activeElement;
      const s = document.getElementById(cid);
      if (!s.contains(a)) return { inside: false, tag: a?.tagName, text: (a?.textContent || a?.getAttribute("aria-label") || "").trim().slice(0, 30) };
      const item = Number(a.closest("[data-item]")?.dataset.item ?? -1);
      const sub = a.closest("[data-beat]");
      const c = window.__chapters.list.find((x) => x.id === cid);
      const beat = sub ? Number(sub.dataset.beat) : item;
      const r = a.getBoundingClientRect();
      const lit = s.querySelector("li[data-item][data-active]");
      return { inside: true, label: (a.getAttribute("aria-label") || a.textContent).trim().slice(0, 30), beat, shown: c.shown, litEntry: lit ? Number(lit.dataset.item) : -1, focusEntry: item, onScreen: r.top >= 0 && r.bottom <= innerHeight };
    }, id);
    if (!r.inside) { if (steps.length) { left = r; break; } else continue; }
    steps.push(r);
  }
  return { steps, left };
}

async function focusChecks(page, vp, theme) {
  const L = await list(page);
  const chapters = L.filter((x) => x.mode === "pinned" || x.mode === "flow");
  if (!chapters.length) { report("focusFollows", vp.spec, theme, null, { note: "no marked chapter" }); return report("tabLeavesChapter", vp.spec, theme, null, { note: "no marked chapter" }); }
  const per = {};
  let follows = true, leaves = true;
  for (const c of chapters) {
    const { steps, left } = await focusChapter(page, vp, c.id);
    const ok = steps.length > 0 && steps.every((s) => s.shown === s.beat && s.litEntry === s.focusEntry && s.onScreen);
    if (!ok) follows = false;
    if (!left || !steps.length) leaves = false;
    per[c.id] = { mode: c.mode, follows: ok, steps, landedOn: left };
  }
  report("focusFollows", vp.spec, theme, follows, Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { mode: v.mode, follows: v.follows, steps: v.steps }])));
  return report("tabLeavesChapter", vp.spec, theme, leaves, Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { linksVisited: v.steps.length, landedOn: v.landedOn }])));
}

async function anchorsAtPin0(vp, theme) {
  const out = {};
  let ok = true;
  for (const id of ["experience", "education"]) {
    const { ctx, page } = await openPage(vp, theme, { hash: `#${id}` });
    await sleep(1200);
    await settled(page);
    const g = await geoOf(page, id);
    const c = await chapter(page, id);
    const sy = await page.evaluate(() => scrollY);
    const atTop = Math.abs(sy - Math.min(g.top, (await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)))) <= 2;
    const pin0 = c.mode !== "pinned" || c.pin === 0;
    // pinned: item 0 marked at pin 0. Flow (the variant): a mark shows, and the CSS rail agrees with the dots — every
    // seated dot sits on the filled rail (above the reading line) and every unseated one on the unfilled rail
    let rail = null;
    if (c.mode === "flow") {
      rail = await page.evaluate((cid) => {
        const s = document.getElementById(cid);
        const line = 0.62 * document.documentElement.clientHeight;
        const fg = getComputedStyle(s.querySelector(".ch-rail-track")).backgroundColor;
        return [...s.querySelectorAll(".ch-dot")].map((d, i) => {
          const r = d.getBoundingClientRect();
          const seated = getComputedStyle(d).backgroundColor === fg && Math.abs(r.width - 10) < 0.6;
          return { i, seated, filled: r.top + r.height / 2 <= line };
        });
      }, id);
    }
    const railAgrees = rail === null || rail.every((d) => d.seated === d.filled);
    const marked = c.mode === "pinned" ? c.shown === 0 : c.mode === "flow" ? c.shown >= 0 : true;
    if (!atTop || !pin0 || !marked || !railAgrees) ok = false;
    out[id] = { mode: c.mode, scrollY: Math.round(sy), sectionTop: Math.round(g.top), pin: c.pin, shown: c.shown, ...(rail ? { dots: rail.map((d) => `${d.i}:${d.seated ? "seated" : "grey"}/${d.filled ? "filled" : "unfilled"}`).join(" "), railAgrees } : {}) };
    await ctx.close();
  }
  return report("anchorsAtPin0", vp.spec, theme, ok, out);
}

/** where the reader is: the shown row's viewport top (inside a chapter) or an element's viewport top */
async function readerPlace(page, id) {
  return page.evaluate((cid) => {
    const s = document.getElementById(cid);
    const shown = window.__chapters.list.find((x) => x.id === cid).shown;
    const li = s.querySelectorAll("li[data-item]")[Math.max(0, shown)];
    return { shown, rowTop: li.getBoundingClientRect().top, mode: s.dataset.mode, pin: window.__chapters.list.find((x) => x.id === cid).pin, vh: innerHeight, line: Math.round(0.62 * document.documentElement.clientHeight) };
  }, id);
}

async function keepPlaceOnResize(vp, theme) {
  if (vp.spec !== "1440x900") return;
  const rows = [];
  let ok = true;
  // mid-Experience and mid-Education: the shown entry is held
  for (const [id, beat] of [["experience", 2], ["education", 1]]) {
    const { ctx, page } = await openPage(vp, theme);
    await scrollTo(page, await yForBeat(page, id, beat));
    await settled(page);
    await sleep(300); // the director takes the reader's place at scroll rest; a resize restores it
    const a = await readerPlace(page, id);
    await page.setViewportSize({ width: 1440, height: 700 });
    await sleep(500); await settled(page);
    const b = await readerPlace(page, id);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(500); await settled(page);
    const c = await readerPlace(page, id);
    // at 700 px the chapter flows: the held entry sits on the reading line (± 40); back at 900 it is marked again
    const heldAt700 = b.mode === "flow" ? Math.abs(b.rowTop - b.line) <= 40 && b.shown === beat : b.shown === beat;
    const back = c.shown === beat && (c.mode !== "pinned" || Math.abs(c.rowTop - a.rowTop) <= 40);
    if (!heldAt700 || !back) ok = false;
    rows.push({ place: `mid-${id}`, beat, at900: a, at700: { ...b, offLine: Math.round(b.rowTop - b.line) }, back900: c });
    await ctx.close();
  }
  // below the chapters: the element at the viewport centre keeps its viewport top
  {
    const { ctx, page } = await openPage(vp, theme);
    const y = await page.evaluate(() => document.getElementById("projects").getBoundingClientRect().top + scrollY + 200);
    await scrollTo(page, y); await settled(page); await sleep(300);
    const probe = () => page.evaluate(() => { const h = document.querySelector("#projects h2") || document.querySelector("#projects"); return h.getBoundingClientRect().top; });
    const a = await probe();
    await page.setViewportSize({ width: 1440, height: 700 }); await sleep(500); await settled(page);
    const b = await probe();
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(500); await settled(page);
    const c = await probe();
    const held = Math.abs(b - a) <= 40 && Math.abs(c - a) <= 40;
    if (!held) ok = false;
    rows.push({ place: "below the chapters (Projects' heading)", at900: Math.round(a), at700: Math.round(b), back900: Math.round(c) });
    await ctx.close();
  }
  return report("keepPlaceOnResize", vp.spec, theme, ok, { rows });
}

async function liveReduceToggle(vp, theme) {
  if (vp.spec !== "1440x900" || REDUCE) return;
  const { ctx, page } = await openPage(vp, theme);
  await scrollTo(page, await yForBeat(page, "education", 1));
  await settled(page);
  const a = await readerPlace(page, "education");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sleep(800);
  const L = await list(page);
  const b = await page.evaluate(() => { const s = document.getElementById("education"); const li = s.querySelectorAll("li[data-item]")[1]; return { rowTop: li.getBoundingClientRect().top, line: Math.round(0.62 * document.documentElement.clientHeight) }; });
  const statics = L.every((c) => c.mode === "static");
  const marks = await activeCounts(page);
  const ok = statics && marks.items === 0 && Math.abs(b.rowTop - b.line) <= 40;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await ctx.close();
  return report("liveReduceToggle", vp.spec, theme, ok, { before: a, afterRowTop: Math.round(b.rowTop), line: b.line, offLine: Math.round(b.rowTop - b.line), modes: L.map((c) => c.mode), marks });
}

/** E1: a hard load of /#education at a viewport where Experience passes PIN_QUERY but fails bandFits */
async function hashLoadFailsBand(theme) {
  // one-column pinned windows (700–1023 wide) lose 88 px of band to the compact dial row: search for a height where
  // the Experience panel no longer fits
  let found = null;
  for (const w of [760, 720, 700]) {
    for (let h = 720; h <= 860 && !found; h += 20) {
      const vp = parseVp(`${w}x${h}`);
      const { ctx, page } = await openPage(vp, theme);
      const c = await chapter(page, "experience");
      await ctx.close();
      if (c.mode === "flow") found = vp;
    }
    if (found) break;
  }
  if (!found) return report("hashLoadFailsBand", "search 700–760 × 720–860", theme, null, { note: "Experience fits its band at every searched window ≥ 720 tall; nothing to test" });
  const { ctx, page } = await openPage(found, theme, { hash: "#education" });
  await sleep(1500);
  const r = await page.evaluate(() => { const s = document.getElementById("education"); return { top: Math.round(s.getBoundingClientRect().top), modeExp: document.getElementById("experience").dataset.mode }; });
  await ctx.close();
  return report("hashLoadFailsBand", found.spec, theme, Math.abs(r.top) <= 4 && r.modeExp === "flow", { educationViewportTop: r.top, experienceMode: r.modeExp });
}

async function liveResizes(vp, theme) {
  if (vp.spec !== "1440x900" && vp.spec !== "390x844m") return;
  const path_ = vp.kind === "phone"
    ? [[390, 844], [844, 390], [390, 844], [430, 932], [375, 667], [390, 844]]
    : [[1440, 900], [1440, 700], [1440, 900], [1100, 900], [900, 900], [760, 900], [1440, 780], [1280, 720], [1280, 719], [1440, 900]];
  const { ctx, page } = await openPage(vp, theme);
  await scrollTo(page, await yForBeat(page, "experience", 3));
  await settled(page);
  await sleep(300);
  const steps = [];
  let ok = true;
  for (const [w, h] of path_) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(450);
    await settled(page);
    const L = await list(page);
    const p = await readerPlace(page, "experience");
    const sane = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    const held = p.shown === 3;
    if (!held || !sane) ok = false;
    steps.push({ size: `${w}x${h}`, modes: L.map((c) => `${c.id}:${c.mode}`).join(" "), shown: p.shown, rowTop: Math.round(p.rowTop), noHorizontalScroll: sane });
  }
  await ctx.close();
  return report("liveResizes", vp.spec, theme, ok, { steps });
}

async function reducedStatic(page, vp, theme) {
  const r = await page.evaluate(() => ({
    modes: [...document.querySelectorAll("[data-chapter]")].map((s) => s.dataset.mode),
    active: document.querySelectorAll("[data-active]").length,
    pinProgress: [...document.querySelectorAll(".ch-rail")].map((e) => getComputedStyle(e).getPropertyValue("--pin-progress").trim()).filter(Boolean).length,
    sticky: [...document.querySelectorAll(".ch-stage")].filter((e) => getComputedStyle(e).position === "sticky").length,
    readout: [...document.querySelectorAll(".ch-dial .yw-range")].map((e) => getComputedStyle(e).display !== "none" ? e.dataset.y : null),
  }));
  // scroll the whole page: still nothing marked
  for (const f of [0.2, 0.4, 0.6]) { await scrollTo(page, f * (await page.evaluate(() => document.documentElement.scrollHeight))); await sleep(250); }
  const after = await activeCounts(page);
  const ok = r.modes.every((m) => m === "static") && r.active === 0 && r.pinProgress === 0 && r.sticky === 0 && after.items === 0;
  return report("reducedStatic", vp.spec, theme, ok, { ...r, afterScroll: after });
}

async function liveReduceStopsCanvases(vp, theme) {
  if (vp.spec !== "1440x900" || REDUCE) return;
  const { ctx, page } = await openPage(vp, theme);
  await page.waitForFunction(() => !!window.__field && window.__field.entered, null, { timeout: 40000 }).catch(() => {});
  // the card scene too: bring the heatmap into view so it mounts
  await page.evaluate(() => { const s = document.getElementById("projects").nextElementSibling; window.scrollTo({ top: s.getBoundingClientRect().top + scrollY - 100, behavior: "instant" }); });
  await page.waitForFunction(() => !!window.__jacks, null, { timeout: 30000 }).catch(() => {});
  const before = await page.evaluate(() => ({ field: !!document.querySelector("div.fixed.inset-0.z-10.pointer-events-none canvas"), card: !!document.querySelector(".col-start-2.row-span-3 canvas"), fluid: !!document.querySelector("canvas.fixed") }));
  const rainSample = () => page.evaluate(() => { const c = [...document.querySelectorAll("canvas")].find((x) => getComputedStyle(x.parentElement).zIndex === "0"); const g = c.getContext("2d"); const d = g.getImageData(0, 0, Math.min(400, c.width), Math.min(400, c.height)).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0; return h; });
  const t0 = Date.now();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sleep(1000);
  const after = await page.evaluate(() => ({ field: !!document.querySelector("div.fixed.inset-0.z-10.pointer-events-none canvas"), card: !!document.querySelector(".col-start-2.row-span-3 canvas") }));
  const r1 = await rainSample(); await sleep(400); const r2 = await rainSample();
  const ok = !after.field && !after.card && r1 === r2;
  await ctx.close();
  return report("liveReduceStopsCanvases", vp.spec, theme, ok, { before, afterOneSecond: after, rainStill: r1 === r2, ms: Date.now() - t0, note: "the fluid stops on the next load (its locked mount path is untouched)" });
}

async function fluidInPin(page, vp, theme) {
  const L = await list(page);
  const c = L.find((x) => x.mode === "pinned");
  if (!c || vp.mobile) return report("fluidInPin", vp.spec, theme, null, { note: c ? "touch: the fluid does not take the pointer on phones" : "no pinned chapter" });
  const g = await geoOf(page, c.id);
  await scrollTo(page, g.top + 0.5 * (g.height - g.stageH));
  await frames(page, 2);
  const r = await page.evaluate((cid) => {
    const s = document.getElementById(cid);
    const panel = s.querySelector(".ch-panel").getBoundingClientRect();
    const dial = s.querySelector(".ch-dial").getBoundingClientRect();
    const fluid = document.querySelector("canvas.fixed");
    const pts = [[Math.max(4, panel.left - 24), panel.top + 20], [Math.max(4, (dial.right + panel.left) / 2), dial.bottom + 40], [panel.left + panel.width / 2, Math.min(innerHeight - 4, panel.bottom + 18)], [Math.min(innerWidth - 4, panel.right + 20), innerHeight / 2]];
    return pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return { x: Math.round(x), y: Math.round(y), hit: el === fluid ? "fluid" : `${el?.tagName}.${String(el?.className || "").slice(0, 30)}` }; });
  }, c.id);
  return report("fluidInPin", vp.spec, theme, r.every((p) => p.hit === "fluid"), { points: r });
}

// ---- pixels ----
function decode(file) {
  // reuse capture-top's PNG decoder through ssimFiles' module
  return import("./capture-top.mjs").then((m) => m.decodePng(file));
}
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const Lstar = (Y) => (Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y);

async function glassBlurIntact(page, vp, theme) {
  const L = await list(page);
  const c = L.find((x) => x.mode === "pinned");
  if (!c || ANGLE_NAME !== "metal") return report("glassBlurIntact", vp.spec, theme, null, { note: !c ? "no pinned chapter" : "metal only" });
  const stats = async (file, rect) => {
    const { w, ch, px } = await decode(file);
    const Lp = (x, y) => { const o = (y * w + x) * ch; return 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; };
    let hf = 0, n = 0;
    for (let y = rect.y + 1; y < rect.y + rect.h - 1; y++) for (let x = rect.x + 1; x < rect.x + rect.w - 1; x++) { const v = Lp(x, y); hf += Math.abs(4 * v - Lp(x - 1, y) - Lp(x + 1, y) - Lp(x, y - 1) - Lp(x, y + 1)); n++; }
    return +(hf / n).toFixed(3);
  };
  const excite = async (x0, y0) => { for (let i = 0; i <= 14; i++) { await page.mouse.move(Math.max(2, x0 - 200 + i * 14), y0 + i * 20, { steps: 2 }); await sleep(12); } await page.mouse.move(4, vp.height - 4); await sleep(200); };
  const g = await geoOf(page, c.id);
  const measure = async (state, mod) => {
    await page.evaluate((m) => {
      const p = document.querySelector("#experience .ch-panel");
      p.style.backdropFilter = m === "raw" ? "none" : ""; p.style.webkitBackdropFilter = m === "raw" ? "none" : "";
    }, mod);
    const r = await page.evaluate((sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, state === "control" ? "#connect .glass, #projects .glass" : "#experience .ch-panel");
    await excite(r.x, r.y + 40);
    await page.evaluate(() => { const s = document.createElement("style"); s.id = "vm-tx"; s.textContent = ".ch-panel *, .glass * { color: transparent !important; opacity: 0 !important; }"; document.head.appendChild(s); });
    await frames(page, 2);
    const f = path.join(OUT, `_glass-${vp.spec}-${theme}-${state}.png`);
    await page.screenshot({ path: f });
    await page.evaluate(() => document.getElementById("vm-tx")?.remove());
    const x0 = Math.max(0, Math.ceil(r.x + 12)), y0 = Math.max(0, Math.ceil(r.y + 12));
    const x1 = Math.min(vp.width, Math.floor(r.x + r.w - 12)), y1 = Math.min(vp.height, Math.floor(r.y + r.h - 12));
    const hf = await stats(f, { x: x0 * vp.dpr, y: y0 * vp.dpr, w: (x1 - x0) * vp.dpr, h: (y1 - y0) * vp.dpr });
    fs.rmSync(f, { force: true });
    return hf;
  };
  await scrollTo(page, g.top + 0.5 * (g.height - g.stageH)); await frames(page, 3);
  const pinned = await measure("pinned", null);
  const raw = await measure("raw", "raw");
  await page.evaluate(() => { const p = document.querySelector("#experience .ch-panel"); p.style.backdropFilter = ""; p.style.webkitBackdropFilter = ""; });
  await scrollTo(page, await page.evaluate(() => { const e = document.querySelector("#connect .glass, #projects .glass"); return e.getBoundingClientRect().top + scrollY - 200; }));
  await frames(page, 3);
  const control = await measure("control", null);
  const intact = pinned <= 0.5 * raw && pinned <= Math.max(1.6 * control, control + 0.4);
  return report("glassBlurIntact", vp.spec, theme, intact, { hfPinned: pinned, hfRaw: raw, hfControl: control, overRaw: +(pinned / raw).toFixed(2), overControl: +(pinned / control).toFixed(2) });
}

/** pixel contrast of every row over the live canvases, at three pins (or three beats in flow) */
async function contrastRows(page, vp, theme) {
  const L = await list(page);
  const worst = { inactive: Infinity, active: Infinity, index: Infinity, activeIndex: Infinity, tintDL: Infinity, headTintDL: Infinity };
  const byChapter = {};
  const fails = [];
  let rowsMeasured = 0;
  const parse = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  for (const c of L) {
    const beats = c.layout.length > 2 ? [0, Math.floor(c.layout.length / 2), c.layout.length - 1] : [...c.layout.keys()];
    for (const b of beats) {
      await scrollTo(page, await yForBeat(page, c.id, b));
      await settled(page);
      await page.mouse.move(Math.round(vp.width * 0.3), Math.round(vp.height * 0.45));
      await page.mouse.move(Math.round(vp.width * 0.33), Math.round(vp.height * 0.55), { steps: 6 });
      await page.mouse.move(4, vp.height - 4);
      await sleep(250);
      const boxes = await page.evaluate((cid) => {
        const s = document.getElementById(cid);
        const out = [];
        for (const el of s.querySelectorAll(".ch-panel .ch-name, .ch-panel .ch-role, .ch-panel .ch-line, .ch-panel .ch-stack, .ch-panel .ch-index")) {
          if (el.querySelector(".ch-line")) continue; // a degree wrapper: its own lines are measured
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) continue;
          const cs = getComputedStyle(el);
          const sub = el.closest("[data-sub]");
          const item = el.closest("[data-item]");
          const kind = el.classList.contains("ch-index") ? "index" : sub ? (sub.hasAttribute("data-active") ? "active" : "inactive") : (item.hasAttribute("data-active") ? "activeHead" : "head");
          out.push({ kind, color: cs.color, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, text: el.textContent.trim().slice(0, 24), activeItem: item.hasAttribute("data-active") });
        }
        return out;
      }, c.id);
      await page.evaluate(() => { const s = document.createElement("style"); s.id = "vm-tx"; s.textContent = "[data-chapter] .ch-panel * { color: transparent !important; -webkit-text-fill-color: transparent !important; } [data-chapter] .ch-panel img { opacity: 0 !important; }"; document.head.appendChild(s); });
      await frames(page, 2);
      const f = path.join(OUT, `_contrast.png`);
      await page.screenshot({ path: f });
      await page.evaluate(() => document.getElementById("vm-tx")?.remove());
      const img = await decode(f);
      for (const box of boxes) {
        const col = parse(box.color);
        const x0 = Math.max(0, Math.floor(box.rect.x * vp.dpr)), y0 = Math.max(0, Math.floor(box.rect.y * vp.dpr));
        const x1 = Math.min(img.w, Math.ceil((box.rect.x + box.rect.w) * vp.dpr)), y1 = Math.min(img.h, Math.ceil((box.rect.y + box.rect.h) * vp.dpr));
        const Ls = [];
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * img.w + x) * img.ch; Ls.push(lum(img.px[o], img.px[o + 1], img.px[o + 2])); sr += img.px[o]; sg += img.px[o + 1]; sb += img.px[o + 2]; n++; }
        if (!n) continue;
        Ls.sort((a, z) => a - z);
        // the worst background for this text's polarity: the brightest 10 % under light text, the darkest under dark text
        const textY = lum(col.r * col.a + (sr / n) * (1 - col.a), col.g * col.a + (sg / n) * (1 - col.a), col.b * col.a + (sb / n) * (1 - col.a));
        const bgMean = lum(sr / n, sg / n, sb / n);
        const bgY = textY > bgMean ? Ls[Math.floor(0.9 * (Ls.length - 1))] : Ls[Math.floor(0.1 * (Ls.length - 1))];
        const cr = contrast(textY, bgY);
        rowsMeasured++;
        const need = box.kind === "active" ? 7 : 4.5;
        const key = box.kind === "active" ? "active" : box.kind === "index" ? (box.activeItem ? "activeIndex" : "index") : box.kind === "inactive" ? "inactive" : null;
        if (key) worst[key] = Math.min(worst[key], cr);
        if (key === "inactive") { const k = `${c.id}:${c.mode}`; byChapter[k] = Math.min(byChapter[k] ?? Infinity, +cr.toFixed(2)); }
        if ((box.kind === "active" || box.kind === "inactive" || box.kind === "index") && cr < need) fails.push({ chapter: c.id, beat: b, kind: box.kind, text: box.text, contrast: +cr.toFixed(2) });
      }
      // the tints' visibility: the SAME box (the active line; the active head row's right end, clear of the logo
      // and the link) with its tint on and off, text hidden, the rain's wrapper hidden for these two shots (its
      // glyph streaks would be noise between two moments; the fluid and the jacks stay live)
      const boxes2 = await page.evaluate((cid) => {
        const s = document.getElementById(cid);
        // one mark per entry (data-grain="entry"): the ONE tint, measured over the active entry right of the logo
        // column and clear of the link icon; otherwise the active line's tint and the head row's right end
        if (s.dataset.grain === "entry") {
          const li = s.querySelector("li[data-item][data-active]");
          if (!li) return { a: null, ha: null };
          const r = li.getBoundingClientRect();
          return { a: { x: r.left + 80, y: r.top + 6, w: Math.max(4, r.width - 130), h: Math.max(4, r.height - 12) }, ha: null };
        }
        const a = s.querySelector("[data-sub][data-active]");
        const ha = s.querySelector("li[data-active] .ch-head");
        const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 2, w: Math.max(4, r.width - 80), h: Math.max(4, r.height - 4) }; };
        const headBox = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.right - 150, y: r.top + 3, w: 100, h: Math.max(4, r.height - 6) }; };
        return { a: box(a), ha: headBox(ha) };
      }, c.id);
      const rainWrap = `[...document.querySelectorAll("canvas")].map((c) => c.parentElement).find((p) => getComputedStyle(p).zIndex === "0")`;
      await page.evaluate((w) => { const el = eval(w); if (el) el.style.visibility = "hidden"; const st = document.createElement("style"); st.id = "vm-tx"; st.textContent = "[data-chapter] .ch-panel * { color: transparent !important; -webkit-text-fill-color: transparent !important; } [data-chapter] .ch-panel img { opacity: 0 !important; }"; document.head.appendChild(st); }, rainWrap);
      await frames(page, 2);
      const fOn = path.join(OUT, "_tint-on.png"), fOff = path.join(OUT, "_tint-off.png");
      await page.screenshot({ path: fOn });
      await page.evaluate(() => { const st = document.createElement("style"); st.id = "vm-notint"; st.textContent = "[data-chapter] .ch-sub::before, [data-chapter] .ch-head::after, [data-chapter] .ch-item::before { opacity: 0 !important; transition: none !important; }"; document.head.appendChild(st); });
      await frames(page, 2);
      await page.screenshot({ path: fOff });
      await page.evaluate((w) => { document.getElementById("vm-notint")?.remove(); document.getElementById("vm-tx")?.remove(); const el = eval(w); if (el) el.style.visibility = ""; }, rainWrap);
      const on = await decode(fOn), off = await decode(fOff);
      const meanL = (im, r) => { if (!r) return null; let sum = 0, n = 0; for (let y = Math.floor(r.y * vp.dpr); y < (r.y + r.h) * vp.dpr; y++) for (let x = Math.floor(r.x * vp.dpr); x < (r.x + r.w) * vp.dpr; x++) { if (x < 0 || y < 0 || x >= im.w || y >= im.h) continue; const o = (y * im.w + x) * im.ch; sum += Lstar(lum(im.px[o], im.px[o + 1], im.px[o + 2])); n++; } return n ? sum / n : null; };
      const dLine = boxes2.a ? Math.abs(meanL(on, boxes2.a) - meanL(off, boxes2.a)) : null;
      const dHead = boxes2.ha ? Math.abs(meanL(on, boxes2.ha) - meanL(off, boxes2.ha)) : null;
      if (dLine !== null) worst.tintDL = Math.min(worst.tintDL, dLine);
      if (dHead !== null) worst.headTintDL = Math.min(worst.headTintDL, dHead);
      fs.rmSync(fOn, { force: true }); fs.rmSync(fOff, { force: true });
      fs.rmSync(f, { force: true });
    }
  }
  const fmt = (v) => (Number.isFinite(v) ? +v.toFixed(2) : null);
  const ok = fails.length === 0 && (worst.tintDL === Infinity || worst.tintDL >= 3) && (worst.headTintDL === Infinity || worst.headTintDL >= 3);
  return report("contrastRows", vp.spec, theme, ok, { rowsMeasured, worstInactive: fmt(worst.inactive), worstActiveLine: fmt(worst.active), worstIndex: fmt(worst.index), worstActiveIndex: fmt(worst.activeIndex), worstInactiveByChapter: byChapter, tintDeltaLstar: fmt(worst.tintDL), headTintDeltaLstar: fmt(worst.headTintDL), fails: fails.slice(0, 10) });
}

async function accentBudget(page, vp, theme) {
  const L = await list(page);
  const rows = [];
  let ok = true;
  for (const c of L) {
    await page.mouse.move(2, vp.height - 2); // park the pointer: a hovered link turning accent is interaction, not a mark
    await scrollTo(page, await yForBeat(page, c.id, Math.min(1, c.layout.length - 1)));
    await settled(page);
    await sleep(250);
    const r = await page.evaluate((cid) => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const probe = document.createElement("div"); probe.style.color = accent; document.body.appendChild(probe);
      const [ar, ag, ab] = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number); probe.remove();
      const hue = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return null; const d = mx - mn; let h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d; h *= 60; return h < 0 ? h + 360 : h; };
      const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
      const aHue = hue(ar, ag, ab);
      const isAccentish = (str) => {
        if (!str || str === "transparent" || str === "none") return false;
        const m = str.match(/(rgba?|oklab|color)\(([^)]+)\)/);
        if (!m) return false;
        const probe2 = document.createElement("div"); probe2.style.color = str; document.body.appendChild(probe2);
        const cs = getComputedStyle(probe2).color; probe2.remove();
        const cv = document.createElement("canvas"); cv.width = cv.height = 1; const g = cv.getContext("2d"); g.fillStyle = cs; g.fillRect(0, 0, 1, 1);
        const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data;
        if (a < 4) return false;
        const h = hue(r, gg, b);
        return h !== null && Math.abs(h - aHue) < 18 && sat(r, gg, b) > 0.25;
      };
      const s = document.getElementById(cid);
      const active = s.querySelector("li[data-item][data-active]");
      const offenders = [];
      const visible = (cs) => cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.01 && !/matrix\(1, 0, 0, 0,|matrix\(0,|scaleY\(0\)/.test(cs.transform) && !(cs.transform !== "none" && new DOMMatrixReadOnly(cs.transform).d === 0);
      for (const el of s.querySelectorAll("*")) {
        for (const pseudo of [null, "::before", "::after"]) {
          const cs = getComputedStyle(el, pseudo);
          if (pseudo && (cs.content === "none" || cs.content === "normal")) continue;
          if (!visible(cs)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && !pseudo) continue;
          const ownText = !pseudo && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          const painted = [cs.backgroundColor, ownText || el.tagName === "svg" ? cs.color : null, cs.borderTopWidth !== "0px" && cs.borderTopStyle !== "none" ? cs.borderTopColor : null];
          if (painted.some(isAccentish) && !(active && active.contains(el))) offenders.push(`${el.className || el.tagName}${pseudo ?? ""}`);
        }
      }
      return { mode: s.dataset.mode, activeItem: active ? Number(active.dataset.item) : -1, offenders: [...new Set(offenders)].slice(0, 10) };
    }, c.id);
    const good = r.offenders.length === 0 && (REDUCE ? r.activeItem === -1 : r.activeItem >= 0);
    if (!good) ok = false;
    rows.push({ id: c.id, ...r });
  }
  return report("accentBudget", vp.spec, theme, ok, { rows });
}

/** On a FRESH page (as zeroRafMidChapter): the checks before it stir the field — noSkipOnNotch parks the pointer
 *  at the centre and wheels — and 60 stepped frames did not bring the jacks home (one run read −13.5 px where a
 *  fresh page reads +76). The pointer is never moved (it has never been over the canvas), the entrance is
 *  stepped through, and the field is idle before the first sample. */
async function titleClearOfPacks(vp, theme) {
  const { ctx, page } = await openPage(vp, theme);
  try {
    return await titleClearOn(page, vp, theme);
  } finally {
    await ctx.close();
  }
}

async function titleClearOn(page, vp, theme) {
  await sleep(1500); // the field's gate and deferred birth (idle + 500 ms)
  const has = await page.evaluate(() => !!window.__field);
  const L = await list(page);
  const c = L.find((x) => x.mode === "pinned");
  if (!has || !c) return report("titleClearOfPacks", vp.spec, theme, null, { note: !has ? "no jack field at this viewport (the gate: ≥ 640 px, fine pointer)" : "no pinned chapter" });
  await page.waitForFunction(() => window.__field.entered, null, { timeout: 40000 });
  await page.evaluate(() => { const j = window.__field; while (j.entranceT < 12) j.step(1 / 60); });
  await page.waitForFunction(() => window.__field.idle, null, { timeout: 120000, polling: 250 });
  const g = await geoOf(page, c.id);
  const rows = [];
  let worst = Infinity;
  for (const pin of [0, 0.5, 1]) {
    await scrollTo(page, g.top + pin * (g.height - g.stageH));
    await frames(page, 3);
    await page.evaluate(() => { const j = window.__field; for (let i = 0; i < 60; i++) j.step(1 / 60); });
    const r = await page.evaluate((cid) => {
      const t = document.querySelector(`#${cid} .ch-title-text`).getBoundingClientRect();
      const wheel = document.querySelector(`#${cid} .ch-readout`).getBoundingClientRect();
      const j = window.__field;
      const TAN = Math.tan((12.5 * Math.PI) / 180);
      const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
      let min = Infinity;
      for (const b of j.bodies()) {
        const ppu = h / 2 / ((j.camZ - b.z) * TAN);
        const cx = w / 2 + b.x * ppu, cy = h / 2 - b.y * ppu, r = b.r * ppu;
        for (const box of [t, wheel]) {
          const dx = Math.max(box.left - cx, 0, cx - box.right), dy = Math.max(box.top - cy, 0, cy - box.bottom);
          min = Math.min(min, Math.hypot(dx, dy) - r);
        }
      }
      return { title: [t.left, t.top, t.right, t.bottom].map(Math.round), minClearancePx: +min.toFixed(1), corridor: window.__chapters.list.find((x) => x.id === cid).corridor };
    }, c.id);
    worst = Math.min(worst, r.minClearancePx);
    rows.push({ pin, ...r });
  }
  return report("titleClearOfPacks", vp.spec, theme, worst >= 0, { worstClearancePx: worst, rows });
}

/** on a FRESH page with the pointer never moved (the field and the rain at their own rest cadence): the chapter
 *  code runs 0 callbacks at rest mid-chapter; rAF calls and executed callbacks per second are recorded against
 *  Spike 0's f4b738f baseline */
async function zeroRafMidChapter(vp, theme) {
  const { ctx, page } = await openPage(vp, theme);
  await page.waitForFunction(() => performance.now() >= 9000, null, { timeout: 30000, polling: 250 });
  const L = await list(page);
  const rows = [];
  let ok = true;
  for (const c of L) {
    await scrollTo(page, await yForBeat(page, c.id, Math.floor(c.layout.length / 2)));
    await settled(page);
    await sleep(3000);
    const a = await page.evaluate(() => ({ cb: window.__chapters.callbacks, by: window.__chapters.callbackBreakdown, raf: window.__raf.calls, exec: window.__raf.exec, t: performance.now() }));
    await sleep(4000);
    const b = await page.evaluate(() => ({ cb: window.__chapters.callbacks, by: window.__chapters.callbackBreakdown, raf: window.__raf.calls, exec: window.__raf.exec, t: performance.now() }));
    const secs = (b.t - a.t) / 1000;
    const cb = b.cb - a.cb;
    if (cb !== 0) ok = false;
    // every chapter callback counts: the runtimes', the director's own and the scroll store's (callbackBreakdown)
    const moved = Object.fromEntries(Object.keys(b.by).map((k) => [k, b.by[k] - (a.by[k] ?? 0)]).filter(([, v]) => v !== 0));
    rows.push({ id: c.id, mode: c.mode, chapterCallbacks: cb, which: moved, rafCallsPerSec: +((b.raf - a.raf) / secs).toFixed(1), rafExecPerSec: +((b.exec - a.exec) / secs).toFixed(1) });
  }
  await ctx.close();
  return report("zeroRafMidChapter", vp.spec, theme, ok, { rows, baselineMidPage: vp.spec === "1440x900" ? "Spike 0 f4b738f Metal 1440×900 mid-page: 120.3 calls/s, 90.3 exec/s" : null });
}

/** rAF calls and executed callbacks per second on a PLAIN URL (no ?chapterDebug, no ?jacksDebug: their hooks run
 *  frames of their own — 95.5 exec/s mid-Experience with the flags against 89.9 without), a fresh page, the
 *  pointer never moved: at the top, mid-Experience and mid-Education, each after 3 s of rest, over 4 s. These are
 *  the PR's rAF numbers, against Spike 0's plain f4b738f baseline (mid-page 120.3 calls/s, 90.3 exec/s at 1440). */
async function rafPlain(vp, theme) {
  const { ctx, page } = await openPage(vp, theme, { plain: true });
  await page.waitForFunction(() => performance.now() >= 9000, null, { timeout: 30000, polling: 250 });
  const where = {
    top: () => 0,
    midExperience: () => page.evaluate(() => { const s = document.getElementById("experience"); const st = s.querySelector(".ch-stage"); const top = s.getBoundingClientRect().top + scrollY; const travel = s.offsetHeight - st.clientHeight; return travel > 0 ? top + travel / 2 : top + s.offsetHeight / 2 - innerHeight / 2; }),
    midEducation: () => page.evaluate(() => { const s = document.getElementById("education"); return s.getBoundingClientRect().top + scrollY + s.offsetHeight / 2 - innerHeight / 2; }),
  };
  const rows = {};
  for (const [name, y] of Object.entries(where)) {
    await scrollTo(page, await y());
    await sleep(3000);
    const a = await page.evaluate(() => ({ raf: window.__raf.calls, exec: window.__raf.exec, t: performance.now() }));
    await sleep(4000);
    const b = await page.evaluate(() => ({ raf: window.__raf.calls, exec: window.__raf.exec, t: performance.now() }));
    const secs = (b.t - a.t) / 1000;
    rows[name] = { rafCallsPerSec: +((b.raf - a.raf) / secs).toFixed(1), rafExecPerSec: +((b.exec - a.exec) / secs).toFixed(1) };
  }
  await ctx.close();
  return report("rafPlain", vp.spec, theme, null, { rows, baseline: vp.spec === "1440x900" ? "Spike 0 f4b738f Metal 1440×900 plain URL, mid-page: 120.3 calls/s, 90.3 exec/s" : null });
}

async function docHeight(page, vp, theme) {
  const doch = (() => { try { return JSON.parse(fs.readFileSync(path.join(BASELINE, "index.json"), "utf8")).docH; } catch { return {}; } })();
  // Spike 0 measured desktop sizes with desktop emulation and 390×844 with phone emulation: a tablet run (touch,
  // so the heatmap is flat) has no like-for-like base
  const key = vp.kind === "phone" ? `${vp.width}x${vp.height}m` : vp.kind === "desktop" ? `${vp.width}x${vp.height}` : null;
  const base = key ? doch[key] : null;
  const r = await page.evaluate(() => {
    const s = (id) => { const e = document.getElementById(id); return { h: e.getBoundingClientRect().height, mode: e.dataset.mode, vh: Number(getComputedStyle(e).getPropertyValue("--chapter-vh")), stageH: e.querySelector(".ch-stage").clientHeight }; };
    return { docH: document.documentElement.scrollHeight, experience: s("experience"), education: s("education") };
  });
  const pinnedOk = ["experience", "education"].every((id) => r[id].mode !== "pinned" || Math.abs(r[id].h - (r[id].vh * r[id].stageH) / 100) <= 1);
  let expected = null, diff = null;
  if (base) {
    expected = base.docH - base.experience.h - base.education.h + r.experience.h + r.education.h;
    diff = r.docH - expected;
  }
  const ok = pinnedOk && (diff === null || Math.abs(diff) <= 40);
  return report("docHeight", vp.spec, theme, ok, { docH: r.docH, baseDocH: base?.docH ?? null, expected: expected === null ? null : Math.round(expected), diff: diff === null ? null : Math.round(diff), experience: { h: Math.round(r.experience.h), mode: r.experience.mode }, education: { h: Math.round(r.education.h), mode: r.education.mode }, pinnedHeightIsVhTimesSvh: pinnedOk });
}

async function restAtTopIdentical(vp, theme) {
  if (vp.spec !== "1440x900" || REDUCE) return;
  const { ctx, page, errors } = await openPage(vp, theme);
  await scrollTo(page, 0);
  await page.waitForFunction(() => !!window.__field && window.__field.entered && window.__field.fit, null, { timeout: 45000 });
  await page.evaluate(() => { const j = window.__field; while (j.entranceT < 10.5) j.step(1 / 60); });
  await page.waitForFunction(() => window.__field.idle, null, { timeout: 120000, polling: 250 });
  const r = await page.evaluate(() => { const j = window.__field; return { passes: j.passes, bodies: j.bodies().length, programs: j.programs, glassPrograms: j.glassPrograms, keepOuts: j.keepOuts.length, tier: j.tier }; });
  const ok = r.passes === 42 && r.bodies === 21 && r.programs === 3 && r.glassPrograms === 1 && errors.length === 0;
  await ctx.close();
  return report("restAtTopIdentical", vp.spec, theme, ok, { ...r, errors });
}

/** the home page's initial JS (every script and module preload in the built index.html), raw and gzipped; run
 *  from the repo so .next is at hand. Budget (DESIGN §6): ≤ 272 KB gz, against 264 KB on f4b738f. */
function initialBytes() {
  const html = fs.readFileSync(path.join(".next", "server", "app", "index.html"), "utf8");
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const pre = [...html.matchAll(/<link[^>]+rel="(?:module)?preload"[^>]+href="([^"]+\.js)"/g)].map((m) => m[1]);
  let raw = 0, gz = 0, files = 0;
  for (const src of [...new Set([...srcs, ...pre])]) {
    const buf = fs.readFileSync(path.join(".next", src.replace(/^\/_next\//, "").replace(/\?.*$/, "")));
    raw += buf.length; gz += zlib.gzipSync(buf).length; files++;
  }
  const gzKB = +(gz / 1024).toFixed(1);
  // the harness runs against a REVIEW build (its ?chapterDebug surface compiles out of production): say which this
  // is, so the PR body reports the production number (`npm run build` without the flag) beside it
  const review = fs.readdirSync(path.join(".next", "static", "chunks")).filter((f) => f.endsWith(".js")).some((f) => fs.readFileSync(path.join(".next", "static", "chunks", f), "utf8").includes("chapterDebug"));
  return report("initialBytes", "-", "-", review ? null : gzKB <= 272, { build: review ? "review (NEXT_PUBLIC_REVIEW_FLAGS=1): recorded, the budget is asserted on a production build" : "production", files, rawKB: +(raw / 1024).toFixed(1), gzKB, budgetKB: 272, baseKB: 264 });
}

async function restAtTopPixels() {
  const out = path.join(OUT, "top");
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  let ok = true;
  for (const spec of ["1440x900", "1512x982", "390x844m"]) for (const theme of THEMES) {
    const rec = await captureTop(browser, { url: URL_, theme, spec, out, label: "top", log: () => {} });
    const ref = path.join(BASELINE, path.basename(rec.file));
    const r = await ssimFiles(ref, rec.file, { masks: masksFromSidecar(ref.replace(/\.png$/, ".json")) });
    if (!(r.ssim >= 0.99)) ok = false;
    rows.push({ spec, theme, ssim: r.ssim, worstTile: r.worstTile, stepFrom: rec.field.stepFrom?.entranceT ?? null });
  }
  return report("restAtTopPixels", "3 viewports", THEMES.join(","), ok, { threshold: 0.99, rows, baseline: BASELINE });
}

// ---------------------------------------------------------------------------------------------------------------
// fix round 1: the checks the review asked for

/** the live-line row: the last entry whose top has crossed 62 % of the client height now (and the one the 24 px
 *  hysteresis may still hold) */
function liveLineRows(page, id) {
  return page.evaluate((cid) => {
    const s = document.getElementById(cid);
    const line = Math.round(0.62 * document.documentElement.clientHeight);
    const tops = [...s.querySelectorAll("li[data-item]")].map((li) => li.getBoundingClientRect().top);
    let fwd = -1, back = -1;
    tops.forEach((t, k) => { if (t <= line) fwd = k; if (t <= line + 24) back = k; });
    const c = window.__chapters.list.find((x) => x.id === cid);
    return { line, tops: tops.map(Math.round), fwd, back, shown: c.shown, target: c.target, mode: c.mode };
  }, id);
}

/** a HEIGHT-ONLY resize with a flow chapter on a non-last entry: the mark is the row on the LIVE reading line
 *  (the one line the director re-measures), never one computed from the old height */
async function keepPlaceHeightOnly(vp, theme) {
  if (vp.spec !== "1440x900") return;
  const rows = [];
  let ok = true;
  const cases = [
    { from: "1440x900", id: "education", beat: 0, to: [1440, 700], nudge: 0 },
    { from: "1440x700", id: "experience", beat: 1, to: [1440, 560], nudge: 1 },
  ];
  for (const k of cases) {
    const { ctx, page } = await openPage(parseVp(k.from), theme);
    const c0 = await chapter(page, k.id);
    await scrollTo(page, await yForBeat(page, k.id, k.beat));
    await settled(page);
    await sleep(300);
    const a = await liveLineRows(page, k.id);
    await page.setViewportSize({ width: k.to[0], height: k.to[1] });
    await sleep(500); await settled(page);
    if (k.nudge) { await page.evaluate((d) => window.scrollBy({ top: d, behavior: "instant" }), k.nudge); await sleep(200); await settled(page); }
    const b = await liveLineRows(page, k.id);
    const good = c0.mode === "flow" && b.mode === "flow" && b.shown >= b.fwd && b.shown <= Math.max(b.fwd, b.back) && b.shown === k.beat;
    if (!good) ok = false;
    rows.push({ case: `${k.id} beat ${k.beat} in flow, ${k.from} → ${k.to.join("x")}${k.nudge ? `, scrollBy(${k.nudge})` : ""}`, before: a, after: b, good });
    await ctx.close();
  }
  return report("keepPlaceHeightOnly", vp.spec, theme, ok, { rows });
}

/** mark the element at the viewport centre (outside the chapters: the deepest box spanning the centre line) */
const markCentre = (page) => page.evaluate(() => {
  document.querySelectorAll("[data-vm-anchor]").forEach((e) => e.removeAttribute("data-vm-anchor"));
  const y = innerHeight / 2;
  const main = document.querySelector("main");
  let node = [...main.children, ...document.querySelectorAll("body > footer")].find((el) => { const r = el.getBoundingClientRect(); return r.top <= y && r.bottom > y; });
  for (let d = 0; node && d < 12; d++) {
    const child = [...node.children].find((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && r.top <= y && r.bottom > y; });
    if (!child) break;
    node = child;
  }
  if (!node) return null;
  node.setAttribute("data-vm-anchor", "");
  return { top: node.getBoundingClientRect().top, tag: `${node.tagName}.${String(node.className).slice(0, 24)}`, inChapter: !!node.closest("[data-chapter]") };
});
const anchorTop = (page) => page.evaluate(() => { const e = document.querySelector("[data-vm-anchor]"); return e ? e.getBoundingClientRect().top : null; });
/** scroll 30 px every 16 ms until y ≥ to (the reader's momentum), then stop */
const scrollOn = (page, to) => page.evaluate((t) => new Promise((res) => { const id = setInterval(() => { const y = Math.min(t, scrollY + 30); window.scrollTo({ top: y, behavior: "instant" }); if (y >= t) { clearInterval(id); res(); } }, 16); }), to);

/** a resize WHILE the reader is scrolling: the place they are at holds (± 40 px), not the last rest place */
async function resizeMidScroll(vp, theme) {
  if (vp.spec !== "1440x900") return;
  const rows = [];
  let ok = true;
  const cases = [
    { name: "rest mid-Experience, scroll on below Education, width 1440 → 1400", to: [1400, 900], where: "below" },
    { name: "rest mid-Experience, scroll on below Education, height 900 → 700 (Experience flips to flow above)", to: [1440, 700], where: "below" },
    { name: "rest above Experience, scroll on into mid-Experience (pinned), width 1440 → 1400", to: [1400, 900], where: "inside" },
    { name: "rest mid-Experience, scroll on into mid-Projects, width 1440 → 1000 (Projects reflows inside, its top barely moves)", to: [1000, 900], where: "midProjects" },
  ];
  for (const k of cases) {
    const { ctx, page } = await openPage(vp, theme);
    const ex = await chapter(page, "experience");
    const ed = await geoOf(page, "education");
    const start = k.where === "inside" ? ex.pageTop - 600 : await yForBeat(page, "experience", 2);
    await scrollTo(page, start); await settled(page); await sleep(400); // a rest place is captured here
    const rest = await page.evaluate(() => window.__chapters.restPlace);
    const pr = k.where === "midProjects" ? await page.evaluate(() => { const e = document.getElementById("projects"); const r = e.getBoundingClientRect(); return { top: r.top + scrollY, height: r.height }; }) : null;
    const target = k.where === "inside" ? ex.pageTop + 0.5 * (ex.height - ex.stageH) : pr ? pr.top + pr.height / 2 - 450 : ed.top + ed.height + 350;
    await scrollOn(page, target);
    let before;
    // inside the pinned chapter the place is its pin; the entry that pin marks is the target (shown may still be one
    // riffle step behind it at the instant the scroll stops)
    if (k.where === "inside") before = await page.evaluate(() => { const c = window.__chapters.list.find((x) => x.id === "experience"); return { shown: c.shown, target: c.target, pin: c.pin, scrollY }; });
    else before = await markCentre(page);
    const stale = await page.evaluate(() => window.__chapters.restStale);
    await page.setViewportSize({ width: k.to[0], height: k.to[1] });
    await sleep(600); await settled(page);
    let after, good;
    if (k.where === "inside") {
      after = await page.evaluate(() => { const c = window.__chapters.list.find((x) => x.id === "experience"); return { shown: c.shown, pin: c.pin, scrollY, mode: c.mode }; });
      good = after.shown === before.target && Math.abs(after.pin - before.pin) <= 0.03;
    } else {
      const t = await anchorTop(page);
      after = { top: t };
      good = before && t !== null && Math.abs(t - before.top) <= 40;
    }
    if (!good) ok = false;
    const corr = await page.evaluate(() => window.__chapters.corrections.slice(-2));
    rows.push({ case: k.name, restPlaceKind: rest?.kind ?? null, restStaleAtResize: stale, before, after, good, lastCorrections: corr.map((c) => ({ kind: c.place.kind, y: c.y === null ? null : Math.round(c.y), from: Math.round(c.from) })) });
    await ctx.close();
  }
  return report("resizeMidScroll", vp.spec, theme, ok, { rows });
}

/** WCAG 1.4.12 text spacing, and a 24 px default font: the director re-measures, and at every size nothing
 *  overlaps, clips or leaves the viewport — the titles' glyphs included; the year wheel keeps its own metrics */
async function textSpacing(vp, theme) {
  const overrides = {
    "wcag-1.4.12": "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }",
    "root-24px": "html { font-size: 24px !important; }",
  };
  const out = {};
  let ok = true;
  for (const [name, css] of Object.entries(overrides)) {
    const { ctx, page } = await openPage(vp, theme);
    await page.addStyleTag({ content: css });
    await sleep(700); await settled(page);
    const modes = Object.fromEntries((await list(page)).map((c) => [c.id, c.mode]));
    const sane = await layoutSane(page, vp, theme, `textSpacing:${name}`);
    const fits = (await list(page)).some((c) => c.mode === "pinned") ? await pinnedOnlyWhenFits(page, vp, theme) : null;
    const wheel = await page.evaluate(() => {
      const cell = document.querySelector("#experience .yw-cell");
      const cs = getComputedStyle(cell, "::before");
      return { fontPx: parseFloat(cs.fontSize), lineHeightPx: parseFloat(cs.lineHeight), heightPx: parseFloat(cs.height) };
    });
    const wheelOk = Math.abs(wheel.lineHeightPx - wheel.fontPx) <= 0.5 && Math.abs(wheel.heightPx - wheel.fontPx) <= 0.5;
    if (!sane.pass || (fits && fits.pass === false) || !wheelOk) ok = false;
    out[name] = { modes, layoutSane: sane.pass, problems: sane.problems, pinnedOnlyWhenFits: fits ? fits.pass : "no pinned chapter", yearWheelGlyph: { ...wheel, ok: wheelOk } };
    await ctx.close();
  }
  return report("textSpacing", vp.spec, theme, ok, out);
}

/** every row link's hit area, by elementFromPoint (not the ::after box): its text centre hits it, and its vertical
 *  reach through the centre is ≥ 24 px (WCAG 2.5.8; stacked inline links are 24, not 44); pinned and flow */
async function touchTargets(page, vp, theme) {
  const L = await list(page);
  const rows = [];
  let ok = true;
  for (const c of L.filter((x) => x.mode === "pinned" || x.mode === "flow")) {
    if (c.mode === "pinned") { const g = await geoOf(page, c.id); await scrollTo(page, g.top + 0.5 * (g.height - g.stageH)); await settled(page); }
    const n = await page.evaluate((cid) => document.querySelectorAll(`#${cid} .ch-panel a`).length, c.id);
    for (let i = 0; i < n; i++) {
      if (c.mode === "flow") {
        await page.evaluate(({ cid, k }) => { const a = document.querySelectorAll(`#${cid} .ch-panel a`)[k]; const r = a.getBoundingClientRect(); window.scrollBy({ top: Math.round(r.top - innerHeight / 2), behavior: "instant" }); }, { cid: c.id, k: i });
        await frames(page, 2);
      }
      const r = await page.evaluate(({ cid, k }) => {
        const a = document.querySelectorAll(`#${cid} .ch-panel a`)[k];
        const rect = a.getClientRects()[0];
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const mine = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === a || a.contains(e)); };
        let up = 0; while (up < 40 && mine(cx, cy - up - 1)) up++;
        let dn = 0; while (dn < 40 && mine(cx, cy + dn + 1)) dn++;
        const blocker = (y) => { const e = document.elementFromPoint(cx, y); return e ? `${e.tagName}.${String(e.className).split(" ")[0]}` : null; };
        return { label: (a.getAttribute("aria-label") || a.textContent).trim().slice(0, 28), kind: a.classList.contains("ch-link") ? "icon" : "text", centreHits: mine(cx, cy), vertical: up + dn + 1, blockedAbove: blocker(cy - up - 1), blockedBelow: blocker(cy + dn + 1) };
      }, { cid: c.id, k: i });
      if (!r.centreHits || r.vertical < 24) ok = false;
      rows.push({ chapter: c.id, mode: c.mode, ...r });
    }
  }
  if (!rows.length) return report("touchTargets", vp.spec, theme, null, { note: "no marked chapter" });
  const minBy = (kind) => Math.min(...rows.filter((x) => x.kind === kind).map((x) => x.vertical));
  return report("touchTargets", vp.spec, theme, ok, { links: rows.length, minVerticalText: minBy("text"), minVerticalIcon: minBy("icon"), rows: rows.map((x) => `${x.chapter}/${x.mode} ${x.kind} "${x.label}" ${x.vertical}px${x.centreHits ? "" : " CENTRE-MISS"} (↑${x.blockedAbove} ↓${x.blockedBelow})`) });
}

/** print is not a window: emulating print leaves every mode and mark alone, the marks print neutral, and the round
 *  trip back to the screen moves nothing */
async function printNeutral(vp, theme) {
  if (vp.spec !== "1440x900" || REDUCE) return;
  const { ctx, page } = await openPage(vp, theme);
  const rows = [];
  let ok = true;
  for (const [id, beat] of [["experience", 2], ["education", 1]]) {
    await scrollTo(page, await yForBeat(page, id, beat)); await settled(page); await sleep(300);
    const before = await page.evaluate(() => ({ y: Math.round(scrollY), modes: window.__chapters.list.map((c) => `${c.id}:${c.mode}:${c.shown}`).join(" "), corrections: window.__chapters.corrections.length, evaluations: window.__chapters.evaluations }));
    await page.emulateMedia({ media: "print" });
    await sleep(600);
    const inPrint = await page.evaluate(() => {
      const legend = (() => { const d = document.createElement("div"); d.style.color = "var(--legend)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })();
      const act = document.querySelector("[data-sub][data-active]");
      const tick = act ? getComputedStyle(act.querySelector(".ch-tick")).display : null;
      const tint = act ? getComputedStyle(act.closest("li"), "::before").display : null;
      return { modes: window.__chapters.list.map((c) => `${c.id}:${c.mode}:${c.shown}`).join(" "), activeLineColour: act ? getComputedStyle(act).color : null, legend, tint, tick, wheelsShowRange: [...document.querySelectorAll(".yw-range")].every((e) => getComputedStyle(e).display !== "none") };
    });
    await page.emulateMedia({ media: "screen" });
    await sleep(800); await settled(page);
    const after = await page.evaluate(() => ({ y: Math.round(scrollY), modes: window.__chapters.list.map((c) => `${c.id}:${c.mode}:${c.shown}`).join(" "), corrections: window.__chapters.corrections.length }));
    const good = inPrint.modes === before.modes && (inPrint.activeLineColour === null || inPrint.activeLineColour === inPrint.legend) && inPrint.tint !== "block" && inPrint.wheelsShowRange && Math.abs(after.y - before.y) <= 2 && after.modes === before.modes && after.corrections === before.corrections;
    if (!good) ok = false;
    rows.push({ from: `${id} beat ${beat}`, before, inPrint, after, good });
  }
  await ctx.close();
  return report("printNeutral", vp.spec, theme, ok, { rows });
}

/** a hard load of /#experience, /#education and /#projects: the first paint is the hydrated layout — total
 *  non-input CLS ≤ 0.01 on each load, and on desktop the display title never shifts (it waits unseen for its
 *  corridor). Every phone and tablet size, and three desktops: geometry, not colour, so the first theme only. */
async function hashLoadCls(vp, theme) {
  if (REDUCE) return;
  const loads = {};
  let ok = true;
  for (const hash of ["#experience", "#education", "#projects"]) {
    const { ctx, page } = await openPage(vp, theme, { hash });
    await sleep(2500);
    const r = await page.evaluate(() => ({ shifts: window.__shifts, dialTop: getComputedStyle(document.getElementById("experience")).getPropertyValue("--ch-dial-top").trim(), modes: window.__chapters.list.map((c) => `${c.id}:${c.mode}`).join(" ") }));
    await ctx.close();
    const live = r.shifts.filter((x) => !x.input);
    const cls = live.reduce((n, x) => n + x.v, 0);
    const dial = live.filter((x) => x.dial);
    if (cls > 0.01 || dial.length) ok = false;
    loads[hash] = { cls: +cls.toFixed(4), entries: live.length, worst: live.length ? { t: live.reduce((a, b) => (b.v > a.v ? b : a)).t, v: +Math.max(...live.map((x) => x.v)).toFixed(4) } : null, dialShifts: dial.length, dialTop: r.dialTop || null, modes: r.modes };
  }
  return report("hashLoadCls", vp.spec, theme, ok, { budget: 0.01, loads });
}

/** frames produced per second mid-chapter at rest (a CDP trace: DrawFrame / BeginMainThreadFrame over 8 s); the
 *  brief's PR 1 row is "measured" — recorded here against the rain's 30 + the field's cadence */
async function framesMidChapter(vp, theme) {
  if (REDUCE) return;
  const { ctx, page } = await openPage(vp, theme);
  await page.waitForFunction(() => performance.now() >= 9000, null, { timeout: 30000, polling: 250 });
  const rows = [];
  for (const c of await list(page)) {
    await scrollTo(page, await yForBeat(page, c.id, Math.floor(c.layout.length / 2)));
    await settled(page);
    await sleep(2000);
    await browser.startTracing(page, { categories: ["disabled-by-default-devtools.timeline.frame"] });
    const t0 = Date.now();
    await sleep(8000);
    const buf = await browser.stopTracing();
    const secs = (Date.now() - t0) / 1000;
    const ev = JSON.parse(buf.toString()).traceEvents;
    const n = (name) => ev.filter((e) => e.name === name).length;
    rows.push({ id: c.id, mode: c.mode, drawFramesPerSec: +(n("DrawFrame") / secs).toFixed(1), mainFramesPerSec: +(n("BeginMainThreadFrame") / secs).toFixed(1) });
  }
  await ctx.close();
  return report("framesMidChapter", vp.spec, theme, null, { rows, budget: "PR 1: measured (DESIGN §6); after PR 4: ≤ the rain's 30 + the field's cadence" });
}

/** flow mode's rail fill is CSS sticky: scrolling through a flow chapter writes nothing to the rail, and the
 *  fill's tip rides the reading line */
async function flowFillZeroJs(page, vp, theme) {
  const L = await list(page);
  const c = L.find((x) => x.mode === "flow");
  if (!c) return report("flowFillZeroJs", vp.spec, theme, null, { note: "no flow chapter" });
  await page.evaluate((cid) => {
    window.__railMut = 0;
    const mo = new MutationObserver((recs) => { window.__railMut += recs.length; });
    mo.observe(document.querySelector(`#${cid} .ch-rail`), { subtree: true, attributes: true, childList: true });
    window.__railMo = mo;
  }, c.id);
  const g = await geoOf(page, c.id);
  let worst = 0, samples = 0;
  for (let y = g.top - g.vh; y <= g.top + g.height; y += 23) {
    await scrollTo(page, y); await frames(page, 1);
    const r = await page.evaluate((cid) => {
      const rail = document.querySelector(`#${cid} .ch-rail`).getBoundingClientRect();
      const cover = document.querySelector(`#${cid} .ch-rail-cover`).getBoundingClientRect();
      const line = 0.62 * document.documentElement.clientHeight;
      return { inSpan: line > rail.top + 1 && line < rail.bottom - 1, off: cover.top - line };
    }, c.id);
    if (r.inSpan) { worst = Math.max(worst, Math.abs(r.off)); samples++; }
  }
  const mut = await page.evaluate(() => { window.__railMo.disconnect(); return window.__railMut; });
  return report("flowFillZeroJs", vp.spec, theme, mut === 0 && worst <= 2, { chapter: c.id, railMutations: mut, samplesOnLine: samples, worstTipOffLinePx: +worst.toFixed(2) });
}

/** the LCP element stays in the hero, never a chapter (a fresh load, no input). The brief's `lcpIsH1` assumed the
 *  h1; measured on the f4b738f build it is HeroMeta's "San Francisco" line in 5 loads of 6 and the h1 in 1 (the h1
 *  fades in from opacity 0, which LCP only sometimes counts) — so the check is that PR 1 moves nothing into it */
async function lcpInHero(vp, theme) {
  if (REDUCE) return;
  const { ctx, page } = await openPage(vp, theme);
  await sleep(3000);
  const r = await page.evaluate(() => new Promise((res) => {
    new PerformanceObserver((l) => {
      const es = l.getEntries();
      const e = es[es.length - 1];
      const el = e?.element;
      const rect = el?.getBoundingClientRect?.();
      res({ entries: es.length, text: el ? (el.textContent || "").trim().slice(0, 24) : null, isH1: !!el?.closest?.("h1, [data-hero-h1]"), inChapter: !!el?.closest?.("[data-chapter]"), firstScreen: rect ? rect.top + scrollY < innerHeight : false, t: e ? Math.round(e.startTime) : null });
    }).observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => res({ entries: 0 }), 2000);
  }));
  await ctx.close();
  return report("lcpInHero", vp.spec, theme, r.entries > 0 && !r.inChapter && r.firstScreen, r);
}

/** WebGL contexts: desktop 3 (fluid, field, card), phone 1 (DESIGN §6) */
async function contexts(vp, theme) {
  if (REDUCE) return;
  const { ctx, page } = await openPage(vp, theme);
  if (!vp.mobile) await page.waitForFunction(() => !!window.__field && window.__field.entered, null, { timeout: 40000 }).catch(() => {});
  else await sleep(4000);
  const top = await page.evaluate(() => window.__gl.contexts);
  await page.evaluate(() => { const s = document.getElementById("projects").nextElementSibling; window.scrollTo({ top: s.getBoundingClientRect().top + scrollY - 100, behavior: "instant" }); });
  await sleep(3000);
  if (!vp.mobile) await page.waitForFunction(() => !!window.__jacks, null, { timeout: 20000 }).catch(() => {});
  const all = await page.evaluate(() => window.__gl.contexts);
  await ctx.close();
  const budget = vp.mobile ? 1 : 3;
  return report("contexts", vp.spec, theme, all <= budget, { atTop: top, afterCard: all, budget });
}

// ---------------------------------------------------------------------------------------------------------------
// the run

const t0 = Date.now();
for (const spec of VIEWPORTS) {
  const vp = parseVp(spec);
  for (const theme of THEMES) {
    const core = CORE.has(spec);
    const { ctx, page, errors } = await openPage(vp, theme);
    try {
      if (want("chapterModes")) await chapterModes(page, vp, theme);
      if (REDUCE) {
        if (want("reducedStatic")) await reducedStatic(page, vp, theme);
        if (want("accentBudget")) await accentBudget(page, vp, theme);
        if (want("layoutSane")) await layoutSane(page, vp, theme);
        if (want("oneActive")) await oneActive(page, vp, theme);
        if (SHOTS && core) {
          await scrollTo(page, await yForBeat(page, "experience", 2)); await sleep(400);
          await shot(page, `reduced-${spec}-${theme}-experience`);
          await scrollTo(page, (await geoOf(page, "education")).top - 40); await sleep(400);
          await shot(page, `reduced-${spec}-${theme}-education`);
        }
      } else {
        if (want("layoutSane")) await layoutSane(page, vp, theme);
        if (want("pinnedOnlyWhenFits")) await pinnedOnlyWhenFits(page, vp, theme);
        if (want("oneActive")) await oneActive(page, vp, theme);
        if (want("activeItemMonotone")) await activeItemMonotone(page, vp, theme);
        if (want("noSkipOnNotch")) await noSkipOnNotch(page, vp, theme);
        if (want("headNeverLeads")) await headNeverLeads(page, vp, theme);
        if (want("commitOnBeat")) await commitOnBeat(page, vp, theme);
        if (want("railMatchesPin")) await railMatchesPin(page, vp, theme);
        if (want("accentBudget")) await accentBudget(page, vp, theme);
        if (want("fluidInPin")) await fluidInPin(page, vp, theme);
        if (want("docHeight")) await docHeight(page, vp, theme);
        if (core || spec === "1280x720" || spec === "768x1024t") {
          if (want("findReachesEveryItem") || want("findHitsOnlyVisibleText")) await findChecks(page, vp, theme);
        }
        // keyboard focus in pinned AND flow chapters: Education flows at every desktop size, both chapters on phones
        if ((core || spec === "1280x720" || spec === "768x1024t" || spec === "844x390m") && (want("focusFollows") || want("tabLeavesChapter"))) await focusChecks(page, vp, theme);
        if ((CONTRAST.has(spec) || spec === "844x390m") && want("touchTargets")) await touchTargets(page, vp, theme);
        if (CONTRAST.has(spec) && want("flowFillZeroJs")) await flowFillZeroJs(page, vp, theme);
        if (CONTRAST.has(spec) && want("contrastRows")) await contrastRows(page, vp, theme);
        if (core && want("glassBlurIntact")) await glassBlurIntact(page, vp, theme);
      }
      if (errors.length) report("pageErrors", spec, theme, false, { errors });
    } catch (err) {
      report("harnessError", spec, theme, false, { error: String(err).slice(0, 400) });
    }
    await ctx.close();
    if (!REDUCE) {
      if (want("anchorsAtPin0") && (CORE.has(spec) || spec === "1280x720" || spec === "1920x1080" || spec === "2560x1440")) await anchorsAtPin0(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "anchorsAtPin0", error: String(e).slice(0, 300) }));
      if (want("keepPlaceOnResize")) await keepPlaceOnResize(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "keepPlaceOnResize", error: String(e).slice(0, 300) }));
      if (want("liveReduceToggle")) await liveReduceToggle(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "liveReduceToggle", error: String(e).slice(0, 300) }));
      if (want("liveResizes")) await liveResizes(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "liveResizes", error: String(e).slice(0, 300) }));
      if (want("liveReduceStopsCanvases")) await liveReduceStopsCanvases(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "liveReduceStopsCanvases", error: String(e).slice(0, 300) }));
      if (want("zeroRafMidChapter") && (CORE.has(spec) || spec === "1280x720" || spec === "768x1024t")) await zeroRafMidChapter(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "zeroRafMidChapter", error: String(e).slice(0, 300) }));
      if (want("titleClearOfPacks") && (spec === "1440x900" || spec === "1280x720" || spec === "1920x1080" || spec === "2560x1440")) await titleClearOfPacks(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "titleClearOfPacks", error: String(e).slice(0, 300) }));
      if (want("rafPlain") && (spec === "1440x900" || spec === "390x844m")) await rafPlain(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "rafPlain", error: String(e).slice(0, 300) }));
      if (want("restAtTopIdentical")) await restAtTopIdentical(vp, theme).catch((e) => report("harnessError", spec, theme, false, { check: "restAtTopIdentical", error: String(e).slice(0, 300) }));
      const guard = (name, fn) => (want(name) ? fn().catch((e) => report("harnessError", spec, theme, false, { check: name, error: String(e).slice(0, 300) })) : null);
      await guard("keepPlaceHeightOnly", () => keepPlaceHeightOnly(vp, theme));
      await guard("resizeMidScroll", () => resizeMidScroll(vp, theme));
      await guard("printNeutral", () => printNeutral(vp, theme));
      if (theme === THEMES[0] && (vp.mobile || spec === "1440x900" || spec === "1280x720" || spec === "1920x1080")) await guard("hashLoadCls", () => hashLoadCls(vp, theme));
      if (spec === "1440x900") await guard("framesMidChapter", () => framesMidChapter(vp, theme));
      if (core) await guard("lcpInHero", () => lcpInHero(vp, theme));
      if (core) await guard("contexts", () => contexts(vp, theme));
      // text spacing and a 24 px default font: geometry, not colour — once per size, in the first theme
      if (theme === THEMES[0] && MATRIX.includes(spec)) await guard("textSpacing", () => textSpacing(vp, theme));
    }
  }
}
if (!REDUCE && want("initialBytes")) { try { initialBytes(); } catch (e) { report("initialBytes", "-", "-", null, { note: `run from the repo root to read .next (${String(e).slice(0, 80)})` }); } }
if (!REDUCE && want("hashLoadFailsBand")) await hashLoadFailsBand(THEMES[0]).catch((e) => report("harnessError", "-", THEMES[0], false, { check: "hashLoadFailsBand", error: String(e).slice(0, 300) }));
if (!REDUCE && want("restAtTopPixels") && (!args.viewports || VIEWPORTS.includes("1440x900"))) await restAtTopPixels().catch((e) => report("harnessError", "-", "-", false, { check: "restAtTopPixels", error: String(e).slice(0, 300) }));

await browser.close();
const failed = results.filter((r) => r.pass === false);
const summary = { angle: ANGLE_NAME, reduce: REDUCE, viewports: VIEWPORTS, themes: THEMES, checks: results.length, failed: failed.length, info: results.filter((r) => r.pass === "info").length, secs: Math.round((Date.now() - t0) / 1000) };
const outName = `verify-motion${REDUCE ? "-reduce" : ""}-${ANGLE_NAME}-${THEMES.join("+")}${ONLY || args.viewports ? "-partial" : ""}${args.tag ? `-${args.tag}` : ""}.json`;
fs.writeFileSync(path.join(OUT, outName), JSON.stringify({ summary, results }, null, 1));
console.log("WROTE", path.join(OUT, outName));
console.log("SUMMARY", JSON.stringify(summary));
for (const f of failed) console.log("FAIL", f.check, f.viewport, f.theme, JSON.stringify(f).slice(0, 400));
process.exit(failed.length ? 1 : 0);
