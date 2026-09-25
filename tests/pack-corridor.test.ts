import { test } from "node:test";
import assert from "node:assert/strict";

import { CORRIDOR_MIN_PX, packBoxes, packCorridor } from "../app/lib/packCorridor";
import { SEED_FIELD, fieldCamera, fieldScales, keepOutFor, placeWorld, repivot, solveTargets, type Rect } from "../app/lib/fieldLayout";
import { fieldPacks, packCentroids, packCount, packOf, packTargets } from "../app/lib/fieldPacks";
import { DYN, createWorld, setKeepOut, stepWorld } from "../app/lib/jackDynamics";
import { driftOffset, packDriftOffset } from "../app/lib/fieldDrift";
import { STAGE_CLEAR } from "../app/lib/chapterList";

// the four fixture viewports (the hero rects as tests/field-layout.test.ts has them) and the pinned dial's
// x-range at each (max-w-6xl content, 24 px gutters, the 4fr : 8fr grid with a 48 px gap)
const FIXTURES: Record<string, { h1: Rect; card: Rect }> = {
  "1440x900": { h1: { left: 144, top: 359, right: 799, bottom: 471 }, card: { left: 839, top: 280, right: 1296, bottom: 620 } },
  "1024x768": { h1: { left: 24, top: 293, right: 577, bottom: 405 }, card: { left: 617, top: 222, right: 1000, bottom: 546 } },
  "1440x700": { h1: { left: 144, top: 259, right: 799, bottom: 371 }, card: { left: 839, top: 180, right: 1296, bottom: 520 } },
  "1366x768": { h1: { left: 107, top: 293, right: 762, bottom: 405 }, card: { left: 802, top: 214, right: 1259, bottom: 554 } },
};
const dialX = (w: number): [number, number] => {
  const content = Math.min(1152, w - 48);
  const left = (w - content) / 2;
  return [left, left + ((content - 48) * 4) / 12];
};
const TAN = Math.tan((12.5 * Math.PI) / 180);

/** the scene's own solve and step (JackFieldScene.layout + applyDrift + stepWorld), settled with the drift on */
function settledBodies(w: number, h: number, font: number, rects: { h1: Rect; card: Rect }, seconds: number, onFrame: (discs: { cx: number; cy: number; r: number }[]) => void) {
  const fit = fieldCamera(w, h, font);
  const packs = fieldPacks(w, h);
  const scales = fieldScales(packCount(packs), SEED_FIELD);
  const boxes = [keepOutFor(rects.h1, fit, 1), keepOutFor(rects.card, fit, 0.5)];
  const { targets } = solveTargets(fit, packTargets(fit, packs, SEED_FIELD), scales, boxes);
  const world = createWorld(scales, fit, SEED_FIELD);
  placeWorld(world, targets, fit);
  const owners = packOf(packs), cents = packCentroids(targets, packs);
  repivot(world, owners.map((p) => cents[p]), owners.map((p) => packs[p].swirlGain));
  setKeepOut(world, boxes, fit.z);
  const off = { x: 0, y: 0, z: 0 }, poff = { x: 0, y: 0, z: 0 };
  let E = 1;
  for (let i = 0; i < seconds * 60; i++) {
    world.bodies.forEach((b, j) => {
      driftOffset(j, world.time, SEED_FIELD, off);
      packDriftOffset(owners[j], world.time, SEED_FIELD, poff);
      b.target = { x: targets[j].x + off.x + poff.x, y: targets[j].y + off.y + poff.y, z: targets[j].z + off.z + poff.z };
    });
    if (i > 10 * 60) E = Math.max(0, E - 1 / 120);
    stepWorld(world, 1 / 60, null, E);
    if (i > 14 * 60 && i % 3 === 0) {
      onFrame(world.bodies.map((b) => { const ppu = h / 2 / ((fit.z - b.pos.z) * TAN); return { cx: w / 2 + b.pos.x * ppu, cy: h / 2 - b.pos.y * ppu, r: b.r * ppu }; }));
    }
  }
  return { fit, targets, scales, owners };
}

for (const [key, rects] of Object.entries(FIXTURES)) {
  const [w, h] = key.split("x").map(Number);
  const font = Math.min(112, 0.09 * w);
  test(`the corridor at ${key} is the scene's own solve: every solved target disc lies inside its pack's box, and no settled body (the scene's step, drift on, 14–30 s) ever enters the corridor inside the dial's column`, () => {
    const corridor = packCorridor({ width: w, height: h, h1FontPx: font, hero: rects, packs: fieldPacks(w, h), x: dialX(w), clear: STAGE_CLEAR });
    assert.ok(corridor, `a corridor exists at ${key}`);
    assert.ok(corridor!.bottom - corridor!.top >= CORRIDOR_MIN_PX);
    assert.ok(corridor!.top >= STAGE_CLEAR.top && corridor!.bottom <= h - STAGE_CLEAR.bottom);
    const [x0, x1] = dialX(w);
    let worst = Infinity;
    const { targets, scales, owners, fit } = settledBodies(w, h, font, rects, 30, (discs) => {
      for (const d of discs) {
        if (d.cx + d.r <= x0 || d.cx - d.r >= x1) continue;
        // the vertical distance from the disc to the corridor (negative = inside it)
        const gap = Math.max(corridor!.top - (d.cy + d.r), (d.cy - d.r) - corridor!.bottom);
        worst = Math.min(worst, gap);
      }
    });
    assert.ok(worst >= 0, `a settled body entered the corridor by ${-worst} px`);
    const boxes = packBoxes({ width: w, height: h, h1FontPx: font, hero: rects, packs: fieldPacks(w, h) });
    targets.forEach((t, i) => {
      const ppu = h / 2 / ((fit.z - t.z) * TAN);
      const cx = w / 2 + t.x * ppu, cy = h / 2 - t.y * ppu, r = DYN.BODY_R * scales[i] * ppu;
      const b = boxes[owners[i]];
      assert.ok(cx - r >= b.left && cx + r <= b.right && cy - r >= b.top && cy + r <= b.bottom, `target ${i} outside its pack's box`);
    });
  });
}

test("at 1440 × 900 the corridor is the gap between the seven above the name and the fourteen below it (≈ y 280–550)", () => {
  const c = packCorridor({ width: 1440, height: 900, h1FontPx: 112, hero: FIXTURES["1440x900"], packs: fieldPacks(1440, 900), x: dialX(1440), clear: STAGE_CLEAR })!;
  assert.ok(c.top > 240 && c.top < 320, `top ${c.top}`);
  assert.ok(c.bottom > 520 && c.bottom < 600, `bottom ${c.bottom}`);
});

test("no gap of CORRIDOR_MIN_PX, no corridor (the dial then sits at the stage's top)", () => {
  const huge = [{ cx: -0.45, cy: 0, n: 14, r: 2.0, swirlGain: 1 }, { cx: -0.45, cy: 0.66, n: 7, r: 0.9, swirlGain: 3 }, { cx: -0.45, cy: -0.66, n: 7, r: 0.9, swirlGain: 3 }];
  assert.equal(packCorridor({ width: 1440, height: 900, h1FontPx: 112, hero: { h1: null, card: null }, packs: huge, x: dialX(1440), clear: STAGE_CLEAR }), null);
});
