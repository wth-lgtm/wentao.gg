import { test } from "node:test";
import assert from "node:assert/strict";

import { levelFor, piecesForDays, snapshotDay } from "../app/lib/commitPile";
import { buildDayWindow, commitWindowStart, utcDayKey } from "../app/lib/githubStats";

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

test("snapshotDay inverts commitWindowStart: the UTC day the route regenerated on", () => {
  for (const iso of ["2026-09-16T00:04:00Z", "2026-09-16T23:59:59Z", "2026-03-08T12:00:00Z"]) {
    const now = new Date(iso);
    const start = utcDayKey(commitWindowStart(now, 12));
    assert.equal(snapshotDay(start, 12), utcDayKey(now));
  }
});

test("snapshotDay returns null for a payload without a usable window start", () => {
  assert.equal(snapshotDay(null, 12), null);
  assert.equal(snapshotDay(undefined, 12), null);
  assert.equal(snapshotDay("", 12), null);
  assert.equal(snapshotDay("not a date", 12), null);
});
