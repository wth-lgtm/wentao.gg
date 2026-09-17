import { test } from "node:test";
import assert from "node:assert/strict";

import { CAST_10, CAST_16, FIELD, LIGHT_WHITE, SEED_FIELD, atPageTop, fieldCamera, fieldCasting, fieldCount, fieldScales, keepOutFor, latticeOrder, latticeShape, latticeTargets, onScreen, placeWorld, solveTargets, type Rect } from "../app/lib/fieldLayout";
import { DYN, createWorld, isResting, setKeepOut, stepWorld, type KeepOut } from "../app/lib/jackDynamics";

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

test("the size rule: a unit jack's diameter is 1.15 × the h1's font size — 129 px beside a 112 px wordmark — and the camera is solved from it", () => {
  const a = fieldCamera(1440, 900, 112);
  assert.ok(Math.abs(a.pxPerUnit * FIELD.UNIT_DIAM - 1.15 * 112) < 1e-9);
  assert.ok(Math.abs(a.pxPerUnit - 58.55) < 0.01 && Math.abs(a.z - 34.67) < 0.01, `${a.pxPerUnit} px/u, z ${a.z}`);
  assert.ok(Math.abs(a.viewH - 2 * a.z * TAN) < 1e-9 && Math.abs(a.viewW - a.viewH * 1.6) < 1e-9);
  const b = fieldCamera(1024, 768, 92.16);
  assert.ok(Math.abs(b.pxPerUnit - 48.17) < 0.01 && Math.abs(b.z - 35.96) < 0.01, `${b.pxPerUnit} px/u, z ${b.z}`);
  const c = fieldCamera(1440, 700, 112);
  assert.ok(Math.abs(c.z - 26.97) < 0.01 && c.z > FIELD.Z_MIN, `z ${c.z}`);
  // the cast's span in px beside the 112 px wordmark (cap height ≈ 78 px): the largest jack 148 px,
  // the smallest 93 px — a jack's arms make its disc read smaller than the number says
  const largest = FIELD.SCALE_MAX * a.pxPerUnit * FIELD.UNIT_DIAM, smallest = FIELD.SCALE_MIN * a.pxPerUnit * FIELD.UNIT_DIAM;
  assert.ok(Math.abs(largest - 148) < 1 && Math.abs(smallest - 93) < 1, `${smallest}–${largest} px`);
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

test("casting: sixteen = accent 5 (4 matte, 1 glossy), white 6 (5/1), black 5 (3/2); ten = 3 (2/1), 4 (3/1), 3 (2/1); deterministic; ON THE LATTICE no two accents share an edge and same-family edges are few", () => {
  const tally = (slots: readonly { family: string; finish: string }[]) => {
    const t: Record<string, number> = {};
    for (const s of slots) t[`${s.family}-${s.finish}`] = (t[`${s.family}-${s.finish}`] ?? 0) + 1;
    return t;
  };
  assert.deepEqual(tally(CAST_16), { "accent-matte": 4, "accent-glossy": 1, "white-matte": 5, "white-glossy": 1, "black-matte": 3, "black-glossy": 2 });
  assert.deepEqual(tally(CAST_10), { "accent-matte": 2, "accent-glossy": 1, "white-matte": 3, "white-glossy": 1, "black-matte": 2, "black-glossy": 1 });
  for (const count of [16, 10]) {
    const cast = fieldCasting(count, SEED_FIELD);
    assert.deepEqual(tally(cast), tally(count === 16 ? CAST_16 : CAST_10));
    assert.deepEqual(fieldCasting(count, SEED_FIELD), cast, "deterministic");
    // replay the grid: slot k is cell order[k]
    const { cols, rows } = latticeShape(count);
    const order = latticeOrder(count, SEED_FIELD);
    const grid: (string | null)[] = Array.from({ length: cols * rows }, () => null);
    cast.forEach((s, k) => { grid[order[k]] = s.family; });
    assert.ok(grid.every(Boolean), "every cell cast");
    let accentPairs = 0, samePairs = 0;
    const rowsText: string[] = [];
    for (let r = 0; r < rows; r++) {
      rowsText.push(Array.from({ length: cols }, (_, c) => grid[r * cols + c]![0].toUpperCase()).join(" "));
      for (let c = 0; c < cols; c++) {
        const f = grid[r * cols + c];
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const rr = r + dr, cc = c + dc;
          if (rr >= rows || cc >= cols) continue;
          const g = grid[rr * cols + cc];
          if (f === g) { samePairs++; if (f === "accent") accentPairs++; }
        }
      }
    }
    assert.equal(accentPairs, 0, `accents share an edge:\n${rowsText.join("\n")}`);
    // 16 cells have 24 edges; a random 5/6/5 colouring shares ~8 of them — the greedy keeps it well under
    assert.ok(samePairs <= (count === 16 ? 5 : 3), `${samePairs} same-family edges:\n${rowsText.join("\n")}`);
  }
  // Lusion's light-mode whites, a field-side override
  assert.deepEqual(LIGHT_WHITE, { matte: "#8e9098", glossy: "#a3a5ad" });
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

test("the entrance spawns beyond the NEAREST viewport edge by 1.5 D with vel = −2·(pos − target); the body radius is the card's 1.05·scale", () => {
  const fit = fieldCamera(1440, 900, 112);
  const scales = fieldScales(16, SEED_FIELD);
  const w = createWorld(scales, fit, SEED_FIELD);
  const t = latticeTargets(fit, 16, SEED_FIELD);
  placeWorld(w, t, fit);
  w.bodies.forEach((b, i) => {
    assert.ok(Math.abs(b.r - DYN.BODY_R * scales[i]) < 1e-12, "r = 1.05 · scale");
    assert.deepEqual(b.target, t[i]);
    const D = FIELD.UNIT_DIAM * scales[i];
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
      const r = DYN.BODY_R * scales[i];
      const proj = fit.z / (fit.z - t.z);
      assert.ok(Math.abs(t.x) <= fit.viewW / 2 - r + 1e-9 && Math.abs(t.y) <= fit.viewH / 2 - r + 1e-9, `slot ${i} disc leaves the view at (${t.x}, ${t.y})`);
      let worst = Infinity;
      for (const k of avoid) worst = Math.min(worst, clearanceOf(t.x * proj, t.y * proj, r, k));
      // the reviewer's rule: a kept slot is never more than a quarter-diameter into a band; almost all sit exactly at its edge
      assert.ok(DYN.KEEP_BAND - worst <= 0.25 * FIELD.UNIT_DIAM * scales[i] + 1e-9, `slot ${i} (z ${t.z}) sits ${worst} u from a box in projection — ${DYN.KEEP_BAND - worst} u into the band`);
      assert.ok(worst >= 0, `slot ${i}'s disc is over a box (${worst} u)`);
      if (worst >= DYN.KEEP_BAND - 1e-9) exactlyClear++;
    });
    assert.ok(exactlyClear >= count - 2, `${count - exactlyClear} of ${count} slots rest inside a band`);
    const raw = latticeTargets(fit, count, SEED_FIELD);
    const moved = targets.filter((t, i) => Math.hypot(t.x - raw[i].x, t.y - raw[i].y) > 1e-9).length;
    assert.ok(moved >= 2, `${moved} slots moved`);
  });
}

test("solved targets: the projection matters — a slot at z +1.75 clear in world x can be inside the band as the camera sees it", () => {
  const fit = fieldCamera(1440, 900, 112);
  const k = { cx: -8, cy: 0, hw: 4, hh: 1 };
  const r = DYN.BODY_R;
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
  s1.targets.forEach((t, i) => assert.ok(t.x * (fit.z / (fit.z - t.z)) >= tall.cx + tall.hw + DYN.BODY_R * scales[i] + DYN.KEEP_PAD + DYN.KEEP_BAND - 1e-6, `slot ${i} still in the wall's band`));
  const everything = { cx: 0, cy: 0, hw: fit.viewW, hh: fit.viewH };
  const s2 = solveTargets(fit, 16, SEED_FIELD, scales, [everything]);
  assert.equal(s2.culled.length, 16);
  assert.equal(s2.targets.length, 0);
  const s3 = solveTargets(fit, 16, SEED_FIELD, scales, [everything], false);
  assert.equal(s3.targets.length, 16);
  assert.deepEqual(s3.culled, []);
});

test("a rect moved to the page's top: the h1 measured at scrollY 250 solves as the scrollY-0 box", () => {
  const r = atPageTop({ left: 144, top: 109, right: 799, bottom: 221 }, 250);
  assert.deepEqual(r, { left: 144, top: 359, right: 799, bottom: 471 });
  assert.deepEqual(atPageTop({ left: 1, top: 2, right: 3, bottom: 4 }, 0), { left: 1, top: 2, right: 3, bottom: 4 });
});

// the field's own step, as the scene runs it: the solved homes, the band on (the h1 box and the card's at half strength)
function settledField(fit: ReturnType<typeof fieldCamera>, rects: { h1: Rect; card: Rect }, count: number) {
  const scales = fieldScales(count, SEED_FIELD);
  const boxes: KeepOut[] = [keepOutFor(rects.h1, fit, 1), keepOutFor(rects.card, fit, 0.5)];
  const { targets, culled } = solveTargets(fit, count, SEED_FIELD, scales, boxes);
  assert.deepEqual(culled, []);
  const w = createWorld(scales, fit, SEED_FIELD);
  placeWorld(w, targets, fit);
  setKeepOut(w, boxes, fit.z);
  return { w, boxes, scales, targets };
}
const projectedClearance = (w: ReturnType<typeof createWorld>, box: KeepOut) => {
  let worst = Infinity;
  for (const b of w.bodies) { const s = w.eyeZ / (w.eyeZ - b.pos.z); worst = Math.min(worst, clearanceOf(b.pos.x * s, b.pos.y * s, b.r, box)); }
  return worst;
};

test("the whole entrance in node with the band on: over 10 s alive and the fall to rest no body's disc covers the letters (penetration < 0.2 u), the pack rests within 12 s, and it rests ON its homes", () => {
  const fit = fieldCamera(1440, 900, 112);
  const { w, boxes } = settledField(fit, HERO_RECTS["1440x900"], 16);
  let worst = Infinity;
  for (let i = 0; i < 10 * 60; i++) { stepWorld(w, 1 / 60, null, 1); worst = Math.min(worst, projectedClearance(w, boxes[0])); }
  let E = 1, restAt = -1;
  const t0 = w.time;
  for (let i = 0; i < 12 * 60 && restAt < 0; i++) {
    E = Math.max(0, E - 1 / 120);
    if (isResting(w, stepWorld(w, 1 / 60, null, E), E)) restAt = w.time - t0;
    worst = Math.min(worst, projectedClearance(w, boxes[0]));
  }
  assert.ok(worst > -0.2, `a body reached ${-worst} u into the inflated keep-out`);
  assert.ok(restAt > 0 && restAt < 12, `rest took ${restAt} s`);
  assert.ok(projectedClearance(w, boxes[0]) >= DYN.KEEP_BAND - 0.1, `at rest ${projectedClearance(w, boxes[0])} u from the headline's inflated box`);
  const spread = w.bodies.reduce((n, b) => n + Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z), 0) / w.bodies.length;
  assert.ok(spread < 0.15, `mean |pos − target| at rest ${spread} u`);
});

test("a headline that scrolls onto resting jacks (scrollY 250 at 1440 × 900) covers some; the band (ramped in over 0.4 s, outward speed capped at KEEP_VOUT) eases them out under 8 u/s — a kick would be 20 — and they clear it", () => {
  const fit = fieldCamera(1440, 900, 112);
  const { w, boxes } = settledField(fit, HERO_RECTS["1440x900"], 16);
  for (let i = 0; i < 10 * 60; i++) stepWorld(w, 1 / 60, null, 1);
  let E = 1;
  for (let i = 0; i < 12 * 60; i++) { E = Math.max(0, E - 1 / 120); if (isResting(w, stepWorld(w, 1 / 60, null, E), E)) break; }
  // the page has scrolled 250 px: the h1's box is 250 px higher in the viewport
  const shifted: KeepOut = { ...boxes[0], cy: boxes[0].cy + 250 / fit.pxPerUnit };
  const under = w.bodies.filter((b) => { const s = w.eyeZ / (w.eyeZ - b.pos.z); return clearanceOf(b.pos.x * s, b.pos.y * s, b.r, shifted) < 0; }).length;
  assert.ok(under >= 1, `${under} resting jacks under the scrolled headline — the case the ramp exists for`);
  // the scene: strength 0 → 1 over RAMP_S 0.4 s of sim time, the pointer moving (E = 1)
  let vmax = 0;
  const t0 = w.time;
  for (let i = 0; i < 3 * 60; i++) {
    setKeepOut(w, [{ ...shifted, strength: Math.min(1, (w.time - t0) / 0.4) }, boxes[1]], fit.z);
    stepWorld(w, 1 / 60, null, 1);
    for (const b of w.bodies) vmax = Math.max(vmax, Math.hypot(b.vel.x, b.vel.y, b.vel.z));
  }
  // the band drives them out no faster than KEEP_VOUT (the pull and contacts add a little); the
  // ramp alone measured 20.4 u/s here — the cap is what makes it a nudge
  assert.ok(vmax > 3 && vmax < DYN.KEEP_VOUT + 1.5, `the band pushed a jack to ${vmax} u/s (cap ${DYN.KEEP_VOUT})`);
  assert.ok(vmax < 8, `the band pushed a jack to ${vmax} u/s`);
  assert.ok(projectedClearance(w, shifted) >= -0.05, `still ${-projectedClearance(w, shifted)} u under the headline after 3 s`);
});
