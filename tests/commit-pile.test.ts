import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PIECE_CAP,
  POUR,
  TRAY,
  capPieces,
  fillScale,
  levelFor,
  piecesForDays,
  pourSchedule,
  shapeOf,
  sizeOf,
  trainFor,
  type Piece,
} from "../app/lib/commitPile";
import { buildDayWindow } from "../app/lib/githubStats";

const HH = Math.tan((45 / 2) * Math.PI / 180) * 11; // R3F viewport half-height at fov 45, z 11

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

// The live 2026-09-16 payload: 165 commits, every one on a level-4 day.
const live: Piece[] = Array.from({ length: 165 }, () => ({ level: 4 }));

test("fillScale solves the crest rule from the tray area with no floor", () => {
  // The 1440 px tray measured hw 11.533; the rule gave k 0.866 there.
  const k1440 = fillScale(11.533, HH, live);
  assert.ok(Math.abs(k1440 - 0.866) < 0.01, `k at 1440 = ${k1440}`);
  // Twice the tray area → √2 the scale; a tray too small for legible pieces is reported
  // as such (k below TRAY.kLegible), not clamped up to overflow.
  const small = fillScale(5, HH, live);
  assert.ok(small < TRAY.kLegible, `k on a 5 u half-width tray = ${small}`);
  const area = (hw: number) => 2 * (hw - TRAY.inset) * (2 * HH - TRAY.floorLift);
  const hwDouble = area(11.533) * 2 / (2 * (2 * HH - TRAY.floorLift)) + TRAY.inset;
  assert.ok(Math.abs(fillScale(hwDouble, HH, live) / k1440 - Math.SQRT2) < 1e-6);
  // A handful of commits caps at kMax rather than becoming boulders.
  assert.equal(fillScale(11.533, HH, live.slice(0, 3)), TRAY.kMax);
  assert.equal(fillScale(11.533, HH, []), 1);
});

test("sizeOf gives a level-4 box about four times the face of a level-0 one", () => {
  const lo = sizeOf(0, "box", 0).area;
  const hi = sizeOf(0, "box", 4).area;
  assert.ok(Math.abs(hi / lo - 1.85 / 0.34) < 1e-9);
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
