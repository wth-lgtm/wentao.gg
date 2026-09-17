import { test } from "node:test";
import assert from "node:assert/strict";

import { FIELD, LIGHT_WHITE, SEED_FIELD, atPageTop, fieldCamera, fieldScales, keepOutFor, onScreen, placeWorld, repivot, solveTargets, type Rect } from "../app/lib/fieldLayout";
import { PACKS_WIDE, fieldPacks, packCentroids, packCount, packOf, packTargets, type Pack } from "../app/lib/fieldPacks";
import { DRIFT } from "../app/lib/fieldDrift";
import { DYN, createWorld, setKeepOut, stepWorld, type KeepOut } from "../app/lib/jackDynamics";

const TAN = Math.tan((FIELD.FOV / 2) * Math.PI / 180);

test("the field's count follows the composition (fieldPacks.ts): 21 at ≥ 1280 × 800, 10 below — the breakpoint is FIELD.WIDE_W × WIDE_H", () => {
  assert.equal(FIELD.WIDE_W, 1280);
  assert.equal(FIELD.WIDE_H, 800);
  assert.equal(packCount(fieldPacks(1440, 900)), 21);
  assert.equal(packCount(fieldPacks(1280, 800)), 21);
  assert.equal(packCount(fieldPacks(1279, 800)), 10);
  assert.equal(packCount(fieldPacks(1024, 768)), 10);
  assert.equal(packCount(fieldPacks(1440, 700)), 10);
});

test("the size rule: a unit jack's diameter is 1.4 × the h1's font size — 156.8 px beside the 112 px wordmark at 1440 × 900 (71.27 px/u, z 28.48; was 1.23, 137.8 px) where Z_MIN does not bind, and the CLAMP where it does: 1440 × 700 wants z 22.15, gets 24 (65.78 px/u, a 144.7 px jack)", () => {
  assert.equal(FIELD.D_PER_FONT, 1.4);
  const a = fieldCamera(1440, 900, 112);
  assert.ok(Math.abs(a.pxPerUnit * FIELD.UNIT_DIAM - 1.4 * 112) < 1e-9);
  assert.ok(Math.abs(a.pxPerUnit * FIELD.UNIT_DIAM - 156.8) < 0.1, `unit jack ${a.pxPerUnit * FIELD.UNIT_DIAM} px`);
  assert.ok(Math.abs(a.pxPerUnit - 71.27) < 0.01 && Math.abs(a.z - 28.48) < 0.01, `${a.pxPerUnit} px/u, z ${a.z}`);
  assert.ok(a.z > FIELD.Z_MIN && a.z < FIELD.Z_MAX, "the rule, not the clamp");
  assert.ok(Math.abs(a.viewH - 2 * a.z * TAN) < 1e-9 && Math.abs(a.viewW - a.viewH * 1.6) < 1e-9);
  // the cast's span beside the 112 px wordmark: the largest jack 180.3 px, the smallest 112.9
  const largest = FIELD.SCALE_MAX * a.pxPerUnit * FIELD.UNIT_DIAM, smallest = FIELD.SCALE_MIN * a.pxPerUnit * FIELD.UNIT_DIAM;
  assert.ok(Math.abs(largest - 180.3) < 0.1 && Math.abs(smallest - 112.9) < 0.1, `${smallest}–${largest} px`);
  const b = fieldCamera(1024, 768, 92.16);
  assert.ok(Math.abs(b.z - 29.53) < 0.01 && b.z > FIELD.Z_MIN, `z ${b.z}`);
  assert.ok(Math.abs(b.pxPerUnit * FIELD.UNIT_DIAM - 129.0) < 0.1, `unit jack ${b.pxPerUnit * FIELD.UNIT_DIAM} px at 1024 × 768`);
  // the short viewport: the rule wants 22.15, the clamp gives 24 and px/u is re-solved from the clamped view
  const c = fieldCamera(1440, 700, 112);
  const unclamped = 700 / (((1.4 * 112) / FIELD.UNIT_DIAM) * 2 * TAN);
  assert.ok(Math.abs(unclamped - 22.15) < 0.01, `unclamped z ${unclamped}`);
  assert.equal(c.z, FIELD.Z_MIN);
  assert.ok(Math.abs(c.pxPerUnit - 65.78) < 0.01 && Math.abs(c.pxPerUnit * FIELD.UNIT_DIAM - 144.7) < 0.1, `${c.pxPerUnit} px/u, ${c.pxPerUnit * FIELD.UNIT_DIAM} px`);
  const d = fieldCamera(1366, 768, 112);
  assert.ok(Math.abs(d.z - 24.3) < 0.01 && d.z > FIELD.Z_MIN, `z ${d.z} — unclamped by a hair`);
  assert.equal(FIELD.Z_MIN, 24);
  assert.equal(FIELD.Z_MAX, 40);
});

test("no h1 to measure: the view is 9 u tall, so 1440 × 900 wants z 20.3, gets the 24 floor and 84.6 px/u; degenerate inputs stay finite", () => {
  const f = fieldCamera(1440, 900, null);
  assert.equal(f.z, FIELD.Z_MIN);
  assert.ok(Math.abs(f.pxPerUnit - 900 / (2 * 24 * TAN)) < 1e-9 && Math.abs(f.pxPerUnit - 84.6) < 0.05, `${f.pxPerUnit}`);
  for (const [w, h, font] of [[0, 0, 112], [1440, 900, 0], [1440, 900, Number.NaN]] as const) {
    const d = fieldCamera(w, h, font);
    assert.ok([d.z, d.viewW, d.viewH, d.pxPerUnit].every(Number.isFinite));
  }
  assert.equal(fieldCamera(2560, 1440, 112).z, FIELD.Z_MAX, "the ceiling binds on a 4k window");
});

test("scales: stratified over 0.72–1.15 for ANY count — one draw per count-th of the range, shuffled — so 21 and 10 both cover the range with no two draws colliding", () => {
  for (const count of [21, 10, 7]) {
    const s = fieldScales(count, SEED_FIELD);
    assert.equal(s.length, count);
    s.forEach((v) => assert.ok(v >= FIELD.SCALE_MIN && v <= FIELD.SCALE_MAX, `${v}`));
    const stratum = (FIELD.SCALE_MAX - FIELD.SCALE_MIN) / count;
    assert.equal(new Set(s.map((v) => Math.floor((v - FIELD.SCALE_MIN) / stratum + 1e-9))).size, count, `one per ${count}-th`);
    assert.ok(Math.min(...s) < FIELD.SCALE_MIN + stratum && Math.max(...s) > FIELD.SCALE_MAX - stratum, `range ${Math.min(...s)}–${Math.max(...s)}`);
    assert.deepEqual(fieldScales(count, SEED_FIELD), s, "deterministic");
  }
  assert.deepEqual(fieldScales(0, SEED_FIELD), []);
  // Lusion's light-mode whites, a field-side override
  assert.deepEqual(LIGHT_WHITE, { matte: "#8e9098", glossy: "#a3a5ad" });
});

test("keep-out from a viewport rect: the h1 at 1440 × 900 becomes a box on z = 0 with y up; on-screen is any overlap with the viewport", () => {
  const fit = fieldCamera(1440, 900, 112);
  const k = keepOutFor({ left: 144, top: 359, right: 799, bottom: 471 }, fit);
  assert.ok(Math.abs(k.cx - (471.5 - 720) / fit.pxPerUnit) < 1e-9 && Math.abs(k.cy - (450 - 415) / fit.pxPerUnit) < 1e-9);
  assert.ok(Math.abs(k.hw - 327.5 / fit.pxPerUnit) < 1e-9 && Math.abs(k.hh - 56 / fit.pxPerUnit) < 1e-9);
  assert.equal(k.strength, 1);
  assert.equal(keepOutFor({ left: 0, top: 0, right: 10, bottom: 10 }, fit, 0.5).strength, 0.5);
  assert.equal(onScreen({ left: 144, top: 359, right: 799, bottom: 471 }, 1440, 900), true);
  assert.equal(onScreen({ left: 144, top: -1000, right: 799, bottom: -900 }, 1440, 900), false);
  assert.equal(onScreen({ left: 144, top: 890, right: 799, bottom: 1000 }, 1440, 900), true);
});

test("the entrance spawns each of the 21 beyond the NEAREST viewport edge by 1.5 D with vel = −2·(pos − target); the body radius is the card's 1.05·scale", () => {
  const fit = fieldCamera(1440, 900, 112);
  const scales = fieldScales(21, SEED_FIELD);
  const w = createWorld(scales, fit, SEED_FIELD);
  const t = packTargets(fit, PACKS_WIDE, SEED_FIELD);
  placeWorld(w, t, fit);
  w.bodies.forEach((b, i) => {
    assert.ok(Math.abs(b.r - DYN.BODY_R * scales[i]) < 1e-12, "r = 1.05 · scale");
    assert.deepEqual(b.target, t[i]);
    const D = FIELD.UNIT_DIAM * scales[i];
    const beyondX = Math.abs(b.pos.x) - fit.viewW / 2, beyondY = Math.abs(b.pos.y) - fit.viewH / 2;
    assert.ok(Math.abs(Math.max(beyondX, beyondY) - FIELD.SPAWN_D * D) < 1e-9, `body ${i} spawned ${Math.max(beyondX, beyondY)} u beyond the edge`);
    assert.ok((beyondX > 0) !== (beyondY > 0), "one axis moved, the other kept");
    assert.ok(Math.abs(b.vel.x - DYN.SPAWN_VEL * (b.pos.x - t[i].x)) < 1e-9 && Math.abs(b.vel.y - DYN.SPAWN_VEL * (b.pos.y - t[i].y)) < 1e-9 && b.vel.z === 0);
  });
});

// the hero's h1 and visitor card as the browser laid them out (live rects from the v1 harness at
// 1440 × 900 and 1024 × 768; the two short viewports scaled from them), viewport px
const HERO_RECTS: Record<string, { h1: Rect; card: Rect }> = {
  "1440x900": { h1: { left: 144, top: 359, right: 799, bottom: 471 }, card: { left: 839, top: 280, right: 1296, bottom: 620 } },
  "1024x768": { h1: { left: 24, top: 293, right: 577, bottom: 405 }, card: { left: 617, top: 222, right: 1000, bottom: 546 } },
  "1440x700": { h1: { left: 144, top: 259, right: 799, bottom: 371 }, card: { left: 839, top: 180, right: 1296, bottom: 520 } },
  "1366x768": { h1: { left: 107, top: 293, right: 762, bottom: 405 }, card: { left: 802, top: 214, right: 1259, bottom: 554 } },
};
const clearanceOf = (x: number, y: number, r: number, k: { cx: number; cy: number; hw: number; hh: number }) => {
  const ex = Math.abs(x - k.cx) - k.hw, ey = Math.abs(y - k.cy) - k.hh;
  return Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - (r + DYN.KEEP_PAD);
};

for (const [key, rects] of Object.entries(HERO_RECTS)) {
  const [w, h] = key.split("x").map(Number);
  test(`solved targets at ${key} with the hero on screen: every target kept, every disc inside the view, none over a box; at most 4 left inside a band and none deeper than 0.6 u (the pushed ones sit exactly at the band's edge — measured 0 deep at every fixture); the 0.25 D rule at 1440 × 900 and 1024 × 768`, () => {
    const font = Math.min(112, 0.09 * w);
    const fit = fieldCamera(w, h, font);
    const packs = fieldPacks(w, h);
    const count = packCount(packs);
    const scales = fieldScales(count, SEED_FIELD);
    const avoid = [keepOutFor(rects.h1, fit, 1), keepOutFor(rects.card, fit, 0.5)];
    const raw = packTargets(fit, packs, SEED_FIELD);
    const { targets, inBand } = solveTargets(fit, raw, scales, avoid);
    assert.equal(targets.length, count, "nothing is culled");
    let inside = 0, deepest = 0;
    targets.forEach((t, i) => {
      const r = DYN.BODY_R * scales[i];
      const proj = fit.z / (fit.z - t.z);
      assert.ok(Math.abs(t.x) <= fit.viewW / 2 - r + 1e-9 && Math.abs(t.y) <= fit.viewH / 2 - r + 1e-9, `body ${i}'s disc leaves the view at (${t.x}, ${t.y})`);
      let worst = Infinity;
      for (const k of avoid) worst = Math.min(worst, clearanceOf(t.x * proj, t.y * proj, r, k));
      assert.ok(worst >= 0, `body ${i}'s disc is over a box (${worst} u)`);
      const depth = DYN.KEEP_BAND - worst;
      if (depth > 1e-6) inside++;
      deepest = Math.max(deepest, depth);
      if (key === "1440x900" || key === "1024x768") assert.ok(depth <= 0.25 * FIELD.UNIT_DIAM * scales[i] + 1e-9, `body ${i} (z ${t.z}) sits ${depth} u into a band`);
    });
    assert.ok(inside <= 4, `${inside} targets left inside a band`);
    assert.ok(deepest <= 0.6, `deepest ${deepest} u`);
    if (key === "1440x900" || key === "1024x768") assert.deepEqual(inBand, []);
    const moved = targets.filter((t, i) => Math.hypot(t.x - raw[i].x, t.y - raw[i].y) > 1e-9).length;
    assert.ok(moved >= 2, `${moved} targets moved`);
  });
}

test("solved targets: the projection matters — a target at z +1.25 clear in world x can be inside the band as the camera sees it", () => {
  const fit = fieldCamera(1440, 900, 112);
  const k = { cx: -8, cy: 0, hw: 4, hh: 1 };
  const r = DYN.BODY_R;
  const clearX = -8 + 4 + r + DYN.KEEP_PAD + DYN.KEEP_BAND;
  const at = (z: number) => { const proj = fit.z / (fit.z - z); return clearanceOf(clearX * proj, 0, r, k); };
  assert.ok(Math.abs(at(0) - DYN.KEEP_BAND) < 1e-9);
  assert.ok(at(-1.25) > DYN.KEEP_BAND, "farther: seen nearer the centre, away from the left-hand box");
  assert.ok(at(1.25) < DYN.KEEP_BAND, "nearer the camera: seen further left, into the band");
});

test("solved targets: a 12 u wall at the left edge is escaped to the right — every target clear of its band, none dropped; a box over the whole view keeps every target and reports every one in `inBand`", () => {
  const fit = fieldCamera(1440, 900, 112);
  const scales = fieldScales(21, SEED_FIELD);
  const raw = packTargets(fit, PACKS_WIDE, SEED_FIELD);
  const tall = { cx: -fit.viewW / 2 + 3, cy: 0, hw: 6, hh: fit.viewH };
  const s1 = solveTargets(fit, raw, scales, [tall]);
  assert.equal(s1.targets.length, 21);
  assert.deepEqual(s1.inBand, [], "a 12 u wall at the left edge is escapable to the right");
  s1.targets.forEach((t, i) => assert.ok(t.x * (fit.z / (fit.z - t.z)) >= tall.cx + tall.hw + DYN.BODY_R * scales[i] + DYN.KEEP_PAD + DYN.KEEP_BAND - 1e-6, `body ${i} still in the wall's band`));
  const everything = { cx: 0, cy: 0, hw: fit.viewW, hh: fit.viewH };
  const s2 = solveTargets(fit, raw, scales, [everything]);
  assert.equal(s2.targets.length, 21, "nothing is culled any more");
  assert.equal(s2.inBand.length, 21);
  s2.targets.forEach((t, i) => assert.ok(Math.abs(t.x) <= fit.viewW / 2 - DYN.BODY_R * scales[i] + 1e-9 && Math.abs(t.y) <= fit.viewH / 2 - DYN.BODY_R * scales[i] + 1e-9, "still clamped into the view"));
});

test("a rect moved to the page's top: the h1 measured at scrollY 250 solves as the scrollY-0 box", () => {
  const r = atPageTop({ left: 144, top: 109, right: 799, bottom: 221 }, 250);
  assert.deepEqual(r, { left: 144, top: 359, right: 799, bottom: 471 });
  assert.deepEqual(atPageTop({ left: 1, top: 2, right: 3, bottom: 4 }, 0), { left: 1, top: 2, right: 3, bottom: 4 });
});

// the field's own step, as the scene runs it: the solved homes, the pivots, the band on (the h1 box and the card's at half strength)
function settledField(fit: ReturnType<typeof fieldCamera>, rects: { h1: Rect; card: Rect }, packs: readonly Pack[]) {
  const count = packCount(packs);
  const scales = fieldScales(count, SEED_FIELD);
  const boxes: KeepOut[] = [keepOutFor(rects.h1, fit, 1), keepOutFor(rects.card, fit, 0.5)];
  const raw = packTargets(fit, packs, SEED_FIELD);
  const { targets } = solveTargets(fit, raw, scales, boxes);
  const w = createWorld(scales, fit, SEED_FIELD);
  placeWorld(w, targets, fit);
  const owners = packOf(packs), centroids = packCentroids(targets, packs);
  repivot(w, owners.map((p) => centroids[p]), owners.map((p) => packs[p].swirlGain));
  setKeepOut(w, boxes, fit.z);
  return { w, boxes, scales, targets, owners, centroids };
}
const projectedClearance = (w: ReturnType<typeof createWorld>, box: KeepOut) => {
  let worst = Infinity;
  for (const b of w.bodies) { const s = w.eyeZ / (w.eyeZ - b.pos.z); worst = Math.min(worst, clearanceOf(b.pos.x * s, b.pos.y * s, b.r, box)); }
  return worst;
};
const spreadByPack = (w: ReturnType<typeof createWorld>, owners: number[], packs: readonly Pack[]) => packs.map((_, pi) => {
  let s = 0, n = 0;
  w.bodies.forEach((b, j) => { if (owners[j] === pi) { s += Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z); n++; } });
  return s / n;
});
// the scene's own settle: 10 s alive (the entrance beat), E closing over 2 s, then 4 s more at E = 0
const settle = (w: ReturnType<typeof createWorld>, onStep?: () => void) => {
  for (let i = 0; i < 10 * 60; i++) { stepWorld(w, 1 / 60, null, 1); onStep?.(); }
  let E = 1;
  for (let i = 0; i < 6 * 60; i++) { E = Math.max(0, E - 1 / 120); stepWorld(w, 1 / 60, null, E); onStep?.(); }
};

test("the whole entrance in node with the band on: over 10 s alive and 6 s of E closing no body's disc covers the letters (penetration < 0.2 u); then every pack has GATHERED — mean |pos − target| ≤ 0.45·√n and every member within 4 u of its centroid — the top row rests clear of the headline, and the field IDLES (nothing faster than DRIFT.IDLE_V) — it never RESTS, a pack under compression turns above REST_W", () => {
  const fit = fieldCamera(1440, 900, 112);
  const { w, boxes, owners, centroids } = settledField(fit, HERO_RECTS["1440x900"], PACKS_WIDE);
  let worst = Infinity;
  settle(w, () => { worst = Math.min(worst, projectedClearance(w, boxes[0])); });
  assert.ok(worst > -0.2, `a body reached ${-worst} u into the inflated keep-out`);
  assert.ok(projectedClearance(w, boxes[0]) >= 0, `at rest ${projectedClearance(w, boxes[0])} u from the headline's inflated box`);
  const spread = spreadByPack(w, owners, PACKS_WIDE);
  PACKS_WIDE.forEach((p, pi) => assert.ok(spread[pi] <= 0.45 * Math.sqrt(p.n), `pack ${pi} (${p.n}) spread ${spread[pi]} u > ${0.45 * Math.sqrt(p.n)}`));
  assert.ok(spread[0] > 0.5 && spread[1] > 0.4, `the packs are under compression: ${spread} — a lattice rested at < 0.15`);
  w.bodies.forEach((b, j) => {
    const c = centroids[owners[j]];
    assert.ok(Math.hypot(b.pos.x - c.x, b.pos.y - c.y, b.pos.z - c.z) < 4, `body ${j} is ${Math.hypot(b.pos.x - c.x, b.pos.y - c.y, b.pos.z - c.z)} u from its pack's centroid`);
  });
  // a column toward the camera: the fourteen span more than 2 u of z at rest
  const zs = w.bodies.filter((_, j) => owners[j] === 0).map((b) => b.pos.z);
  assert.ok(Math.max(...zs) - Math.min(...zs) > 2, `the lower pack spans ${Math.max(...zs) - Math.min(...zs)} u of z`);
  const r = stepWorld(w, 1 / 60, null, 0);
  assert.ok(r.maxDpos / r.dt < DRIFT.IDLE_V, `not idle: ${r.maxDpos / r.dt} u/s`);
  // no interpenetration left after the entrance's overlap
  let pen = 0;
  for (let i = 0; i < w.bodies.length; i++) for (let j = i + 1; j < w.bodies.length; j++) { const a = w.bodies[i], b = w.bodies[j]; pen = Math.max(pen, a.r + b.r - Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)); }
  assert.ok(pen < 0.05, `bodies still overlap by ${pen} u`);
});

test("a headline that scrolls onto settled jacks (scrollY 250 at 1440 × 900) covers the upper pack; the band (ramped in over 0.4 s, outward speed capped at KEEP_VOUT) eases them out under 8 u/s — a kick would be 20 — and they clear it", () => {
  const fit = fieldCamera(1440, 900, 112);
  const { w, boxes } = settledField(fit, HERO_RECTS["1440x900"], PACKS_WIDE);
  settle(w);
  for (let i = 0; i < 2 * 60; i++) stepWorld(w, 1 / 60, null, 0);
  // the page has scrolled 250 px: the h1's box is 250 px higher in the viewport
  const shifted: KeepOut = { ...boxes[0], cy: boxes[0].cy + 250 / fit.pxPerUnit };
  const under = w.bodies.filter((b) => { const s = w.eyeZ / (w.eyeZ - b.pos.z); return clearanceOf(b.pos.x * s, b.pos.y * s, b.r, shifted) < 0; }).length;
  assert.ok(under >= 1, `${under} settled jacks under the scrolled headline — the case the ramp exists for`);
  // the scene: strength 0 → 1 over RAMP_S 0.4 s of sim time, the pointer moving (E = 1)
  let vmax = 0;
  const t0 = w.time;
  for (let i = 0; i < 3 * 60; i++) {
    setKeepOut(w, [{ ...shifted, strength: Math.min(1, (w.time - t0) / 0.4) }, boxes[1]], fit.z);
    stepWorld(w, 1 / 60, null, 1);
    for (const b of w.bodies) vmax = Math.max(vmax, Math.hypot(b.vel.x, b.vel.y, b.vel.z));
  }
  // the band drives them out no faster than KEEP_VOUT; a PACK passes the shove on through its
  // contacts and the pull adds a little, up to ≈ 1.6 u/s more (measured 6.6–7.6 across settle
  // times; a lone lattice jack read 6–7.5). The ramp alone measured 20.4 u/s here — the cap is
  // what makes it a nudge
  assert.ok(vmax > 3 && vmax < 8, `the band pushed a jack to ${vmax} u/s (cap ${DYN.KEEP_VOUT})`);
  assert.ok(projectedClearance(w, shifted) >= -0.05, `still ${-projectedClearance(w, shifted)} u under the headline after 3 s`);
});
