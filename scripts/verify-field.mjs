// The jack field's verification harness (the report's headline numbers come from here). Runs
// against a production build served on `PORT` (default 3301) with headless Chromium on
// software GL, so every timing assertion is on `__field.simTime` (the `?jacksDebug=1` hook) and
// the world is driven with step()/kick() where a check needs a definite state. The field never
// FREEZES while the drift has an amplitude (fieldDrift.ts): at rest it idles at DRIFT.IDLE_HZ,
// so every "settled" wait here is on `__field.idle`, the scroll checks decide by STATE (E, the
// homes, the layout count) rather than by frame counts, and the idle cadence itself is measured.
// Also checks the built page's initial JS for three (it must stay behind dynamic()), the
// one-layer glass (two passes per jack on ONE program, groups ranked back to front), the PACKS
// (fieldPacks.ts: gathered, alive at the card's speed, tight, mixed, on the viewport, kicked by
// the ray one pack at a time, regathered after a click), in the light theme the rendered
// luminance of the discs (the ENV_LIGHT re-key), and the GitHub CARD's scene (`__jacks`): its
// dozen wear the hero's glass from the same module (jackGlass.ts) — two passes per jack on the
// one glass program, ranked back to front — checked in both themes, and cropped at DPR 2 after
// the entrance and after a flick (the wake ribbon over glass) by `card`.
//
//   node scripts/verify-field.mjs [--angle=swiftshader|metal] [port] [config]
//                                                         --angle: SwiftShader (default: sim-time asserts) or the real GPU
//                                                         (Metal: cadence; the idle/full ratio is asserted only when fullRate2s > 2·idleHz)
//   node scripts/verify-field.mjs [port] [config]         config: 1440x900-dark | 1440x900-light | 1024x768-dark | 1440x900-dark-quads (informational)
//   node scripts/verify-field.mjs [port] sweep            the light-theme env-intensity sweep
//   node scripts/verify-field.mjs [port] zoom             only the DPR-2 frames (1440 × 900, WIDE and QUADS, both themes): full, the lower pack, the largest jack
//   node scripts/verify-field.mjs [port] card             only the card's DPR-2 crops (both themes: after the entrance, after a flick; dark with three ghosts)
//
// Playwright is not a dependency of this repo; point PLAYWRIGHT at an installed copy.
import fs from "node:fs";
import path from "node:path";
const PW = process.env.PLAYWRIGHT ?? "/Users/wentaohe/.npm/_npx/520e866687cefe78/node_modules/playwright/index.mjs";
const { chromium } = await import(PW);
// flags (--angle=…) and positionals ([port] [config]) in any order
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.join("=") || true]; }));
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const port = positional[0] ?? "3301";
const only = positional[1];
const ANGLE = flags.angle === "metal" ? "metal" : "swiftshader";
const OUT = process.env.OUT ?? `/tmp/hero/v5${ANGLE === "metal" ? "-metal" : ""}`;
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ANGLE === "metal"
  ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
  : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const KNOWN = /_vercel\/(speed-)?insights|Failed to load resource: the server responded with a status of 404/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAN = Math.tan((12.5 * Math.PI) / 180);
const summary = {};

// --- the home page's initial JS must not carry three (the field is behind dynamic()) ---
function initialJs() {
  const html = fs.readFileSync(path.join(".next", "server", "app", "index.html"), "utf8");
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const pre = [...html.matchAll(/<link[^>]+rel="(?:module)?preload"[^>]+href="([^"]+\.js)"/g)].map((m) => m[1]);
  let totalKB = 0; const hits = [];
  for (const s of [...new Set([...srcs, ...pre])]) {
    const p = path.join(".next", s.replace(/^\/_next\//, "").replace(/\?.*$/, ""));
    try {
      const buf = fs.readFileSync(p, "utf8"); totalKB += buf.length / 1024;
      const m = buf.match(/OctahedronGeometry|LatheGeometry|MeshPhysicalMaterial|PMREMGenerator|WebGLRenderer|mergeVertices|mergeGeometries/g);
      if (m) hits.push({ chunk: s, kb: +(buf.length / 1024).toFixed(0), markers: [...new Set(m)] });
    } catch { hits.push({ chunk: s, error: "unreadable" }); }
  }
  return { scripts: srcs.length, preloads: pre.length, totalKB: +totalKB.toFixed(0), threeHits: hits, pass: hits.length === 0 };
}

async function decodePng(page, buf) {
  return page.evaluate(async (dataUrl) => {
    const im = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = dataUrl; });
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    return { w: im.width, h: im.height, data: Array.from(g.getImageData(0, 0, im.width, im.height).data) };
  }, `data:image/png;base64,${buf.toString("base64")}`);
}

// the mean colour of a 5 × 5 patch of the page at (x, y), from a fresh screenshot
async function samplePatch(page, x, y) {
  const shot = await page.screenshot();
  const px = await decodePng(page, shot);
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = Math.round(y) - 2; yy <= Math.round(y) + 2; yy++) for (let xx = Math.round(x) - 2; xx <= Math.round(x) + 2; xx++) {
    if (xx < 0 || yy < 0 || xx >= px.w || yy >= px.h) continue;
    const o = (yy * px.w + xx) * 4; r += px.data[o]; g += px.data[o + 1]; b += px.data[o + 2]; n++;
  }
  return [r / n, g / n, b / n];
}

// luminance over each body's disc (0.75 r, as the review measured), overall and per family
async function discLuminance(page, width, height) {
  const shot = await page.screenshot();
  const st = await page.evaluate(() => ({ bodies: window.__field.bodies(), camZ: window.__field.camZ, casting: window.__field.casting }));
  const px = await decodePng(page, shot);
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const all = [], byFamily = { accent: [], white: [], black: [] };
  st.bodies.forEach((b, i) => {
    const ppu = height / 2 / ((st.camZ - b.z) * TAN);
    const cx = width / 2 + b.x * ppu, cy = height / 2 - b.y * ppu, rad = 0.75 * b.r * ppu;
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(height, cy + rad); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(width, cx + rad); x++) {
      if (Math.hypot(x - cx, y - cy) > rad) continue;
      const o = (y * px.w + x) * 4; const L = 0.2126 * lin(px.data[o]) + 0.7152 * lin(px.data[o + 1]) + 0.0722 * lin(px.data[o + 2]);
      all.push(L); byFamily[st.casting[i].family].push(L);
    }
  });
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3) : null; };
  return { median: q(all, 0.5), p10: q(all, 0.1), p90: q(all, 0.9), perFamily: Object.fromEntries(Object.entries(byFamily).map(([f, a]) => [f, { median: q(a, 0.5), n: a.length }])) };
}

async function open(width, height, theme, dpr = 1, variant = null, extra = "") {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  const errors = [], known = [];
  page.on("console", (m) => { if (m.type() === "error") (KNOWN.test(m.text()) ? known : errors).push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} window.__ctxLost = 0; document.addEventListener("webglcontextlost", () => { window.__ctxLost++; }, true); }, theme);
  await page.goto(`http://localhost:${port}/?jacksDebug=1${variant ? `&jacksPacks=${variant}` : ""}${extra}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => !!window.__field && window.__field.entered && window.__field.fit, null, { timeout: 40000, polling: 100 });
  return { browser, page, errors, known };
}
// AT REST is the idle cadence while the drift is on (settled, E 0, no live pointer, nothing faster than
// DRIFT.IDLE_V) and the FREEZE when AMP = AMP_Z = 0 — one predicate for every "settled" wait, so the harness can
// verify the documented restore path too. Page-side functions: self-contained, serialised by Playwright.
const atRest = () => (window.__field.drifting ? window.__field.idle : window.__field.frozen);
const atRestSettled = () => (window.__field.drifting ? window.__field.idle : window.__field.frozen) && window.__field.keepOutsSettled;
const waitRest = (page, timeout, settled = false) => page.waitForFunction(settled ? atRestSettled : atRest, null, { timeout, polling: 250 });
// step past the entrance beat, then wait for rest
async function settle(page) {
  await page.evaluate(() => { const j = window.__field; while (j.entranceT < 10.5) j.step(1 / 60); });
  await waitRest(page, 180000);
}
// WAKE DETECTION (the controller's ruling, 2026-09-17). A per-run FULL-RATE REFERENCE — frames over 2 s with E 1,
// taken right after the flick — is measured every run. The idle and scroll windows assert the MECHANISM always
// (idle true, E 0, at least one frame, no more than 2·idleHz + 6 per 2 s) and assert the RATIO to the reference
// (≤ 0.8 of it) ONLY when the machine outruns the idle timer: fullRate2s > 2·idleHz. On the owner's Mac the pair
// is ≈ 40 f/s idle vs a 60 Hz rAF at full rate (ratio ≈ 0.67) — the discriminating measurement, recorded in the
// report. Under software GL the full rate (4.5–6.5 f/s measured here) is BELOW the timer's 30 Hz, so idle and full
// rate collapse together and no ratio can discriminate (measured 0.54, 1.08, 1.2, 1.33 on consecutive runs of one
// build): the ratio branch is skipped and `ratioChecked: false` is recorded in the summary. In addition, the scene
// counts `__field.busyFrames` — every frame that scheduled the next one at full rate (invalidate) rather than by
// the idle timer or by freezing — so "nothing woke the loop" is also asserted directly as `busyFrames` unchanged
// across the window, whatever the machine's frame rate.
// gl.info.programs.length on this build with ONE glass program — measured 3 on 2026-09-17 (swiftshader, both
// themes): "jack-glass" (every glass material AND the pre-pass share it — glassPrograms 1) plus the two the
// environment bake compiles (PMREMGenerator.fromScene: the rig plane's material and the blur pass). The pre-pass
// added none; a fourth program here would mean the two passes diverged.
const PROGRAMS = 3;
// THE PACKS' BOUNDS (the brief's, measured in node against this worktree; the packs review's fixes, 2026-09-17). Gathered: mean
// |pos − target| per pack ≤ 0.45·√n·(1 + 0.1·(gain − 1)) — 1.68 for the fourteen (gain 1; measured 1.14–1.30), 1.43 for the ×3
// seven (the gained pack jams LOOSER: an E-frozen seven read 1.17–1.29, a re-jam after the scroll excursion 1.28, a click at a
// tight pre-click phase 1.226 — all over the flat 1.19), 1.42 for the ten at gain 1.9 → 1.55; a lattice rested at < 0.15, the
// packs sit under compression — and every member within 4 u of its pack's solved centroid (measured farthest 2.2–2.9). Alive:
// mean |vel| over the bodies ≥ 0.08 u/s over 2 s at E 1 — the card measures 0.113, the lattice's sixteen 0.002, a seven on a 0.9 u
// disc ungained 0.025 (the OLD number); node 0.095–0.231 across eight phases. Tight at E 1: ≤ 1.2 (seven) / 1.45 (ten) / 1.7
// (fourteen) in the wake window and ≤ 1.25× that in the steady window — THIS is the pivot's guard: with the pivots deleted (the
// origin swirl, gains kept) the seven reads 1.78–1.90 at wake and 2.37–2.47 steady, its farthest member 5.5 u from the centroid
// (shipped 0.75–0.99 / 0.83–0.99 / ≤ 2.5). The origin swirl does not DRAG a pinned, pulled pack, it WIDENS it. Stay is therefore a
// WANDER sanity bound on the drift-PAUSED window: a pack's mean has a chaotic floor of 0.04–0.09 u per 2 s at E 1 with no drift at
// all (node and browser, any gain; the origin swirl reads 0.008–0.096 there too, so no form of Stay discriminates), flat 0.15.
const GATHER = (n, gain = 1) => 0.45 * Math.sqrt(n) * (1 + 0.1 * (gain - 1));
const TIGHT = (n) => (n <= 7 ? 1.2 : n <= 10 ? 1.45 : 1.7);
const TIGHT_STEADY = 1.25;
const ALIVE_MIN = 0.08;
const STAY_MAX = 0.15;
// the casting table per pack size (fieldPacks.packCasting): families and glossies
const CAST_TABLE = { 14: { white: 6, accent: 4, black: 4, glossy: { white: 1, accent: 1, black: 1 } }, 7: { white: 3, accent: 2, black: 2, glossy: { white: 1, accent: 0, black: 1 } }, 10: { white: 4, accent: 3, black: 3, glossy: { white: 1, accent: 0, black: 1 } } };

async function sweep() {
  const { browser, page } = await open(1440, 900, "light");
  await settle(page);
  const rows = [];
  for (const v of [1.0, 1.4, 1.7, 2.0, 2.4, 3.0]) {
    await page.evaluate((x) => window.__field.setEnvIntensity(x), v);
    await sleep(1500);
    rows.push({ env: v, ...(await discLuminance(page, 1440, 900)) });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  fs.writeFileSync(`${OUT}/env-sweep.json`, JSON.stringify(rows, null, 1));
  await browser.close();
}

async function run(width, height, theme, opts = {}) {
  const variant = opts.variant ?? null;
  const label = `${width}x${height}-${theme}${variant ? `-${variant}` : ""}`;
  if (only && only !== label) return;
  // informational: the run is measured and recorded in full but does not gate the PASS line (the QUADS alternative)
  const out = (summary[label] = { label, variant, informational: !!opts.informational, asserts: {}, notes: [] });
  const t0 = Date.now();
  const { browser, page, errors, known } = await open(width, height, theme, 1, variant);
  const s0 = await page.evaluate(() => ({ fit: window.__field.fit, meshes: window.__field.meshes, near: window.__field.near, packs: window.__field.packs, packOf: window.__field.packOf, inBand: window.__field.inBand, casting: window.__field.casting, n: window.__field.bodies().length, camZ: window.__field.camZ, keepOuts: window.__field.keepOuts, envIntensity: window.__field.envIntensity, drifting: window.__field.drifting, driftAmp: window.__field.driftAmp, driftAmpZ: window.__field.driftAmpZ }));
  // the drift's reach from the scene's own amplitudes (the body's own term plus its pack's, 2·AMP each way): 2·(amp + ampZ) + slack — the most two snapshots of one body can differ
  const reach = 2 * (s0.driftAmp + s0.driftAmpZ) + 0.05;
  Object.assign(out, { fit: s0.fit, meshes: s0.meshes, near: s0.near, packs: s0.packs.map((p) => ({ ...p, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) })), inBand: s0.inBand, camZ: s0.camZ, envIntensity: s0.envIntensity, drift: { drifting: s0.drifting, amp: s0.driftAmp, ampZ: s0.driftAmpZ, reach: +reach.toFixed(3) } });
  // 21 in two packs (three behind the quads override) at ≥ 1280 × 800, one ten below; every slot is a body — nothing is culled
  const want = width >= 1280 && height >= 800 ? 21 : 10;
  out.asserts.meshCount = s0.meshes === want && s0.n === want && s0.packs.reduce((n, p) => n + p.n, 0) === want && s0.packOf.length === want;
  out.asserts.nearCap = s0.near === 0; // glass: no neighbour-occlusion loop
  // PACKS MIXED: no pack is one family, and each pack's cast follows the table (fieldPacks.packCasting)
  const cast = s0.packs.map((p, pi) => { const t = { n: p.n, white: 0, accent: 0, black: 0, glossy: { white: 0, accent: 0, black: 0 } }; s0.casting.forEach((c, j) => { if (s0.packOf[j] === pi) { t[c.family]++; if (c.finish === "glossy") t.glossy[c.family]++; } }); return t; });
  out.casting = cast;
  out.asserts.packsMixed = cast.every((c) => { const e = CAST_TABLE[c.n]; return !!e && c.white === e.white && c.accent === e.accent && c.black === e.black && ["white", "accent", "black"].every((f) => c.glossy[f] === e.glossy[f]) && c.white > 0 && c.accent > 0 && c.black > 0; });
  // THE POINTER BELONGS TO THE FLUID: the field's canvas and its R3F container must compute to
  // pointer-events none, elementFromPoint over empty hero space must be the fluid canvas, and a
  // sweep must reach the fluid (mousemove) and never the field — whose own ray (the window rig)
  // still moves at most a few jacks
  const pe = await page.evaluate(() => {
    const field = document.querySelector("div.fixed.inset-0.z-10.pointer-events-none canvas");
    const fluid = document.querySelector("canvas.fixed");
    const cs = (el) => (el ? getComputedStyle(el).pointerEvents : null);
    const pts = [[0.3, 0.45], [0.55, 0.3], [0.75, 0.85]];
    const efp = pts.map(([fx, fy]) => { const el = document.elementFromPoint(innerWidth * fx, innerHeight * fy); return el === fluid ? "fluid" : `${el?.tagName}.${String(el?.className || "").slice(0, 40)}`; });
    window.__mm = { fluid: 0, field: 0 };
    fluid?.addEventListener("mousemove", () => window.__mm.fluid++);
    field?.addEventListener("mousemove", () => window.__mm.field++);
    return { fieldCanvas: cs(field), fieldContainer: cs(field?.parentElement), fieldRoot: cs(field?.parentElement?.parentElement), fluidCanvas: cs(fluid), elementFromPoint: efp };
  });
  out.pointerEvents = pe;
  out.asserts.fieldCanvasInert = pe.fieldCanvas === "none" && pe.fieldContainer === "none" && pe.fieldRoot === "none";
  out.asserts.fluidTakesThePointer = pe.elementFromPoint.every((e) => e === "fluid");
  await page.mouse.move(width * 0.1, height * 0.5);
  for (let i = 1; i <= 20; i++) { await page.mouse.move(width * 0.1 + (width * 0.8 * i) / 20, height * 0.5 + Math.sin(i / 3) * 30); await sleep(30); }
  await sleep(300);
  const sweep = await page.evaluate(() => ({ ...window.__mm }));
  out.sweep = { fluidMousemoves: sweep.fluid, fieldMousemoves: sweep.field };
  out.asserts.sweepReachesFluid = sweep.fluid >= 10 && sweep.field === 0;
  await page.mouse.move(width - 3, height - 3);
  out.h1Font = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("[data-hero-h1] span")).fontSize));
  // the size rule from the scene's own constants (FIELD.D_PER_FONT, FIELD.UNIT_DIAM), the clamp escape kept and fit.z logged so a bound clamp is visible
  const rule = await page.evaluate(() => ({ dPerFont: window.__field.dPerFont, unitDiam: window.__field.unitDiam }));
  out.sizeRule = { dPerFont: rule.dPerFont, unitDiam: rule.unitDiam, unitJackPx: +(s0.fit.pxPerUnit * rule.unitDiam).toFixed(1), wantPx: +(rule.dPerFont * out.h1Font).toFixed(1), fitZ: +s0.fit.z.toFixed(2), clamped: s0.fit.z === 40 || s0.fit.z === 24 };
  out.asserts.sizeRule = Math.abs(s0.fit.pxPerUnit * rule.unitDiam - rule.dPerFont * out.h1Font) < 0.5 || out.sizeRule.clamped;
  out.rects = await page.evaluate(() => Object.fromEntries(["h1", "card"].map((k) => [k, document.querySelector(`[data-hero-${k}]`).getBoundingClientRect().toJSON()])));
  out.asserts.keepOutsOnLoad = s0.keepOuts.length === 2;
  await page.evaluate(() => { const j = window.__field; while (j.entranceT < 0.6) j.step(1 / 60); });
  await sleep(1200);
  if (opts.frames) await page.screenshot({ path: `${OUT}/field-${label}-entrance.png` });
  // the flick with the envelope alive: the body nearest the headline is handed CAP toward its centre
  await page.evaluate(() => { const j = window.__field; while (j.entranceT < 6) j.step(1 / 60); });
  const flick = await page.evaluate(() => {
    const j = window.__field; const k = j.keepOuts[0]; const bs = j.bodies();
    let ni = 0, nd = Infinity;
    bs.forEach((b, i) => { const d = Math.hypot(b.x - k.cx, b.y - k.cy); if (d < nd) { nd = d; ni = i; } });
    const b = bs[ni]; const dx = k.cx - b.x, dy = k.cy - b.y, L = Math.hypot(dx, dy) || 1;
    j.kick(ni, (20 * dx) / L, (20 * dy) / L, 0);
    let minClear = Infinity, tMin = 0;
    for (let i = 0; i < 120; i++) { j.step(1 / 60); const c = j.clearance; if (c < minClear) { minClear = c; tMin = (i + 1) / 60; } }
    return { body: ni, from: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2) }, minClearance: +minClear.toFixed(3), atS: +tMin.toFixed(2), E: j.E };
  });
  out.flick = flick;
  out.asserts.flickStopsInBand = flick.minClearance > -0.2;
  // FULL-RATE REFERENCE for this run: frames over 2 s with the envelope open (E 1 — the entrance beat holds it to
  // entranceT 10 and the flick left it at ≈ 8), right after the flick. The idle and scroll windows below are bounded
  // against it rather than a constant, so the bound is this machine's — swiftshader here, a GPU on the owner's Mac.
  const ref0 = await page.evaluate(() => ({ frames: window.__field.frames, E: window.__field.E, entranceT: window.__field.entranceT }));
  await sleep(2000);
  const ref1 = await page.evaluate(() => ({ frames: window.__field.frames, E: window.__field.E, entranceT: window.__field.entranceT, idleHz: window.__field.idleHz }));
  const fullRate2s = ref1.frames - ref0.frames;
  // the machine outruns the idle timer (a GPU on a 60 Hz rAF: 120 frames / 2 s vs the timer's 60) → the ratio branch runs
  const outruns = fullRate2s > 2 * ref1.idleHz;
  out.fullRate = { frames2s: fullRate2s, hz: +(fullRate2s / 2).toFixed(1), E: [ref0.E, ref1.E], entranceT: [+ref0.entranceT.toFixed(2), +ref1.entranceT.toFixed(2)], idleHz: ref1.idleHz, outrunsTimer: outruns };
  out.asserts.fullRateReference = ref0.E === 1 && ref1.E === 1 && fullRate2s >= 4;
  if (opts.frames) await page.screenshot({ path: `${OUT}/field-${label}-postflick.png` });
  await settle(page);
  const rest = await page.evaluate(() => { const j = window.__field; return { simTime: j.simTime, E: j.E, idle: j.idle, frozen: j.frozen, busy: j.busyFrames, idleHz: j.idleHz, drifting: j.drifting, frames: j.frames, clearance: j.clearance, spread: j.spread, spreadByPack: j.spreadByPack, meanSpeed: j.meanSpeed, packs: j.packs, packOf: j.packOf, bodies: j.bodies(), homes: j.homes, camZ: j.camZ, tier: j.tier, keepOuts: j.keepOuts }; });
  out.rest = { simTime: +rest.simTime.toFixed(2), E: rest.E, idle: rest.idle, frozen: rest.frozen, drifting: rest.drifting, clearance: +rest.clearance.toFixed(3), spread: +rest.spread.toFixed(3), meanSpeed: +rest.meanSpeed.toFixed(4), tier: rest.tier, keepOutStrengths: rest.keepOuts.map((k) => k.strength) };
  out.asserts.restClearsHeadline = rest.clearance >= 0;
  out.asserts.rampsWhole = rest.keepOuts.every((k, i) => Math.abs(k.strength - (i === 0 ? 1 : 0.5)) < 1e-9);
  // PACKS GATHER (settled, E 0, idle): see the bounds above; the packs' z span is logged — a jammed pack is a column toward the camera
  const gather = {
    spreadByPack: rest.spreadByPack.map((v) => +v.toFixed(3)),
    bounds: rest.packs.map((p) => +GATHER(p.n, p.swirlGain).toFixed(3)),
    farthest: rest.packs.map((p, pi) => +Math.max(...rest.bodies.filter((_, j) => rest.packOf[j] === pi).map((b) => Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z))).toFixed(3)),
    zSpan: rest.packs.map((_, pi) => { const zs = rest.bodies.filter((_, j) => rest.packOf[j] === pi).map((b) => b.z); return +(Math.max(...zs) - Math.min(...zs)).toFixed(2); }),
  };
  out.gather = gather;
  out.asserts.packsGather = gather.spreadByPack.every((v, pi) => v <= gather.bounds[pi]) && gather.farthest.every((f) => f < 4);
  // ONE LAYER PER PIXEL (the plain jack): two passes per jack (the depth pre-pass and the glass) on ONE program, the
  // groups ranked back to front — renderOrder a permutation of 0..n−1 that follows pos.z ascending (ties by body
  // index, the scene's own rule), read in the same evaluate as the positions
  const layers = await page.evaluate(() => { const j = window.__field; return { meshes: j.meshes, passes: j.passes, renderOrders: j.renderOrders, z: j.bodies().map((b) => b.z), programs: j.programs, glassPrograms: j.glassPrograms }; });
  const byDepth = layers.z.map((_, i) => i).sort((a, b) => layers.z[a] - layers.z[b] || a - b);
  out.layers = { jacks: layers.meshes, passes: layers.passes, programs: layers.programs, glassPrograms: layers.glassPrograms, renderOrders: layers.renderOrders };
  out.asserts.passesTwoPerJack = layers.passes === 2 * layers.z.length && layers.meshes === layers.z.length;
  out.asserts.renderOrderBackToFront = [...layers.renderOrders].sort((a, b) => a - b).every((v, i) => v === i) && byDepth.every((body, rank) => layers.renderOrders[body] === rank);
  out.asserts.programsUnchanged = layers.glassPrograms === 1 && layers.programs === PROGRAMS;
  // IDLE CADENCE (see WAKE DETECTION): with idle and E 0, an idle 2 s window holds at least one frame (the timer
  // ticked at all), no more than 2·idleHz + 6 (the timer's ceiling), and NO busy frame; when the machine outruns the
  // timer it also holds ≤ 0.8 of the full-rate reference's frames (ratioChecked). And the drift itself: the homes
  // stand still while the bodies sway — the sway is measured against the SIM time the window covered, not the wall's
  // 2 s (clampDelta caps a frame at 1/30 s, so 6 frames in 2 s of wall is 0.2 s of sim): the largest body move must
  // exceed 0.006 · simΔ — ≥ 2.8× under the measured floor at any frame rate (node, idle, six phases: 0.0050–0.0074 u
  // over 6 × 1/30 s, 0.0031–0.0050 over 4, 0.035–0.063 over a full 2 s of sim; the floor per sim second is ≥ 0.017 u/s)
  // and 0.012 over a full 2 s of sim, the old "> 0.01 in 2 s" in spirit — and none by more than the reach. Without the
  // drift (AMP = AMP_Z = 0) the old rules apply and are verified here too: frozen, zero frames, nothing moves.
  const f1 = rest.frames; await sleep(2000);
  const f2 = await page.evaluate(() => { const j = window.__field; return { simTime: j.simTime, frames: j.frames, idle: j.idle, frozen: j.frozen, busy: j.busyFrames, E: j.E, bodies: j.bodies(), homes: j.homes }; });
  out.framesOver2s = f2.frames - f1;
  const simDelta = f2.simTime - rest.simTime;
  const drifted = f2.bodies.map((b, i) => Math.hypot(b.x - rest.bodies[i].x, b.y - rest.bodies[i].y, b.z - rest.bodies[i].z));
  out.idleCadence = { drifting: rest.drifting, idle: rest.idle && f2.idle, frozen: rest.frozen && f2.frozen, E: f2.E, idleHz: rest.idleHz, framesOver2s: out.framesOver2s, ceiling: 2 * rest.idleHz + 6, busyFrames: f2.busy - rest.busy, measuredHz: +(out.framesOver2s / 2).toFixed(1), fullRate2s, ratioToFull: +(out.framesOver2s / Math.max(1, fullRate2s)).toFixed(2), ratioChecked: outruns };
  out.drift = { ...out.drift, homesStill: JSON.stringify(f2.homes) === JSON.stringify(rest.homes), simDelta2s: +simDelta.toFixed(3), floor: +(0.006 * simDelta).toFixed(4), bodiesMoved: drifted.filter((d) => d > 0.01).length, maxBodyDelta2s: +Math.max(...drifted).toFixed(4), meanBodyDelta2s: +(drifted.reduce((a, b) => a + b, 0) / drifted.length).toFixed(4) };
  if (rest.drifting) {
    out.asserts.idleCadence = rest.idle && f2.idle && f2.E === 0 && out.framesOver2s >= 1 && out.framesOver2s <= 2 * rest.idleHz + 6 && out.idleCadence.busyFrames === 0 && (!outruns || out.framesOver2s <= 0.8 * fullRate2s);
    out.asserts.driftSways = out.drift.homesStill && simDelta > 0 && Math.max(...drifted) > 0.006 * simDelta && Math.max(...drifted) < reach;
  } else {
    out.asserts.idleCadence = rest.frozen && f2.frozen && f2.E === 0 && out.framesOver2s === 0;
    out.asserts.driftSways = out.drift.homesStill && out.drift.maxBodyDelta2s < 1e-3;
  }
  // PACKS ALIVE — the "feels like the card" number. From idle, ONE pointer move (then parked: the parked-aware `over` holds E 1
  // for PARKED_S of sim time, and step() never advances E), then 2 s of sim at E 1: mean |vel| over the bodies ≥ ALIVE_MIN. The
  // window holds the wake's release transient (the jam lets go when the settle friction lifts) and the drift — the shipped
  // behaviour, what a visitor's first move gets; node predicted 0.084 from the dynamics alone and 0.12 with the drift for the WIDE
  // layout (measured 0.13–0.16). PACKS TIGHT — THE PIVOT'S GUARD (the packs review, 2026-09-17): mean |pos − target| per pack
  // ≤ TIGHT(n) over the wake window AND ≤ TIGHT_STEADY · TIGHT(n) over the steady window (E has been 1 for ≥ 2 s). The origin
  // swirl does not drag a pinned, pulled pack, it WIDENS it — exactly the brief's 1.34: with the pivots deleted (gains kept) the
  // h1-side seven reads 1.78–1.90 at wake and 2.37–2.47 steady, its farthest member 5.5 u out (shipped 0.75–0.99 / 0.83–0.99 /
  // ≤ 2.5); the fourteen's centroid sits where the origin swirl is a fifth strength and is unaffected either way. PACKS STAY is a
  // WANDER sanity bound, not the pivot's guard: the drift-aware net move on the steady window (the earlier ruling) read over 0.1
  // in 7 of 8 node phases on the fourteen — the residual is the jam tracking its drifting targets (a jam absorbs ≈ 70% of the
  // sway and follows the common-mode term with lag, node 0.11–0.28), not the swirl — and no form of Stay tells the swirls apart
  // (the origin swirl's drift-paused move is 0.008–0.096 too). So: the drift PAUSED (`setDrift(false)`, targets = the homes), 2 s
  // to take up the paused targets (`pause`), then 2 s with the swirl the only thing moving the packs (`swirlOnly.packMove` —
  // node 0.039–0.093 fourteen / 0.019–0.063 seven, browser 0.037–0.090; a 4 s pause once read 0.108: a pack's mean has a chaotic
  // floor of ≈ 0.04–0.1 u per 2 s at E 1 with no drift at all) ≤ STAY_MAX, flat — scaling by the gain bought nothing. The wake and
  // steady windows' raw and drift-aware net moves (`__field.packDrift`, each pack's common-mode offset) are logged, not asserted.
  await page.mouse.move(width - 40, height - 40);
  await page.waitForFunction(() => window.__field.E === 1, null, { timeout: 15000, polling: 50 });
  const alive = await page.evaluate(() => {
    const j = window.__field;
    const means = () => { const bs = j.bodies(), pd = j.packDrift; return j.packs.map((_, pi) => { let x = 0, y = 0, z = 0, n = 0; bs.forEach((b, k) => { if (j.packOf[k] === pi) { x += b.x; y += b.y; z += b.z; n++; } }); return { x: x / n, y: y / n, z: z / n, nx: x / n - pd[pi].x, ny: y / n - pd[pi].y, nz: z / n - pd[pi].z }; }); };
    const twoSeconds = () => {
      const m0 = means(); let sp = 0, n = 0; const spreads = [];
      for (let k = 0; k < 120; k++) { j.step(1 / 60); sp += j.meanSpeed; n++; spreads.push(j.spreadByPack); }
      const m1 = means();
      return { meanSpeed: sp / n, packMove: m0.map((a, i) => Math.hypot(m1[i].x - a.x, m1[i].y - a.y, m1[i].z - a.z)), packMoveNet: m0.map((a, i) => Math.hypot(m1[i].nx - a.nx, m1[i].ny - a.ny, m1[i].nz - a.nz)), tightMean: j.packs.map((_, pi) => spreads.reduce((s, r) => s + r[pi], 0) / spreads.length), tightMax: j.packs.map((_, pi) => Math.max(...spreads.map((r) => r[pi]))) };
    };
    const E0 = j.E;
    const wake = twoSeconds();
    const steady = twoSeconds();
    j.setDrift(false);
    const pause = twoSeconds();
    const swirlOnly = twoSeconds();
    j.setDrift(true);
    return { E: [E0, j.E], n: j.packs.map((p) => p.n), gain: j.packs.map((p) => p.swirlGain), wake, steady, pause, swirlOnly };
  });
  const r4 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => +x.toFixed(3)) : +v.toFixed(4)]));
  out.alive = { E: alive.E, n: alive.n, gain: alive.gain, wake: r4(alive.wake), steady: r4(alive.steady), pause: r4(alive.pause), swirlOnly: r4(alive.swirlOnly), bounds: { alive: ALIVE_MIN, tight: alive.n.map(TIGHT), tightSteady: alive.n.map((n) => +(TIGHT_STEADY * TIGHT(n)).toFixed(3)), stay: STAY_MAX } };
  out.asserts.packsAlive = alive.E[0] === 1 && alive.E[1] === 1 && alive.wake.meanSpeed >= ALIVE_MIN;
  // packsTight IS the pivot guard: the origin swirl reads 1.8–1.9 on the seven at wake and 2.4 steady vs shipped ≤ 0.99
  out.asserts.packsTight = alive.wake.tightMean.every((v, pi) => v <= TIGHT(alive.n[pi])) && alive.steady.tightMean.every((v, pi) => v <= TIGHT_STEADY * TIGHT(alive.n[pi]));
  out.asserts.packsStay = alive.swirlOnly.packMove.every((m) => m <= STAY_MAX);
  await page.mouse.move(width - 3, height - 3);
  await page.evaluate(() => { const j = window.__field; for (let i = 0; i < 60 * 9; i++) j.step(1 / 60); });
  await waitRest(page, 120000).catch(() => out.notes.push("did not come to rest after the alive windows"));
  // the field's own ray, from rest: a sweep THROUGH THE LOWER PACK — y at its solved centroid projected to px (controller's
  // ruling; `__field.packs`, the lowest one) — kicks at least one jack, and only in the packs it crosses: the kicked set's packOf
  // covers ≤ 2 packs. The ray acts only on frames that run, and software GL runs ≈ 5 f/s here: the first 20 × 30 ms pass sampled
  // the ray three times across the pack and missed (0 kicked), so the sweep is 20 steps of 60 ms there and back, and the bodies
  // are read after EVERY step. Kicked = a speed above 1 u/s at any sample (a hit body takes the pointer's drag — 7.2·h·v_pointer,
  // several u/s at this sweep speed — plus the shove; drift-following bodies stay ≤ 0.5 u/s, the wake's release under 2 u/s on
  // the one frame it lets go). The displacement over the sweep is logged too (> 0.3 u count) but not asserted: at E 1 the drift
  // alone moves a home up to ≈ 0.3 u over the sweep's ≈ 4 s, and a drift-moved body in a third pack would read as "kicked".
  const lower = await page.evaluate(() => { const j = window.__field; const ps = j.packs; let li = 0; ps.forEach((p, i) => { if (p.y < ps[li].y) li = i; }); const ppu = innerHeight / 2 / ((j.camZ - ps[li].z) * Math.tan((12.5 * Math.PI) / 180)); return { index: li, n: ps[li].n, sx: innerWidth / 2 + ps[li].x * ppu, sy: innerHeight / 2 - ps[li].y * ppu }; });
  const sweepY = Math.min(height - 40, Math.max(40, lower.sy));
  const sweepStart = await page.evaluate(() => window.__field.bodies().map((b) => [b.x, b.y, b.z]));
  const maxV = new Array(sweepStart.length).fill(0);
  const sample = async () => { const vs = await page.evaluate(() => window.__field.bodies().map((b) => b.v)); vs.forEach((v, i) => { maxV[i] = Math.max(maxV[i], v); }); };
  await page.mouse.move(width * 0.1, sweepY);
  for (let i = 1; i <= 20; i++) { await page.mouse.move(width * 0.1 + (width * 0.8 * i) / 20, sweepY + Math.sin(i / 3) * 20); await sleep(60); await sample(); }
  for (let i = 19; i >= 0; i--) { await page.mouse.move(width * 0.1 + (width * 0.8 * i) / 20, sweepY - Math.sin(i / 3) * 20); await sleep(60); await sample(); }
  const after = await page.evaluate(() => ({ pos: window.__field.bodies().map((b) => [b.x, b.y, b.z]), packOf: window.__field.packOf }));
  const sweptU = after.pos.map((p, i) => Math.hypot(p[0] - sweepStart[i][0], p[1] - sweepStart[i][1], p[2] - sweepStart[i][2]));
  const kickedBodies = sweepStart.map((_, i) => i).filter((i) => maxV[i] > 1);
  const kickedPacks = [...new Set(kickedBodies.map((i) => after.packOf[i]))].sort();
  out.sweep.lowerPack = { index: lower.index, n: lower.n, centroidPx: [+lower.sx.toFixed(0), +lower.sy.toFixed(0)], sweepY: +sweepY.toFixed(0) };
  out.sweep.jacksKicked = kickedBodies.length;
  out.sweep.packsKicked = kickedPacks;
  out.sweep.maxSpeedDuring = +Math.max(...maxV).toFixed(2);
  out.sweep.movedOver0_3 = sweptU.filter((m) => m > 0.3).length;
  out.sweep.maxMovedU = +Math.max(...sweptU).toFixed(3);
  out.asserts.sweepMovesAtMostPack = kickedBodies.length >= 1 && kickedPacks.length <= 2;
  await page.mouse.move(width - 3, height - 3);
  await page.evaluate(() => { const j = window.__field; for (let i = 0; i < 60 * 9; i++) j.step(1 / 60); });
  await waitRest(page, 120000).catch(() => out.notes.push("did not come to rest after the sweep"));
  const h1 = out.rects.h1;
  const discs = rest.bodies.map((b, i) => {
    const ppu = height / 2 / ((rest.camZ - b.z) * TAN);
    const sx = width / 2 + b.x * ppu, sy = height / 2 - b.y * ppu, rad = b.r * ppu;
    const dx = Math.max(h1.left - sx, 0, sx - h1.right), dy = Math.max(h1.top - sy, 0, sy - h1.bottom);
    return { i, sx: +sx.toFixed(0), sy: +sy.toFixed(0), rad: +rad.toFixed(0), z: +b.z.toFixed(2), gapToH1: +(Math.hypot(dx, dy) - rad).toFixed(0), overlapsH1: Math.hypot(dx, dy) < rad };
  });
  out.discs = discs;
  out.asserts.noDiscOverH1 = discs.every((d) => !d.overlapsH1);
  // ALL ON VIEWPORT: every pack's solved centroid inside the viewport, and ≥ 75% of each pack's discs FULLY inside; the overflow
  // of the rest is logged in u (node: none at 1440 × 900 for WIDE — the upper pack's top touches the edge; two discs at 1440 × 700)
  const ppu0 = height / 2 / (rest.camZ * TAN);
  const packsOnView = rest.packs.map((p, pi) => {
    const sx = width / 2 + p.x * ppu0, sy = height / 2 - p.y * ppu0;
    const mine = discs.filter((d) => rest.packOf[d.i] === pi);
    const overflow = mine.map((d) => Math.max(0, d.rad - d.sx, d.rad - d.sy, d.sx + d.rad - width, d.sy + d.rad - height));
    const inside = overflow.filter((o) => o <= 0).length;
    return { pack: pi, n: p.n, centroidPx: [+sx.toFixed(0), +sy.toFixed(0)], centroidInside: sx >= 0 && sx <= width && sy >= 0 && sy <= height, discsFullyInside: inside, fraction: +(inside / mine.length).toFixed(2), overflowU: overflow.filter((o) => o > 0).map((o) => +(o / ppu0).toFixed(2)) };
  });
  out.packsOnView = packsOnView;
  out.asserts.allOnViewport = packsOnView.every((p) => p.centroidInside && p.fraction >= 0.75);
  if (theme === "light") {
    // the whites (Lusion's light-mode greys) carry the page's tonal family; the blacks are black by design,
    // so the overall median is reported, not asserted (see ENV_LIGHT in JackFieldScene.tsx)
    out.lightLuminance = await discLuminance(page, width, height);
    out.asserts.lightWhitesInFamily = out.lightLuminance.perFamily.white.median >= 0.13 && out.lightLuminance.p90 >= 0.5;
  }
  await page.screenshot({ path: `${OUT}/field-${label}-top.png` });
  const clip = { x: Math.max(0, h1.left - 120), y: Math.max(0, h1.top - 160), width: 0, height: 0 };
  clip.width = Math.min(width - clip.x, h1.right - h1.left + 240); clip.height = Math.min(height - clip.y, h1.bottom - h1.top + 320);
  await page.screenshot({ path: `${OUT}/field-${label}-headline.png`, clip });
  // an OVERLAP PAIR, for the eye: two jacks whose bodies touch or nearly (glass should blend, not cut)
  const pair = (() => {
    let best = null;
    for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      const a = rest.bodies[i], b = rest.bodies[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - (a.r + b.r);
      if (best === null || d < best.d) best = { i, j, d };
    }
    return best;
  })();
  if (pair) {
    const a = discs[pair.i], b = discs[pair.j];
    const cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2, rad = Math.max(a.rad, b.rad) * 2.6;
    const c = { x: Math.max(0, cx - rad), y: Math.max(0, cy - rad), width: 0, height: 0 };
    c.width = Math.min(width - c.x, 2 * rad); c.height = Math.min(height - c.y, 2 * rad);
    await page.screenshot({ path: `${OUT}/field-${label}-overlap.png`, clip: c });
    out.overlapPair = { bodies: [pair.i, pair.j], gapU: +pair.d.toFixed(3) };
  }
  // GLASS: the page shows THROUGH a jack. Sample the centre of the jack nearest the viewport's
  // middle (its core is solid glass), splat dye toward it from outside the ray's reach (the
  // fluid gets the mousemove; the field's ray only touches bodies within r + 0.025 u), then
  // sample again with the jack confirmed still under the patch. Opaque plastic: no change.
  const mid = discs.reduce((m, d) => (Math.hypot(d.sx - width / 2, d.sy - height / 2) < Math.hypot(m.sx - width / 2, m.sy - height / 2) ? d : m), discs[0]);
  // the junction: five patches within 0.3 r of the centre (one layer of glass now — the pre-pass culls the core)
  const corePts = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].map(([fx, fy]) => [mid.sx + fx * mid.rad, mid.sy + fy * mid.rad]);
  const sampleCore = async () => { const out = []; for (const [x, y] of corePts) out.push(await samplePatch(page, x, y)); return out; };
  // (1) deterministic: a red slab slid under the field (over the fluid) — glass takes its colour, plastic would not
  const glassPlain = await sampleCore();
  await page.evaluate(() => { const host = document.querySelector("div.fixed.inset-0.z-10.pointer-events-none"); const slab = document.createElement("div"); slab.id = "__slab"; slab.style.cssText = "position:fixed;inset:0;z-index:10;background:#ff2020;pointer-events:none"; host.parentElement.insertBefore(slab, host); });
  await sleep(400);
  const glassSlab = await sampleCore();
  await page.evaluate(() => document.getElementById("__slab")?.remove());
  const slabDelta = Math.max(...glassPlain.map((p, i) => Math.abs(p[0] - glassSlab[i][0])));
  out.glassUnderlay = { redDeltaMax: +slabDelta.toFixed(1), plain: glassPlain[0].map((v) => +v.toFixed(0)), slab: glassSlab[0].map((v) => +v.toFixed(0)) };
  // reported, not gating: under swiftshader a freshly inserted fixed layer did not repaint within the
  // wait in any config (delta 0–8 with the slab in the DOM), so this probe cannot see what it tests here
  out.glassUnderlay.pass = slabDelta > 30;
  // (2) the fluid's dye: three strokes toward the jack from outside the ray's reach (r + 0.025 u),
  // then the core sampled again with the jack confirmed still under it
  const glassBefore = await sampleCore();
  let glassAfter = glassBefore, moved = 0, tries = 0;
  for (const dir of [mid.sx < width / 2 ? 1 : -1, mid.sx < width / 2 ? -1 : 1]) {
    tries++;
    for (let k = 0; k < 3; k++) {
      const from = mid.sx - dir * mid.rad * (3.2 - k * 0.3), to = mid.sx - dir * mid.rad * 1.3;
      await page.mouse.move(from, mid.sy + mid.rad * (0.25 - k * 0.25));
      for (let i = 1; i <= 10; i++) { await page.mouse.move(from + ((to - from) * i) / 10, mid.sy + mid.rad * (0.25 - k * 0.25) * (1 - i / 10)); await sleep(12); }
    }
    await sleep(450);
    glassAfter = await sampleCore();
    const stillThere = await page.evaluate((i) => { const b = window.__field.bodies()[i]; return { x: b.x, y: b.y, z: b.z, camZ: window.__field.camZ }; }, mid.i);
    const ppu2 = height / 2 / ((stillThere.camZ - stillThere.z) * TAN);
    moved = Math.hypot(width / 2 + stillThere.x * ppu2 - mid.sx, height / 2 - stillThere.y * ppu2 - mid.sy);
    if (Math.max(...glassBefore.map((p, i) => Math.max(...p.map((v, c) => Math.abs(v - glassAfter[i][c]))))) > 8) break;
  }
  const dyeDelta = Math.max(...glassBefore.map((p, i) => Math.max(...p.map((v, c) => Math.abs(v - glassAfter[i][c])))));
  out.glass = { body: mid.i, at: [mid.sx, mid.sy], tries, maxChannelDelta: +dyeDelta.toFixed(1), jackMovedPx: +moved.toFixed(1) };
  // reported, not gating: the fluid runs on software GL here and its dye dissipates (2.2/s) before a
  // stroke's plume reaches the core at 1440 × 900 (delta 1–2), while at 1024 × 768 it does (delta 40)
  out.glass.pass = dyeDelta > 8 && moved < mid.rad * 0.35;
  await page.mouse.move(width - 3, height - 3);
  await page.evaluate(() => { const j = window.__field; for (let i = 0; i < 60 * 9; i++) j.step(1 / 60); });
  await waitRest(page, 120000).catch(() => out.notes.push("did not come to rest after the glass check"));
  await sleep(2500);
  // PARTIAL SCROLL: the headline lands on resting jacks → on scroll-end the band eases them out at full rate.
  // Decided by STATE, not frame counts (the idle cadence ticks regardless): under a band → poll until the
  // clearance is back to ≥ −0.05 with the band whole; nothing under a band → E stays 0 across the scroll-end
  // (the no-wake path asserted on the envelope) and the band strengths are whole
  const fBefore = await page.evaluate(() => ({ frames: window.__field.frames, E: window.__field.E }));
  await page.evaluate(() => window.scrollTo(0, 250));
  // the scroll-end measure (120 ms debounce) has run once the hook reports the new scrollY
  await page.waitForFunction(() => window.__field.scrollY === 250, null, { timeout: 10000, polling: 50 });
  const atOnce = await page.evaluate(() => ({ clearance: window.__field.clearance, keepOuts: window.__field.keepOuts.length, frames: window.__field.frames, E: window.__field.E }));
  let easedOk = true;
  if (atOnce.clearance < 0) easedOk = await page.waitForFunction(() => window.__field.clearance >= -0.05 && window.__field.keepOutsSettled, null, { timeout: 60000, polling: 250 }).then(() => true).catch(() => { out.notes.push("the band did not clear the scrolled headline within 60 s"); return false; });
  await waitRest(page, 60000, true).catch(() => out.notes.push("did not come to rest after the partial scroll"));
  await sleep(300);
  const eased = await page.evaluate(() => ({ clearance: window.__field.clearance, frames: window.__field.frames, idle: window.__field.idle, E: window.__field.E, strengths: window.__field.keepOuts.map((k) => k.strength) }));
  const bandWhole = eased.strengths.every((s, i) => Math.abs(s - (i === 0 ? 1 : 0.5)) < 1e-9);
  out.partialScroll = { scrollY: 250, underAtOnce: atOnce.clearance < 0, clearanceAtOnce: +atOnce.clearance.toFixed(3), framesToEase: eased.frames - fBefore.frames, finalClearance: +eased.clearance.toFixed(3), strengths: eased.strengths, E: [fBefore.E, atOnce.E, eased.E], idle: eased.idle };
  out.asserts.partialScrollEases = atOnce.clearance < 0 ? easedOk && eased.clearance >= -0.05 && bandWhole : fBefore.E === 0 && atOnce.E === 0 && eased.E === 0 && bandWhole;
  if (opts.frames) await page.screenshot({ path: `${OUT}/field-${label}-scrolled250.png` });
  // back to the top: the jacks return to their homes on the next pointer move
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  await page.mouse.move(width - 40, height - 40); await sleep(200); await page.mouse.move(width - 60, height - 50);
  await page.evaluate(() => { const j = window.__field; for (let i = 0; i < 60 * 9; i++) j.step(1 / 60); });
  await waitRest(page, 120000).catch(() => out.notes.push("did not come to rest after returning to the top"));
  const home = await page.evaluate(() => ({ clearance: window.__field.clearance, spread: window.__field.spread, spreadByPack: window.__field.spreadByPack, n: window.__field.packs.map((p) => p.n), gain: window.__field.packs.map((p) => p.swirlGain) }));
  out.backHome = { clearance: +home.clearance.toFixed(3), spread: +home.spread.toFixed(3), spreadByPack: home.spreadByPack.map((v) => +v.toFixed(3)), bounds: home.n.map((n, pi) => +GATHER(n, home.gain[pi]).toFixed(3)) };
  // back home = gathered again (the packs' gain-aware bound; the lattice's "spread < 0.5" was a rest ON the homes, a pack rests under
  // compression, and the gained seven re-jammed at 1.28 once after this excursion) and clear of the name
  out.asserts.backHomeClear = home.clearance >= 0 && home.spreadByPack.every((v, pi) => v <= GATHER(home.n[pi], home.gain[pi]));
  // CLICK: Lusion's burst from a click on empty hero space (the fluid canvas takes the click; the field's window listener hears
  // it), then 6 s after the click every pack has REGATHERED — spread ≤ max(its gain-aware gather bound GATHER(n, gain), 1.15 × its
  // own pre-click steady spread) (controller's ruling: the gained seven re-jamming at 1.21 against a 1.19 absolute bound is a
  // regather, not a failure; the packs review: at a tight pre-click phase 1.15× is BELOW the flat bound and the seven re-jammed at
  // 1.226 — 1 of 4 node phases — so the gain-scaled 1.43 covers it with ≥ 0.15 u to spare; both numbers recorded) — and no body
  // is nearer another pack's centroid than its own. The 6 s run under the PAGE'S OWN ENVELOPE: the click is a pointer move, so E
  // holds 1 for PARKED_S of sim time and closes over DECAY_S — the harness lets the real frame loop do that (E read from the
  // hook; ≈ 5 s of sim, ≈ 30 s of wall under software GL) and steps the remainder, because step() cannot advance E and a window
  // frozen at E 1 leaves the gained seven loose (1.21–1.29 at 6 s, measured — the settle friction that jams a pack is the E → 0
  // part). The envelope is waited OPEN then CLOSED: a wait for E 0 alone could resolve before E ever opened (the light run once
  // read "E was already 0 at the burst — no frame had run") and a frame then opened it before the 6 s evaluate. Node under this
  // envelope: 1.05 / 0.91 at 1440 × 900, 0.98 / 0.84 / 0.94 quads, 0.91 at 1024 × 768; none astray.
  const clickAt = [width * 0.75, height * 0.85];
  const preClick = await page.evaluate(() => window.__field.spreadByPack);
  const clickT0 = await page.evaluate(() => window.__field.simTime);
  await page.mouse.click(clickAt[0], clickAt[1]);
  await sleep(150);
  const burst = await page.evaluate(() => ({ v: Math.max(...window.__field.bodies().map((b) => b.v)), E: window.__field.E }));
  await page.waitForFunction(() => window.__field.E === 1, null, { timeout: 15000, polling: 50 }).catch(() => out.notes.push("E did not open after the click"));
  await page.waitForFunction(() => window.__field.E === 0, null, { timeout: 180000, polling: 250 }).catch(() => out.notes.push("E did not close within 180 s after the click"));
  const regather = await page.evaluate((t0) => { const j = window.__field; const eClosedAt = j.simTime - t0; while (j.simTime < t0 + 6) j.step(1 / 60); const ps = j.packs, bs = j.bodies(); let astray = 0; bs.forEach((b, k) => { const own = j.packOf[k]; const mine = Math.hypot(b.x - ps[own].x, b.y - ps[own].y); if (ps.some((p, pi) => pi !== own && Math.hypot(b.x - p.x, b.y - p.y) < mine)) astray++; }); return { spreadByPack: j.spreadByPack, n: ps.map((p) => p.n), gain: ps.map((p) => p.swirlGain), astray, atS: j.simTime - t0, eClosedAt, E: j.E }; }, clickT0);
  const clickBounds = regather.n.map((n, pi) => Math.max(GATHER(n, regather.gain[pi]), 1.15 * preClick[pi]));
  out.click = { at: clickAt.map((v) => +v.toFixed(0)), peakSpeed: +burst.v.toFixed(2), eAtBurst: burst.E, eClosedAtS: +regather.eClosedAt.toFixed(2), measuredAtS: +regather.atS.toFixed(2), E: regather.E, preClickSpread: preClick.map((v) => +v.toFixed(3)), spreadByPack: regather.spreadByPack.map((v) => +v.toFixed(3)), gatherBounds: regather.n.map((n, pi) => +GATHER(n, regather.gain[pi]).toFixed(3)), bounds: clickBounds.map((v) => +v.toFixed(3)), astray: regather.astray };
  out.asserts.clickRegathers = burst.v > 3 && regather.spreadByPack.every((v, pi) => v <= clickBounds[pi]) && regather.astray === 0;
  await page.mouse.move(width - 3, height - 3);
  await page.evaluate(() => { const j = window.__field; for (let i = 0; i < 60 * 9; i++) j.step(1 / 60); });
  await waitRest(page, 120000).catch(() => out.notes.push("did not come to rest after the click"));
  // FULL SCROLL: to Education's top + 40 — nothing under the headline. The homes stand, the layout does not
  // re-solve, the envelope stays 0 and the frames tick on at no more than the idle cadence (the drift moves the
  // bodies ≈ 0.1 u, so the body delta is bounded by the drift's reach, not by 1e-3). The target is a SECTION
  // anchor read from the DOM (the reading chapters changed the page's length: Experience pins at 180 svh) and
  // ROUNDED, because the wait below compares the hook's integer scrollY and a fractional target never matches (E15).
  const before = await page.evaluate(() => ({ bodies: window.__field.bodies().map((b) => [b.x, b.y, b.z]), homes: window.__field.homes, E: window.__field.E }));
  const farY = await page.evaluate(() => { const el = document.getElementById("education"); return Math.round(el.getBoundingClientRect().top + window.scrollY + 40); });
  // An instant scroll (a probe scrolls by scrollTo + re-measure, never a smooth scroll that might not land,
  // D-0074): the h1's box leaves in one step; the window starts at scroll-end — once the frame or the scroll-end
  // handler has measured the final scrollY — and asks whether anything ran at full rate AFTER that.
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), farY);
  await page.waitForFunction((y) => window.__field.scrollY === y, farY, { timeout: 10000, polling: 50 });
  const pre = await page.evaluate(() => ({ frames: window.__field.frames, layouts: window.__field.layouts, busy: window.__field.busyFrames }));
  await sleep(1500);
  const afterScroll = await page.evaluate(() => ({ frames: window.__field.frames, layouts: window.__field.layouts, busy: window.__field.busyFrames, scrollY: window.scrollY, bodies: window.__field.bodies().map((b) => [b.x, b.y, b.z]), homes: window.__field.homes, E: window.__field.E, idle: window.__field.idle, idleHz: window.__field.idleHz, keepOuts: window.__field.keepOuts.length }));
  // the 1.5 s window's frame bound (see WAKE DETECTION): relative to the full-rate reference when the machine
  // outruns the timer (0.8 × three quarters of it, + 2 for the scroll-end re-measure frame and rAF alignment),
  // otherwise the timer's constant ceiling 1.5·(2·idleHz + 6)
  const scrollBound = outruns ? 0.8 * 0.75 * fullRate2s + 2 : 1.5 * (2 * afterScroll.idleHz + 6);
  out.scroll = { scrollY: afterScroll.scrollY, framesFromScroll: afterScroll.frames - pre.frames, frameBound: +scrollBound.toFixed(1), ratioChecked: outruns, busyFrames: afterScroll.busy - pre.busy, layoutsDuring: afterScroll.layouts - pre.layouts, maxBodyDelta: +Math.max(...afterScroll.bodies.map((p, i) => Math.hypot(p[0] - before.bodies[i][0], p[1] - before.bodies[i][1], p[2] - before.bodies[i][2]))).toFixed(3), homesStill: JSON.stringify(afterScroll.homes) === JSON.stringify(before.homes), E: [before.E, afterScroll.E], idle: afterScroll.idle, keepOuts: afterScroll.keepOuts, fullRate1_5s: +(0.75 * fullRate2s).toFixed(1), ratioToFull: +((afterScroll.frames - pre.frames) / Math.max(1, 0.75 * fullRate2s)).toFixed(2) };
  out.asserts.scrollKeepsPositions = out.scroll.homesStill && out.scroll.layoutsDuring === 0 && before.E === 0 && afterScroll.E === 0 && out.scroll.maxBodyDelta < (rest.drifting ? reach : 1e-3);
  // nothing woke the loop: E stays 0, the frames after scroll-end stay under the bound, and none of them was
  // scheduled at full rate (busyFrames unchanged — a scroll-end that found a jack in a band would add them).
  // Not drifting: no frame at all.
  out.asserts.scrollDoesNotWake = before.E === 0 && afterScroll.E === 0 && (rest.drifting ? out.scroll.busyFrames === 0 && out.scroll.framesFromScroll <= scrollBound : out.scroll.framesFromScroll === 0);
  out.asserts.noKeepOutOffHero = afterScroll.keepOuts === 0;
  await page.evaluate(() => { const el = document.querySelector("#experience"); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80); });
  await sleep(600);
  if (opts.frames) await page.screenshot({ path: `${OUT}/field-${label}-midpage.png` });
  // RESIZE re-solves the layout (frames are no longer the evidence — the idle cadence ticks anyway): `layouts`
  // goes up and the fit follows the new width. One layout per resize from the size effect; the ResizeObserver on
  // the h1/card adds a second when the narrower viewport reflows them, so the count is reported and 1–2 accepted.
  await page.mouse.move(width - 3, height - 3);
  await page.evaluate(() => { const j = window.__field; for (let i = 0; i < 60 * 9; i++) j.step(1 / 60); });
  await waitRest(page, 180000).catch(() => out.notes.push("did not come to rest before the resize test"));
  const preResize = await page.evaluate(() => ({ frames: window.__field.frames, layouts: window.__field.layouts }));
  await page.setViewportSize({ width: width - 100, height });
  await sleep(2500);
  const afterResize = await page.evaluate(() => ({ frames: window.__field.frames, layouts: window.__field.layouts, fit: window.__field.fit }));
  out.resize = { framesFromResize: afterResize.frames - preResize.frames, layoutsFromResize: afterResize.layouts - preResize.layouts, fitWidth: afterResize.fit.width };
  out.asserts.resizeRelayouts = out.resize.layoutsFromResize >= 1 && out.resize.layoutsFromResize <= 2 && afterResize.fit.width === width - 100;
  await page.setViewportSize({ width, height });
  await sleep(1500);
  if (opts.card) {
    await page.evaluate(() => { const el = document.querySelector(".col-start-2.row-span-3"); const r = el.getBoundingClientRect(); window.scrollBy(0, r.top + r.height / 2 - innerHeight / 2); });
    await page.waitForFunction(() => window.__jacks && window.__jacks.entered, null, { timeout: 60000, polling: 200 });
    await page.evaluate(() => { for (let i = 0; i < 14 * 60; i++) window.__jacks.step(1 / 60); });
    await page.waitForFunction(() => window.__jacks.frozen, null, { timeout: 120000, polling: 250 });
    const card = await page.evaluate(() => { const j = window.__jacks; return { n: j.bodies().length, camZ: j.camZ, frozen: j.frozen, tier: j.tier, canvasPointerEvents: getComputedStyle(document.querySelector(".col-start-2.row-span-3 canvas")).pointerEvents, meshes: j.meshes, passes: j.passes, programs: j.programs, glassPrograms: j.glassPrograms, renderOrders: j.renderOrders, z: j.bodies().map((b) => +b.z.toFixed(3)) }; });
    out.card = card;
    // the card's canvas WANTS the pointer (its pointerenter/leave/click listeners; its column is pointer-events-auto on purpose)
    out.asserts.cardCanvasTakesPointer = card.canvasPointerEvents === "auto";
    out.asserts.cardUnchanged = card.n === 12 && card.frozen && Math.abs(card.camZ - 8.5) < 0.01;
    // THE CARD WEARS THE HERO'S GLASS (jackGlass.ts, one module for both scenes): two passes per jack — the depth pre-pass
    // and the glass — on ONE glass program (the pre-pass added none), the groups ranked back to front as the field's are.
    // `programs` is informational: the glass 1 + the PMREM bake's 2 + the wake ribbon's own, compiled lazily (paint, copy,
    // blur, reset, composite — 3 to 5 by this point), so the count is reported, not asserted.
    out.asserts.cardPasses = card.passes === 2 * card.n && card.meshes === card.n;
    out.asserts.cardGlassPrograms = card.glassPrograms === 1;
    const cardByDepth = card.z.map((_, i) => i).sort((a, b) => card.z[a] - card.z[b] || a - b);
    out.asserts.cardRenderOrderBackToFront = [...card.renderOrders].sort((a, b) => a - b).every((v, i) => v === i) && cardByDepth.every((body, rank) => card.renderOrders[body] === rank);
    await sleep(500);
    await page.screenshot({ path: `${OUT}/field-${label}-cardsection.png` });
  }
  out.errors = errors; out.knownErrors = known.length;
  out.asserts.noErrors = errors.length === 0;
  out.ctxLost = await page.evaluate(() => window.__ctxLost);
  out.asserts.noContextLoss = out.ctxLost === 0;
  out.elapsedS = +((Date.now() - t0) / 1000).toFixed(1);
  out.pass = Object.values(out.asserts).every(Boolean);
  console.log(JSON.stringify({ label, pass: out.pass, asserts: out.asserts, packs: out.packs, inBand: out.inBand, casting: out.casting, gather: out.gather, alive: out.alive, packsOnView: out.packsOnView, click: out.click, sizeRule: out.sizeRule, layers: out.layers, fullRate: out.fullRate, idleCadence: out.idleCadence, drift: out.drift, glass: out.glass, glassUnderlay: out.glassUnderlay, overlapPair: out.overlapPair, pointerEvents: out.pointerEvents, sweep: out.sweep, meshes: out.meshes, near: out.near, fit: out.fit, envIntensity: out.envIntensity, flick: out.flick, rest: out.rest, framesOver2s: out.framesOver2s, partialScroll: out.partialScroll, backHome: out.backHome, scroll: out.scroll, resize: out.resize, lightLuminance: out.lightLuminance, card: out.card, notes: out.notes, errors: out.errors, elapsedS: out.elapsedS }));
  await browser.close();
}

// The controller's frames at DPR 2, for both compositions (WIDE and, behind the override, QUADS) and both themes: the full frame;
// the LOWER pack — a 7 u square about its solved centroid, the card's fourteen under the name, three or four glass layers deep at
// the core (the "clustered" read and the clearer table are judged from this one); and the largest jack at rest, 3 × its diameter
// on a side — "no ball" — while z-fighting between the pre-pass and the glass is checked on the Mac's GPU, not here
async function zoom(theme, variant = null) {
  const width = 1440, height = 900, label = `${width}x${height}-${theme}${variant ? `-${variant}` : ""}`;
  const { browser, page } = await open(width, height, theme, 2, variant);
  await page.mouse.move(width - 3, height - 3);
  await settle(page);
  const st = await page.evaluate(() => ({ bodies: window.__field.bodies(), camZ: window.__field.camZ, unitDiam: window.__field.unitDiam, casting: window.__field.casting, packs: window.__field.packs, spreadByPack: window.__field.spreadByPack }));
  await page.screenshot({ path: `${OUT}/field-${label}-full@2x.png` });
  let li = 0;
  st.packs.forEach((p, i) => { if (p.y < st.packs[li].y) li = i; });
  const lp = st.packs[li];
  const ppu0 = height / 2 / (st.camZ * TAN);
  const lcx = width / 2 + lp.x * ppu0, lcy = height / 2 - lp.y * ppu0, lside = Math.min(7 * ppu0, width, height);
  const lclip = { x: Math.min(Math.max(0, lcx - lside / 2), width - lside), y: Math.min(Math.max(0, lcy - lside / 2), height - lside), width: lside, height: lside };
  await page.screenshot({ path: `${OUT}/field-${label}-lowerpack@2x.png`, clip: lclip });
  let big = 0;
  st.bodies.forEach((b, i) => { if (b.scale > st.bodies[big].scale) big = i; });
  const b = st.bodies[big];
  const ppu = height / 2 / ((st.camZ - b.z) * TAN);
  const sx = width / 2 + b.x * ppu, sy = height / 2 - b.y * ppu, D = st.unitDiam * b.scale * ppu;
  const side = Math.min(3 * D, width, height);
  const clip = { x: Math.min(Math.max(0, sx - side / 2), width - side), y: Math.min(Math.max(0, sy - side / 2), height - side), width: side, height: side };
  await page.screenshot({ path: `${OUT}/field-${label}-jack-zoom.png`, clip });
  summary[`zoom-${label}`] = {
    dpr: 2,
    full: `${OUT}/field-${label}-full@2x.png`,
    lowerPack: { index: li, n: lp.n, centroidPx: [+lcx.toFixed(0), +lcy.toFixed(0)], spread: +st.spreadByPack[li].toFixed(3), sideU: 7, clip: { x: +lclip.x.toFixed(0), y: +lclip.y.toFixed(0), side: +lside.toFixed(0) }, frame: `${OUT}/field-${label}-lowerpack@2x.png` },
    jack: { body: big, family: st.casting[big].family, finish: st.casting[big].finish, scale: +b.scale.toFixed(3), at: [+sx.toFixed(0), +sy.toFixed(0)], diameterPx: +D.toFixed(1), clip: { x: +clip.x.toFixed(0), y: +clip.y.toFixed(0), side: +side.toFixed(0) }, frame: `${OUT}/field-${label}-jack-zoom.png` },
  };
  console.log(JSON.stringify({ zoom: label, ...summary[`zoom-${label}`] }));
  await browser.close();
}

// THE CARD at DPR 2 (the owner's "exactly like the jacks on hero", judged by eye): the column's canvas clipped after the
// entrance — the dolly ends at 2 s of sim (ConnectorField ENTRANCE.T1), stepped to 3 s with the envelope open — then after a
// FLICK: a sweep across the column at ≥ 20 px per step, the wake ribbon's brush threshold (wakeField.ts: a brush from
// 20 px/frame up), read through `__wake.capture()` (the next composited frame's canvas before and after the ribbon's pass;
// `post` is saved as its own PNG) and clipped again from the page, so the ribbon is seen compositing OVER glass jacks and the
// opaque panel's colour showing through them (no black void). `unknown` > 0 opens with &jacksUnknown=N (ConnectorField's
// debug override) so the ghost glass — the unknown week's — can be seen on a payload that has no cut.
async function zoomCard(theme, unknown = 0) {
  const width = 1440, height = 900, label = `${width}x${height}-${theme}${unknown ? `-ghost${unknown}` : ""}`;
  const { browser, page, errors } = await open(width, height, theme, 2, null, unknown ? `&jacksUnknown=${unknown}` : "");
  await page.mouse.move(width - 3, height - 3);
  await page.evaluate(() => { const el = document.querySelector(".col-start-2.row-span-3"); const r = el.getBoundingClientRect(); window.scrollBy(0, r.top + r.height / 2 - innerHeight / 2); });
  await page.waitForFunction(() => window.__jacks && window.__jacks.entered, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => { const j = window.__jacks; while (j.entranceT < 3) j.step(1 / 60); });
  await sleep(1500);
  const rect = await page.evaluate(() => document.querySelector(".col-start-2.row-span-3 canvas").getBoundingClientRect().toJSON());
  const clip = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const state = () => page.evaluate(() => { const j = window.__jacks; const bs = j.bodies(); return { n: bs.length, ghosts: bs.filter((b) => !b.known).length, meshes: j.meshes, passes: j.passes, programs: j.programs, glassPrograms: j.glassPrograms, camZ: +j.camZ.toFixed(3), E: j.E, entranceT: +j.entranceT.toFixed(2), frozen: j.frozen }; });
  const entrance = await state();
  const entrancePath = `${OUT}/card-${label}-entrance@2x.png`;
  await page.screenshot({ path: entrancePath, clip });
  const rec = { dpr: 2, theme, unknown, clip: { x: +clip.x.toFixed(0), y: +clip.y.toFixed(0), width: +clip.width.toFixed(0), height: +clip.height.toFixed(0) }, entrance: { frame: entrancePath, ...entrance } };
  if (!unknown) {
    // the flick: left to right across the column at mid-height, 12 steps (≈ 55 px each at this width), a little sine in y
    const y = clip.y + clip.height * 0.5, x0 = clip.x + 8, x1 = clip.x + clip.width - 8, steps = 12;
    await page.mouse.move(x0, y);
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y + Math.sin(i / 2) * 12); await sleep(16); }
    const wake = await page.evaluate(() => { const w = window.__wake; if (!w) return null; return Promise.race([w.capture().then((c) => ({ alive: w.alive, weight: +w.weight.toFixed(3), frames: w.frames, speed: +w.speed.toFixed(1), radius: +w.radius.toFixed(2), simDt: +c.simDt.toFixed(4), post: c.post, plain: c.plain })), new Promise((r) => setTimeout(() => r({ alive: w.alive, weight: +w.weight.toFixed(3), frames: w.frames, timedOut: true }), 20000))]); });
    const flickPath = `${OUT}/card-${label}-flick@2x.png`;
    await page.screenshot({ path: flickPath, clip });
    const canvasPath = wake && wake.post ? `${OUT}/card-${label}-flick-canvas@2x.png` : null;
    if (canvasPath) fs.writeFileSync(canvasPath, Buffer.from(wake.post.split(",")[1], "base64"));
    rec.flick = { frame: flickPath, canvas: canvasPath, wake: wake ? { alive: wake.alive, weight: wake.weight, frames: wake.frames, speed: wake.speed, radius: wake.radius, simDt: wake.simDt, timedOut: !!wake.timedOut, ribbonInCapture: !!(wake.post && wake.plain && wake.post !== wake.plain) } : null, ...(await state()) };
  }
  rec.errors = errors;
  summary[`card-${label}`] = rec;
  console.log(JSON.stringify({ card: label, ...rec }));
  await browser.close();
}

if (only === "sweep") { await sweep(); process.exit(0); }
if (only === "zoom") { for (const v of [null, "quads"]) { await zoom("dark", v); await zoom("light", v); } process.exit(0); }
if (only === "card") { await zoomCard("dark"); await zoomCard("light"); await zoomCard("dark", 3); fs.writeFileSync(`${OUT}/verify-card.json`, JSON.stringify(summary, null, 1)); process.exit(0); }
summary.initialJs = initialJs();
console.log("initialJs", JSON.stringify(summary.initialJs));
await run(1440, 900, "dark", { frames: true, card: true });
await run(1440, 900, "light", { frames: true, card: true });
await run(1024, 768, "dark", { frames: true });
// QUADS is the owner's ALTERNATIVE composition, not the shipped one (controller's ruling): run for the frames, recorded in full as
// informational — its left pack's clip (two discs 0.11 / 0.01 u past the left edge, 5/7 fully inside) is known from the critique
await run(1440, 900, "dark", { frames: true, variant: "quads", informational: true });
if (!only) { for (const v of [null, "quads"]) { await zoom("dark", v); await zoom("light", v); } await zoomCard("dark"); await zoomCard("light"); await zoomCard("dark", 3); }
fs.writeFileSync(`${OUT}/verify.json`, JSON.stringify(summary, null, 1));
const runs = Object.values(summary).filter((s) => s.label);
const failed = (s) => Object.entries(s.asserts).filter(([, v]) => !v).map(([k]) => k).join(",") || "all green";
console.log("PASS:", [`initialJs=${summary.initialJs.pass}`, ...runs.filter((s) => !s.informational).map((s) => `${s.label}=${s.pass}`)].join(" "), ...runs.filter((s) => s.informational).map((s) => `| informational ${s.label}=${s.pass} (${failed(s)})`));
