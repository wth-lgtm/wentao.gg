#!/usr/bin/env node
// restAtTopPixels capture (DESIGN.md §9, Spike 0). Screenshots the home page's FIRST SCREEN at rest under the
// fixed capture conditions, and compares two captures by SSIM. Spike 0 took the f4b738f baselines with this
// same file; scripts/verify-motion.mjs imports { captureTop, ssimFiles, launchChrome } from it (it needs only
// playwright-core: PLAYWRIGHT_CORE, default /tmp/shots/node_modules/playwright-core/index.mjs).
//
// CAPTURE CONDITIONS (every one is applied here, in this order; any that cannot be applied is recorded in the
// sidecar JSON under `notes` rather than silently skipped):
//   1. fresh context per capture; viewport + DPR from the spec; colorScheme and localStorage.theme = the theme;
//      reducedMotion "no-preference". The live clocks (HeroMeta, Navigation) are frozen by an init script that
//      pins Date.prototype.toLocaleTimeString to 2026-09-24 17:00 America/Los_Angeles ("5:00 PM"); nothing else
//      about time is faked (performance.now, timers and rAF stay real).
//   2. `/?jacksDebug=1` (the field's debug hook; it changes nothing visible). The POINTER IS NEVER MOVED:
//      no mouse/touch call is made on the page at all.
//   3. the jack field (only where its gate passes: ≥ 640 px wide, hover+fine pointer, no reduced motion): wait for
//      `__field.entered && fit` polling every animation frame, then IN ONE SYNCHRONOUS EVALUATE call
//      `__field.setDrift(false)` (targets = the undrifted homes) and `__field.step(1/60)` until entranceT ≥ 14,
//      then wait for `__field.idle && keepOutsSettled`. Why: the field's rest arrangement is chaotic in real time;
//      two loads of the same build left to settle on their own measured SSIM 0.889–0.897 (Spike 0, Metal), while
//      stepping from the entrance with a fixed dt measured ≥ 0.997. The sidecar records the entranceT and frame
//      count at which stepping began (`field.stepFrom`): if they differ between two captures, the trajectories
//      differ and a low SSIM in the pack areas is expected, not a regression. This is verify-field's own settle()
//      convention (step past the entrance, then wait for rest).
//   4. the fluid idle: performance.now() ≥ 9500 ms (init ≤ rIC timeout 3000 + 500, idle pause + 3000, dye gone).
//   5. the SplitFlap board settled on ENGINEER, a NON-FIRST cycle (it arrives from POWERLIFTER every 16 s), held
//      250 ms; re-read after the shot and retried on the next cycle if the word moved.
//   6. the rain's fixed wrapper (the position:fixed z-0 parent of MatrixRain's canvas) set visibility:hidden
//      (the rain is Math.random()-driven, so it can never match between two runs).
//   7. page.screenshot({ animations: "disabled", caret: "hide", mask: [ [data-hero-card] ] }) of the viewport.
//      The visitor card shows the viewer's public IP/ISP: it is always masked (Playwright's default #FF00FF box).
//
// USAGE
//   node capture-top.mjs [flags]
//     --url=http://127.0.0.1:3301/          the served build (the path is kept; ?jacksDebug=1 is added)
//     --out=/tmp/wentao-gg-research/baseline output dir for <label>-<theme>-<spec>.png + .json
//     --label=top                           file-name prefix
//     --themes=dark,light
//     --viewports=1440x900,1512x982,390x844m
//          spec grammar: WxH (DPR 1 desktop) | WxH@2 (DPR 2 desktop) | WxHm (phone emulation: DPR 2, isMobile,
//          hasTouch, iPhone Safari UA; the same emulation visual-audit.md used for m390)
//     --angle=metal|swiftshader             system Chrome with --use-angle=metal (real GPU) or SwiftShader
//     --compare=DIR                         after capturing, SSIM each capture against DIR/<same file name>
//     --threshold=0.99                      --compare exits 1 if any SSIM is below it
//     --no-step                             let the field settle in real time instead of stepping it (not reproducible)
//   node capture-top.mjs --ssim a.png b.png [--mask-json=a.json]   SSIM of two existing captures
//
// SSIM: luma (Rec. 709) SSIM over 8×8 windows at stride 4 (K1 0.01, K2 0.03, L 255), skipping every window that
// touches a mask rectangle (read from the sidecar JSON, CSS px × DPR), so the pink mask never inflates the score.
// Also reports the worst 64-device-px tile, so a failure says WHERE the top changed. PNGs are decoded in-file (zlib).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const PW = process.env.PLAYWRIGHT_CORE ?? "/tmp/shots/node_modules/playwright-core/index.mjs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
export const ANGLE_ARGS = {
  metal: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  swiftshader: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
};

export async function launchChrome(angle = "metal") {
  const { chromium } = await import(PW);
  return chromium.launch({ executablePath: CHROME, args: ANGLE_ARGS[angle] ?? ANGLE_ARGS.metal });
}

export function parseSpec(spec) {
  const m = /^(\d+)x(\d+)(?:@(\d(?:\.\d+)?))?(m)?$/.exec(spec);
  if (!m) throw new Error(`bad viewport spec ${spec}`);
  const mobile = !!m[4];
  return { spec, width: +m[1], height: +m[2], dpr: m[3] ? +m[3] : mobile ? 2 : 1, mobile };
}


/** One capture. Returns the sidecar record (also written next to the PNG). */
export async function captureTop(browser, { url = "http://127.0.0.1:3301/", theme = "dark", spec = "1440x900", out, label = "top", noStep = false, log = console.log } = {}) {
  const vp = parseSpec(spec);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    userAgent: vp.mobile ? IPHONE_UA : undefined,
    colorScheme: theme,
    reducedMotion: "no-preference",
  });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("theme", t); } catch {}
    const FIX = new Date("2026-09-24T17:00:00-07:00");
    const orig = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (l, o) { return orig.call(FIX, l, o); };
  }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const notes = [];
  const u = new URL(url);
  u.searchParams.set("jacksDebug", "1");
  await page.goto(u.href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => true));

  // 3. the field
  const gate = await page.evaluate(() => innerWidth >= 640 && matchMedia("(hover: hover) and (pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches);
  let field = { gate };
  if (gate) {
    await page.waitForFunction(() => !!window.__field && window.__field.entered && window.__field.fit, null, { timeout: 45000, polling: "raf" });
    const stepFrom = await page.evaluate((steps) => {
      const j = window.__field;
      const from = { entranceT: +j.entranceT.toFixed(4), frames: j.frames, hasSetDrift: typeof j.setDrift === "function", hasStep: typeof j.step === "function" };
      if (from.hasSetDrift) j.setDrift(false);
      if (steps && from.hasStep) { let n = 0; while (j.entranceT < 14 && n < 2000) { j.step(1 / 60); n++; } from.steps = n; }
      return from;
    }, !noStep);
    if (!stepFrom.hasSetDrift) notes.push("__field.setDrift missing: drift left on");
    if (!noStep && !stepFrom.hasStep) notes.push("__field.step missing: the field settled in real time (non-deterministic)");
    await page.waitForFunction(() => window.__field.idle && window.__field.keepOutsSettled, null, { timeout: 90000, polling: 200 });
    field = { gate, stepFrom, ...(await page.evaluate(() => { const j = window.__field; return { idle: j.idle, drifting: j.drifting, entranceT: +j.entranceT.toFixed(2), tier: j.tier, frames: j.frames }; })) };
  }
  // 4. the fluid idle
  await page.waitForFunction(() => performance.now() >= 9500, null, { timeout: 30000, polling: 250 });

  // 5-7, retried if the flap moved during the shot
  const file = path.join(out, `${label}-${theme}-${vp.spec}.png`);
  let rec = null;
  for (let attempt = 0; attempt < 4 && !rec; attempt++) {
    await page.evaluate(() => { window.__sawOther = false; window.__settledAt = 0; window.__lastWord = ""; });
    const board = await page.evaluate(() => !!document.querySelector(".sf-board"));
    if (board) {
      await page.waitForFunction(() => {
        const b = document.querySelector(".sf-board");
        const word = [...b.querySelectorAll(":scope > .sf-cell:not(.sf-em) > .sf-half.sf-top .sf-glyph")].map((e) => e.textContent).join("");
        if (word !== "ENGINEER") { window.__sawOther = true; window.__settledAt = 0; return false; }
        if (!window.__sawOther) return false;
        const now = performance.now();
        if (!window.__settledAt) window.__settledAt = now;
        return now - window.__settledAt >= 250;
      }, null, { timeout: 40000, polling: 50 });
    } else notes.push("no .sf-board found");
    const rain = await page.evaluate(() => {
      const wrap = [...document.querySelectorAll("canvas")].map((c) => c.parentElement).find((p) => { const s = p && getComputedStyle(p); return s && s.position === "fixed" && s.zIndex === "0"; });
      if (!wrap) return false;
      wrap.style.visibility = "hidden";
      return true;
    });
    if (!rain) notes.push("rain wrapper not found: rain NOT hidden");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const cardLoc = page.locator("[data-hero-card]");
    const cardCount = await cardLoc.count();
    if (!cardCount) notes.push("[data-hero-card] missing: nothing masked (do not share this image)");
    const maskRects = await page.evaluate(() => [...document.querySelectorAll("[data-hero-card]")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
    await page.screenshot({ path: file, animations: "disabled", caret: "hide", mask: cardCount ? [cardLoc] : [] });
    const after = await page.evaluate(() => {
      const b = document.querySelector(".sf-board");
      return b ? [...b.querySelectorAll(":scope > .sf-cell:not(.sf-em) > .sf-half.sf-top .sf-glyph")].map((e) => e.textContent).join("") : null;
    });
    if (board && after !== "ENGINEER") { log(`  flap moved during the shot (${after}); retrying`); await page.evaluate(() => { const w = [...document.querySelectorAll("canvas")].map((c) => c.parentElement).find((p) => p && p.style.visibility === "hidden"); if (w) w.style.visibility = ""; }); continue; }
    const meta = await page.evaluate(() => {
      const fieldCanvas = [...document.querySelectorAll("canvas")].find((c) => { const p = c.closest(".fixed.inset-0.z-10"); return p && p.querySelector("canvas") === c && c.width > 0 && !c.closest("[data-hero-card]"); });
      let gpu = null;
      try { const g = document.createElement("canvas").getContext("webgl"); const e = g && g.getExtension("WEBGL_debug_renderer_info"); gpu = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g ? g.getParameter(g.RENDERER) : null; g?.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
      return { innerWidth, innerHeight, dpr: devicePixelRatio, scrollY, docH: document.documentElement.scrollHeight, theme: document.documentElement.className, heroMetaClock: document.querySelector(".tabular-nums")?.textContent ?? null, fieldCanvasDpr: fieldCanvas ? +(fieldCanvas.width / fieldCanvas.clientWidth).toFixed(3) : null, gpu, ua: navigator.userAgent, tNow: Math.round(performance.now()) };
    });
    rec = { file, url: u.href, label, theme, ...vp, maskRects, rainHidden: rain, flap: "ENGINEER (non-first cycle)", field, ...meta, notes, errors, capturedAt: new Date().toISOString() };
  }
  if (!rec) throw new Error(`capture failed for ${theme} ${spec}`);
  fs.writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify(rec, null, 2));
  await ctx.close();
  return rec;
}

// ---------- SSIM ----------
/** Minimal PNG decoder (8-bit, non-interlaced, colour types 0/2/4/6: what Playwright writes); no dependency. */
export function decodePng(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, ct = 0, bd = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error("interlaced PNG"); }
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bd !== 8) throw new Error(`bit depth ${bd}`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; if (!ch) throw new Error(`colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[dst - stride + x] : 0, c = y && x >= ch ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  return { w, h, ch, px };
}

function lumaOf(file) {
  const { w, h, ch, px } = decodePng(file);
  const n = w * h, y = new Float64Array(n);
  for (let i = 0, o = 0; i < n; i++, o += ch) y[i] = ch < 3 ? px[o] : 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
  return { w, h, y };
}

/** SSIM of two same-size PNGs; masks = [{x,y,w,h}] in DEVICE px; windows touching a mask are skipped. */
export async function ssimFiles(a, b, { masks = [], win = 8, stride = 4, tile = 64 } = {}) {
  const A = lumaOf(a), B = lumaOf(b);
  if (A.w !== B.w || A.h !== B.h) return { ssim: 0, error: `size ${A.w}x${A.h} vs ${B.w}x${B.h}` };
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  const hit = (x, y) => masks.some((m) => x + win > m.x && x < m.x + m.w && y + win > m.y && y < m.y + m.h);
  let sum = 0, n = 0; const tiles = new Map();
  for (let y = 0; y + win <= A.h; y += stride) for (let x = 0; x + win <= A.w; x += stride) {
    if (hit(x, y)) continue;
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let j = 0; j < win; j++) { let o = (y + j) * A.w + x; for (let i = 0; i < win; i++, o++) { const p = A.y[o], q = B.y[o]; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q; } }
    const N = win * win, ma = sa / N, mb = sb / N;
    const va = saa / N - ma * ma, vb = sbb / N - mb * mb, cov = sab / N - ma * mb;
    const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    sum += s; n++;
    const key = `${Math.floor(x / tile)},${Math.floor(y / tile)}`;
    const t = tiles.get(key) ?? { s: 0, n: 0 }; t.s += s; t.n++; tiles.set(key, t);
  }
  let worst = null;
  for (const [k, t] of tiles) { const v = t.s / t.n; if (!worst || v < worst.ssim) { const [tx, ty] = k.split(",").map(Number); worst = { x: tx * tile, y: ty * tile, size: tile, ssim: +v.toFixed(4) }; } }
  let diffPx = 0; for (let i = 0; i < A.y.length; i++) if (Math.abs(A.y[i] - B.y[i]) > 8) diffPx++;
  return { ssim: +(sum / n).toFixed(5), windows: n, worstTile: worst, pxOver8: diffPx, pxTotal: A.y.length };
}

const devMasks = (rec) => (rec?.maskRects ?? []).map((m) => ({ x: Math.floor(m.x * rec.dpr), y: Math.floor(m.y * rec.dpr), w: Math.ceil(m.w * rec.dpr) + 1, h: Math.ceil(m.h * rec.dpr) + 1 }));
export function masksFromSidecar(jsonPath) { try { return devMasks(JSON.parse(fs.readFileSync(jsonPath, "utf8"))); } catch { return []; } }

// ---------- CLI ----------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : true]; }));
  const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.ssim) {
    const masks = args["mask-json"] ? masksFromSidecar(args["mask-json"]) : masksFromSidecar(pos[0].replace(/\.png$/, ".json"));
    console.log(JSON.stringify(await ssimFiles(pos[0], pos[1], { masks }), null, 2));
    process.exit(0);
  }
  const out = args.out ?? "/tmp/wentao-gg-research/baseline";
  fs.mkdirSync(out, { recursive: true });
  const themes = (args.themes ?? "dark,light").split(",");
  const specs = (args.viewports ?? "1440x900,1512x982,390x844m").split(",");
  const angle = args.angle ?? "metal";
  const browser = await launchChrome(angle);
  const results = [];
  let failed = false;
  for (const spec of specs) for (const theme of themes) {
    const t0 = Date.now();
    const rec = await captureTop(browser, { url: args.url, theme, spec, out, label: args.label ?? "top", noStep: !!args["no-step"] });
    const row = { file: path.basename(rec.file), stepFrom: rec.field.stepFrom, docH: rec.docH, fieldCanvasDpr: rec.fieldCanvasDpr, gpu: rec.gpu, notes: rec.notes, secs: Math.round((Date.now() - t0) / 1000) };
    if (args.compare) {
      const ref = path.join(args.compare, path.basename(rec.file));
      const r = await ssimFiles(ref, rec.file, { masks: masksFromSidecar(ref.replace(/\.png$/, ".json")) });
      row.ssim = r; if (!(r.ssim >= +(args.threshold ?? 0.99))) failed = true;
    }
    results.push(row);
    console.log(JSON.stringify(row));
  }
  await browser.close();
  fs.writeFileSync(path.join(out, `${args.label ?? "top"}-summary.json`), JSON.stringify({ angle, results }, null, 2));
  if (args.compare && failed) { console.error(`restAtTopPixels FAIL (threshold ${args.threshold ?? 0.99})`); process.exit(1); }
}
