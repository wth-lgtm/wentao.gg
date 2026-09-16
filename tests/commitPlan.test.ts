import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARRIVAL_MS,
  INVERSION_MS,
  MAX_TRAVEL_ROWS,
  NO_CHANGE,
  RESOUNDING_MS,
  ROW_H,
  arrivalDelayMs,
  changeKind,
  planCommit,
  travelPx,
  zeroBlock,
} from "../app/projects/hl-whale-tracker/lib/commitPlan";

// The commit engine's arithmetic, separated from the DOM it drives. The previous hook
// (useReSeat) fired on every order change — a period switch replaced 68–90% of the rows
// and it animated the one survivor while forty-nine popped; a direction toggle reversed
// fifty rows for zero information. The kind of change now decides the moment, and
// everything the moment needs — travel, stagger, which rows leave and which arrive,
// where the zero-volume block sits — is computed here, with no measurement, so the
// hook never forces layout inside a commit.

const controls = {
  period: "7d" as const,
  sort: "pnl" as const,
  dir: "desc" as const,
};

test("changeKind: the window is the re-sounding, and it outranks a sort that changes with it", () => {
  assert.equal(changeKind(controls, { ...controls, period: "30d" }), "period");
  // Back can revert the window and the sort in one step; the bigger change names it.
  assert.equal(
    changeKind(controls, { period: "1d", sort: "volume", dir: "asc" }),
    "period"
  );
});

test("changeKind: a new sort field is the inversion even though the direction resets with it", () => {
  assert.equal(changeKind(controls, { ...controls, sort: "winRate" }), "sort-field");
  assert.equal(
    changeKind({ ...controls, dir: "asc" }, { ...controls, sort: "volume", dir: "desc" }),
    "sort-field"
  );
});

test("changeKind: the same field the other way is only a direction toggle", () => {
  assert.equal(changeKind(controls, { ...controls, dir: "asc" }), "sort-direction");
});

test("changeKind: nothing the board sorts by changed — a tab or a trader is not a board commit", () => {
  assert.equal(changeKind(controls, { ...controls }), null);
});

test("NO_CHANGE is the state before any control has moved: no kind, sequence zero", () => {
  assert.deepEqual(NO_CHANGE, { kind: null, seq: 0 });
});

test("travelPx: dy is (from − to) × ROW_H, so a row climbing seven berths starts 308px low", () => {
  assert.equal(ROW_H, 44);
  assert.equal(travelPx(10, 3), 7 * 44);
  assert.equal(travelPx(3, 10), -7 * 44);
  assert.equal(travelPx(5, 5), 0);
});

test("travelPx: distance is clamped to ten rows — 2100px on an expo-out is a blur, not a movement", () => {
  assert.equal(MAX_TRAVEL_ROWS, 10);
  assert.equal(travelPx(0, 49), -10 * 44);
  assert.equal(travelPx(49, 0), 10 * 44);
  assert.equal(travelPx(0, 10), -10 * 44);
  assert.equal(travelPx(0, 9), -9 * 44);
});

test("arrivalDelayMs: 140 + min(rank × 8, 240), so arrivals seat top-down and the cap lands at rank 30", () => {
  assert.equal(arrivalDelayMs(1), 148);
  assert.equal(arrivalDelayMs(10), 220);
  assert.equal(arrivalDelayMs(30), 380);
  assert.equal(arrivalDelayMs(31), 380);
  assert.equal(arrivalDelayMs(50), 380);
  for (let r = 1; r < 50; r++) assert.ok(arrivalDelayMs(r) <= arrivalDelayMs(r + 1));
});

test("the last arrival ends exactly when the re-sounding does; the inversion is the plan's 380", () => {
  assert.equal(arrivalDelayMs(50) + ARRIVAL_MS, RESOUNDING_MS);
  assert.equal(RESOUNDING_MS, 620);
  assert.equal(INVERSION_MS, 380);
});

test("planCommit: held rows carry their travel, departures their old berth, arrivals their new one and delay", () => {
  const prev = ["a", "b", "c", "d"];
  const next = ["c", "a", "x", "y"];
  const plan = planCommit(prev, next);

  assert.deepEqual(plan.held, [
    { key: "c", from: 2, to: 0, dy: 2 * 44 },
    { key: "a", from: 0, to: 1, dy: -1 * 44 },
  ]);
  assert.deepEqual(plan.departed, [
    { key: "b", from: 1 },
    { key: "d", from: 3 },
  ]);
  assert.deepEqual(plan.arrived, [
    { key: "x", to: 2, delayMs: arrivalDelayMs(3) },
    { key: "y", to: 3, delayMs: arrivalDelayMs(4) },
  ]);
});

test("planCommit: an unmoved row is still held, with zero travel — the ghost needs to hide it too", () => {
  const plan = planCommit(["a", "b"], ["a", "b"]);
  assert.deepEqual(plan.held, [
    { key: "a", from: 0, to: 0, dy: 0 },
    { key: "b", from: 1, to: 1, dy: 0 },
  ]);
  assert.deepEqual(plan.departed, []);
  assert.deepEqual(plan.arrived, []);
});

test("planCommit: the same set in a new order is all held and nothing else — the inversion", () => {
  const prev = ["a", "b", "c"];
  const plan = planCommit(prev, ["c", "b", "a"]);
  assert.equal(plan.held.length, 3);
  assert.deepEqual(plan.departed, []);
  assert.deepEqual(plan.arrived, []);
});

const row = (address: string, volume: number) => ({ address, volume });

test("zeroBlock: only the volume sort stacks the zeros — under any other sort they are scattered", () => {
  const rows = [row("a", 0), row("b", 5), row("c", 0)];
  assert.equal(zeroBlock(rows, "pnl"), null);
  assert.equal(zeroBlock(rows, "winRate"), null);
});

test("zeroBlock: volume ascending puts the block on top; the rows below it are what anchors it", () => {
  const rows = [row("a", 0), row("b", 0), row("c", 0), row("d", 5), row("e", 9)];
  assert.deepEqual(zeroBlock(rows, "volume"), { start: 0, count: 3, below: 2 });
});

test("zeroBlock: volume descending puts the block at the bottom, nothing below it", () => {
  const rows = [row("d", 5), row("e", 9), row("a", 0), row("b", 0)];
  assert.deepEqual(zeroBlock(rows, "volume"), { start: 2, count: 2, below: 0 });
});

test("zeroBlock: no zeros, no block; an empty board, no block", () => {
  assert.equal(zeroBlock([row("a", 1), row("b", 2)], "volume"), null);
  assert.equal(zeroBlock([], "volume"), null);
});
