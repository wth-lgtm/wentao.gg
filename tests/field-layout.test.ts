import { test } from "node:test";
import assert from "node:assert/strict";

import { FIELD, SEED_FIELD, fieldCamera, fieldCount, fieldScales, keepOutFor, latticeShape, latticeTargets, onScreen, placeWorld, solveTargets, type Rect } from "../app/lib/fieldLayout";
import { DYN, createWorld } from "../app/lib/jackDynamics";
import { STONE } from "../app/lib/stoneGeometry";

const TAN = Math.tan((FIELD.FOV / 2) * Math.PI / 180);

test("sixteen at ≥ 1280 × 800, ten below; a 4 × 4 lattice for sixteen, 5 × 2 for ten", () => {
  assert.equal(fieldCount(1440, 900), 16);
  assert.equal(fieldCount(1280, 800), 16);
  assert.equal(fieldCount(1279, 800), 10);
  assert.equal(fieldCount(1024, 768), 10);
  assert.equal(fieldCount(1440, 700), 10);
  assert.deepEqual(latticeShape(16), { cols: 4, rows: 4 });
  assert.deepEqual(latticeShape(10), { cols: 5, rows: 2 });
});

test("the size rule: a unit stone's diameter is 1.1 × the h1's font size — 123 px beside a 112 px wordmark — and the camera is solved from it", () => {
  const a = fieldCamera(1440, 900, 112);
  assert.ok(Math.abs(a.pxPerUnit * FIELD.UNIT_DIAM - 1.1 * 112) < 1e-9);
  assert.ok(Math.abs(a.pxPerUnit - 61.6) < 0.01 && Math.abs(a.z - 32.95) < 0.01, `${a.pxPerUnit} px/u, z ${a.z}`);
  assert.ok(Math.abs(a.viewH - 2 * a.z * TAN) < 1e-9 && Math.abs(a.viewW - a.viewH * 1.6) < 1e-9);
  const b = fieldCamera(1024, 768, 92.16);
  assert.ok(Math.abs(b.pxPerUnit - 50.69) < 0.01 && Math.abs(b.z - 34.17) < 0.01, `${b.pxPerUnit} px/u, z ${b.z}`);
  const c = fieldCamera(1440, 700, 112);
  assert.ok(Math.abs(c.z - 25.63) < 0.01 && c.z > FIELD.Z_MIN, `z ${c.z}`);
  // the largest cast ≈ the wordmark's cap height, the smallest ≈ a lowercase letter
  assert.ok(FIELD.SCALE_MAX * a.pxPerUnit * FIELD.UNIT_DIAM > 0.7 * 112 * 1.6 && FIELD.SCALE_MIN * a.pxPerUnit * FIELD.UNIT_DIAM < 0.6 * 112 * 1.6);
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

test("scales: stratified over 0.72–1.15 so ten or sixteen cover the range; ten a prefix of sixteen", () => {
  const s16 = fieldScales(16, SEED_FIELD);
  assert.equal(s16.length, 16);
  s16.forEach((s) => assert.ok(s >= FIELD.SCALE_MIN && s <= FIELD.SCALE_MAX, `${s}`));
  assert.ok(Math.min(...s16) < 0.76 && Math.max(...s16) > 1.11, `range ${Math.min(...s16)}–${Math.max(...s16)}`);
  assert.equal(new Set(s16.map((s) => Math.floor((s - FIELD.SCALE_MIN) / ((FIELD.SCALE_MAX - FIELD.SCALE_MIN) / 16)))).size, 16, "one per sixteenth");
  assert.deepEqual(fieldScales(10, SEED_FIELD), s16.slice(0, 10));
});

for (const [w, h, font, count] of [[1440, 900, 112, 16], [1024, 768, 92.16, 10], [1440, 700, 112, 10]] as const) {
  test(`lattice at ${w} × ${h}: ${count} targets inside the 8% margins, one per cell, z alternating in [−2, 2]`, () => {
    const fit = fieldCamera(w, h, font);
    const t = latticeTargets(fit, count, SEED_FIELD);
    assert.equal(t.length, count);
    const { cols, rows } = latticeShape(count);
    const cellW = (fit.viewW * (1 - 2 * FIELD.MARGIN)) / cols, cellH = (fit.viewH * (1 - 2 * FIELD.MARGIN)) / rows;
    t.forEach((p, i) => {
      assert.ok([p.x, p.y, p.z].every(Number.isFinite));
      assert.ok(Math.abs(p.x) < fit.viewW * (0.5 - FIELD.MARGIN) && Math.abs(p.y) < fit.viewH * (0.5 - FIELD.MARGIN), `T${i} at (${p.x}, ${p.y}) is in the margin`);
      assert.ok(Math.abs(p.z) <= FIELD.Z_MAX_ABS && Math.abs(p.z) >= 0.25);
      if (i > 0) assert.ok(Math.sign(p.z) !== Math.sign(t[i - 1].z), "z alternates");
    });
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const d = Math.hypot(t[i].x - t[j].x, t[i].y - t[j].y);
      assert.ok(d >= (1 - 2 * FIELD.JITTER) * Math.min(cellW, cellH) - 1e-9, `T${i} and T${j} share a cell (${d} u apart)`);
    }
    // every cell used once for sixteen
    if (count === 16) {
      const cells = new Set(t.map((p) => `${Math.floor((p.x + fit.viewW / 2 - fit.viewW * FIELD.MARGIN) / cellW)},${Math.floor((fit.viewH / 2 - fit.viewH * FIELD.MARGIN - p.y) / cellH)}`));
      assert.equal(cells.size, 16);
    }
  });
}

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

test("the entrance spawns beyond the NEAREST viewport edge by 1.5 D with vel = −2·(pos − target); the body radius is the stone's", () => {
  const fit = fieldCamera(1440, 900, 112);
  const scales = fieldScales(16, SEED_FIELD);
  const w = createWorld(scales, fit, SEED_FIELD, STONE.R);
  const t = latticeTargets(fit, 16, SEED_FIELD);
  placeWorld(w, t, fit);
  w.bodies.forEach((b, i) => {
    assert.ok(Math.abs(b.r - scales[i]) < 1e-12, "r = 1.0 · scale");
    assert.deepEqual(b.target, t[i]);
    const D = 2 * b.r;
    const beyondX = Math.abs(b.pos.x) - fit.viewW / 2, beyondY = Math.abs(b.pos.y) - fit.viewH / 2;
    assert.ok(Math.abs(Math.max(beyondX, beyondY) - FIELD.SPAWN_D * D) < 1e-9, `T${i} spawned ${Math.max(beyondX, beyondY)} u beyond the edge`);
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
  test(`solved targets at ${key} with the hero on screen: none culled, every disc inside the view, every PROJECTED clearance clear of the h1 and the card (never more than 0.25 D into a band)`, () => {
    const font = Math.min(112, 0.09 * w);
    const fit = fieldCamera(w, h, font);
    const count = fieldCount(w, h);
    const scales = fieldScales(count, SEED_FIELD);
    const avoid = [keepOutFor(rects.h1, fit, 1), keepOutFor(rects.card, fit, 0.5)];
    const { targets, culled } = solveTargets(fit, count, SEED_FIELD, scales, avoid);
    assert.deepEqual(culled, [], `culled ${culled}`);
    assert.equal(targets.length, count);
    let exactlyClear = 0;
    targets.forEach((t, i) => {
      const r = STONE.R * scales[i];
      const proj = fit.z / (fit.z - t.z);
      assert.ok(Math.abs(t.x) <= fit.viewW / 2 - r + 1e-9 && Math.abs(t.y) <= fit.viewH / 2 - r + 1e-9, `slot ${i} disc leaves the view at (${t.x}, ${t.y})`);
      let worst = Infinity;
      for (const k of avoid) worst = Math.min(worst, clearanceOf(t.x * proj, t.y * proj, r, k));
      // the reviewer's rule: a kept slot is never more than a quarter-diameter into a band; almost all sit exactly at its edge
      assert.ok(DYN.KEEP_BAND - worst <= 0.25 * 2 * r + 1e-9, `slot ${i} (z ${t.z}) sits ${worst} u from a box in projection — ${DYN.KEEP_BAND - worst} u into the band`);
      assert.ok(worst >= 0, `slot ${i}'s disc is over a box (${worst} u)`);
      if (worst >= DYN.KEEP_BAND - 1e-9) exactlyClear++;
    });
    assert.ok(exactlyClear >= count - 2, `${count - exactlyClear} of ${count} slots rest inside a band`);
    // the pushes moved something: the raw lattice had slots behind the wordmark and the card
    const raw = latticeTargets(fit, count, SEED_FIELD);
    const moved = targets.filter((t, i) => Math.hypot(t.x - raw[i].x, t.y - raw[i].y) > 1e-9).length;
    assert.ok(moved >= 2, `${moved} slots moved`);
  });
}

test("solved targets: the projection matters — a slot at z −1.75 clear in world x can be inside the band as the camera sees it, and is pushed", () => {
  const fit = fieldCamera(1440, 900, 112);
  // a box left of centre; a target whose world disc is exactly BAND clear of it at z = 0
  const k = { cx: -8, cy: 0, hw: 4, hh: 1 };
  const r = 1;
  const clearX = -8 + 4 + r + DYN.KEEP_PAD + DYN.KEEP_BAND;
  const at = (z: number) => { const proj = fit.z / (fit.z - z); return clearanceOf(clearX * proj, 0, r, k); };
  assert.ok(Math.abs(at(0) - DYN.KEEP_BAND) < 1e-9);
  assert.ok(at(-1.75) > DYN.KEEP_BAND, "farther: seen nearer the centre, away from the left-hand box");
  assert.ok(at(1.75) < DYN.KEEP_BAND, "nearer the camera: seen further left, into the band");
});

test("solved targets: a wall the height of the view is left sideways (nothing culled); a box over the whole view culls every slot; cull = false keeps them", () => {
  const fit = fieldCamera(1440, 900, 112);
  const scales = fieldScales(16, SEED_FIELD);
  const tall = { cx: -fit.viewW / 2 + 3, cy: 0, hw: 6, hh: fit.viewH };
  const s1 = solveTargets(fit, 16, SEED_FIELD, scales, [tall]);
  assert.deepEqual(s1.culled, [], "a 12 u wall at the left edge is escapable to the right");
  s1.targets.forEach((t, i) => assert.ok(t.x * (fit.z / (fit.z - t.z)) >= tall.cx + tall.hw + STONE.R * scales[i] + DYN.KEEP_PAD + DYN.KEEP_BAND - 1e-6, `slot ${i} still in the wall's band`));
  const everything = { cx: 0, cy: 0, hw: fit.viewW, hh: fit.viewH };
  const s2 = solveTargets(fit, 16, SEED_FIELD, scales, [everything]);
  assert.equal(s2.culled.length, 16);
  assert.equal(s2.targets.length, 0);
  const s3 = solveTargets(fit, 16, SEED_FIELD, scales, [everything], false);
  assert.equal(s3.targets.length, 16);
  assert.deepEqual(s3.culled, []);
});
