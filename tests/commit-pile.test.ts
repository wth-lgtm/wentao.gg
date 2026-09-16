import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PIECE_CAP,
  POUR,
  TRAY,
  capPieces,
  levelFor,
  piecesForDays,
  pourSchedule,
  shapeOf,
  sizeOf,
  trainFor,
  trayFit,
  type Piece,
} from "../app/lib/commitPile";
import { WORLD } from "../app/lib/pileScene";
import { buildDayWindow } from "../app/lib/githubStats";

test("levelFor is the grid's five-step ramp", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 10, 11, 45].map(levelFor), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test("piecesForDays makes exactly one piece per dated commit, none for empty days", () => {
  const counts = new Map([
    ["2026-07-22", 22],
    ["2026-07-23", 42],
    ["2026-09-16", 2],
  ]);
  const days = buildDayWindow(new Date("2026-09-16T12:00:00Z"), 12, counts);
  const pieces = piecesForDays(days);
  // The window sum, never the repo total: level 0 means "a day with no commits" in the
  // legend, and a commit cannot sit on one of those.
  assert.equal(pieces.length, 66);
  assert.equal(pieces.filter((p) => p.level === 0).length, 0);
  assert.equal(pieces.filter((p) => p.level === 4).length, 64);
  assert.equal(pieces.filter((p) => p.level === 1).length, 2);
});

test("piecesForDays pours the oldest day first so the pile is a sediment", () => {
  const pieces = piecesForDays([
    { date: "2026-09-14", count: 1 },
    { date: "2026-09-15", count: 0 },
    { date: "2026-09-16", count: 12 },
  ]);
  assert.deepEqual(pieces.map((p) => p.level), [1, ...Array(12).fill(4)]);
});

test("piecesForDays of a quiet window is empty, not padded", () => {
  assert.deepEqual(piecesForDays(buildDayWindow(new Date("2026-09-16T12:00:00Z"), 12, new Map())), []);
});

test("capPieces keeps the newest pieces and reports the true total", () => {
  const many: Piece[] = Array.from({ length: 500 }, (_, i) => ({ level: i < 300 ? 1 : 4 }));
  const capped = capPieces(many);
  assert.equal(PIECE_CAP, 200);
  assert.equal(capped.shown.length, 200);
  assert.equal(capped.total, 500);
  // Oldest first in, so the newest are the LAST ones — those survive.
  assert.ok(capped.shown.every((p) => p.level === 4));
  const few = capPieces(many.slice(0, 165));
  assert.equal(few.shown.length, 165);
  assert.equal(few.total, 165);
});

// The live 2026-09-16 payload: 192 commits, every one on a level-4 day.
const live: Piece[] = Array.from({ length: 192 }, () => ({ level: 4 }));

test("trayFit solves the coverage rule: the pieces' resting footprints sum to TRAY.coverage floors", () => {
  const fit = trayFit(691, 273, live);
  let sum = 0;
  for (let i = 0; i < live.length; i++) sum += sizeOf(i, shapeOf(i), live[i].level).footprint;
  assert.ok(Math.abs((sum * fit.k * fit.k) / (WORLD.W * WORLD.D) - TRAY.coverage) < 1e-9, `coverage at k ${fit.k}`);
  // Re-keyed by measurement: the design expected k ≈ 0.6 at coverage 1.8; the tray objects
  // have larger resting footprints and the heap packs looser than flat layers, so at the
  // measured coverage 1.3 the live 192 solve to k ≈ 0.47: boxes 0.20–0.26 u = 14–19 px at
  // 72 px/u, legible (≥ 10 px) with room.
  assert.ok(fit.k > 0.4 && fit.k < 0.55, `k = ${fit.k}`);
  assert.ok(fit.pxPerUnit > 69 && fit.pxPerUnit < 75, `px/u ${fit.pxPerUnit}`);
  assert.ok(fit.legible, `the smallest box is ${fit.k * TRAY.minBox * fit.pxPerUnit} px`);
  assert.ok(fit.headroomOk);
});

test("trayFit: k follows the pieces, not the pixels; legibility follows the pixels", () => {
  const wide = trayFit(691, 273, live);
  const fluid = trayFit(520, 273, live);
  assert.equal(wide.k, fluid.k);
  assert.ok(fluid.pxPerUnit < wide.pxPerUnit);
  assert.ok(fluid.legible, "a ~900 px viewport still mounts the tray");
  // A tray column too narrow for a 10 px block hides itself, never overfills.
  const tiny = trayFit(300, 273, live);
  assert.equal(tiny.k, wide.k);
  assert.ok(!tiny.legible, `k·minBox·px/u = ${tiny.k * TRAY.minBox * tiny.pxPerUnit}`);
  assert.ok(tiny.kLegible > tiny.k);
  assert.ok(wide.kLegible < wide.k);
});

test("trayFit caps a handful of commits at kMax rather than boulders, and an empty pile at 1", () => {
  assert.equal(trayFit(691, 273, live.slice(0, 3)).k, TRAY.kMax);
  assert.equal(trayFit(691, 273, []).k, 1);
});

test("sizeOf: a box rests on its largest face and its height is the day's extrusion", () => {
  const { scale, footprint } = sizeOf(0, "box", 4);
  const [w, h, d] = scale;
  assert.ok(h > w && h > d, "a level-4 box is a tall stick");
  assert.ok(Math.abs(footprint - w * Math.max(h, d)) < 1e-12);
  // level 4 stands 1.85/0.34 of a level-0 box for the same piece
  assert.ok(Math.abs(sizeOf(0, "box", 4).scale[1] / sizeOf(0, "box", 0).scale[1] - 1.85 / 0.34) < 1e-9);
  // round pieces keep their silhouette: uniform scale, footprint ∝ s²
  const die = sizeOf(1, "die", 4);
  assert.equal(die.scale[0], die.scale[1]);
  assert.ok(Math.abs(die.footprint - die.scale[0] * die.scale[0]) < 1e-12);
  // The box brick is the most common shape (three of nine picks).
  const boxes = Array.from({ length: 9000 }, (_, i) => shapeOf(i)).filter((s) => s === "box").length;
  assert.ok(boxes > 2700 && boxes < 3300, `${boxes} boxes in 9000`);
});

test("trainFor keeps the pour inside the beat budget until the train is full", () => {
  assert.equal(trainFor(165, 8), 4); // the live 1440 layout: 17 beats measured
  assert.equal(trainFor(200, 8), 5);
  assert.equal(trainFor(5, 8), 1);
  assert.equal(trainFor(200, 3), POUR.trainMax); // one slot per beat: the budget cannot hold
});

test("pourSchedule: one entry per piece, slots reused only every PHASES beats, rungs inside the train", () => {
  for (const slots of [6, 8, 10, 12, 14]) {
    const n = PIECE_CAP;
    const train = trainFor(n, slots);
    const sched = pourSchedule(n, slots, train);
    assert.equal(sched.length, n);
    const beats = Math.max(...sched.map((s) => s.beat)) + 1;
    assert.ok(beats <= POUR.maxBeats, `${n} pieces over ${slots} slots take ${beats} beats`);
    const seen = new Map<string, number>();
    for (const s of sched) {
      assert.ok(s.slot >= 0 && s.slot < slots);
      assert.ok(s.rung >= 0 && s.rung < train);
      assert.equal(s.slot % POUR.phases, s.beat % POUR.phases, "a beat opens only its own phase's slots");
      const key = `${s.slot}:${s.beat}:${s.rung}`;
      assert.equal(seen.get(key), undefined, `mouth position ${key} used twice`);
      seen.set(key, 1);
    }
    // The same slot is never reopened on consecutive beats.
    const bySlot = new Map<number, number[]>();
    for (const s of sched) bySlot.set(s.slot, [...(bySlot.get(s.slot) ?? []), s.beat]);
    for (const beatsOfSlot of bySlot.values()) {
      const distinct = [...new Set(beatsOfSlot)].sort((a, b) => a - b);
      for (let i = 1; i < distinct.length; i++) assert.ok(distinct[i] - distinct[i - 1] >= POUR.phases);
    }
  }
});

test("pourSchedule beyond the budget is honest: more pieces than the budget holds take more beats", () => {
  const sched = pourSchedule(1000, 6, POUR.trainMax);
  assert.equal(sched.length, 1000);
  assert.ok(Math.max(...sched.map((s) => s.beat)) + 1 > POUR.maxBeats);
});
