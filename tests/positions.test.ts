import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DUST_USD,
  byValueDesc,
  isDust,
  maintenanceShare,
  sumOf,
} from "../app/projects/hl-whale-tracker/lib/positions";
import type { PerpPosition } from "../app/projects/hl-whale-tracker/lib/trader";

// The four primitives the Positions tab's arithmetic rests on. They lived inside
// PositionsPanel.tsx, which is a client component with no test of its own, so the two
// facts that matter most about them — that a missing figure never becomes a 0, and
// that an unknown notional never sorts as though it were worth nothing — were asserted
// only by the comments beside them.
//
// Every magnitude below is a live reading: the residues the dust gate is for measured
// $0.01, $0.35, $3, $18 and $22, and the 7d #1 account was carrying 16,832,367.54 of
// maintenance margin against 108.44M of equity (15.5%).

const pos = (over: Partial<PerpPosition> = {}): PerpPosition => ({
  coin: "BTC",
  szi: 1,
  side: "LONG",
  entryPx: 100,
  positionValue: 1000,
  unrealizedPnl: 10,
  roe: 0.1,
  liquidationPx: 50,
  marginUsed: 100,
  leverage: 10,
  leverageType: "cross",
  maxLeverage: 50,
  fundingSinceOpen: -1,
  ...over,
});

test("isDust: the gate is absolute, and an unpriced position is never dust", () => {
  assert.equal(DUST_USD, 10);
  assert.equal(isDust(pos({ positionValue: 0.35 })), true);
  assert.equal(isDust(pos({ positionValue: 9.99 })), true);
  assert.equal(isDust(pos({ positionValue: 10 })), false);
  assert.equal(isDust(pos({ positionValue: 21_070 })), false);
  // "We could not price this" is not "this is worth nothing": folding it away would
  // hide a position the panel has no figure for.
  assert.equal(isDust(pos({ positionValue: null })), false);
});

test("byValueDesc: largest notional first, unknown value last, ties keep upstream order", () => {
  const rows = [
    pos({ coin: "SUI", positionValue: 0.35 }),
    pos({ coin: "XRP", positionValue: 19_600_000 }),
    pos({ coin: "WLD", positionValue: null }),
    pos({ coin: "INJ", positionValue: 1_630_000 }),
  ];
  assert.deepEqual(
    [...rows].sort(byValueDesc).map((p) => p.coin),
    ["XRP", "INJ", "SUI", "WLD"]
  );
  // Equal values compare 0, so Array.prototype.sort's stability keeps arrival order.
  const tied = [
    pos({ coin: "A", positionValue: 5 }),
    pos({ coin: "B", positionValue: 5 }),
  ];
  assert.deepEqual(
    [...tied].sort(byValueDesc).map((p) => p.coin),
    ["A", "B"]
  );
  // Two unknowns are equal to each other, not ordered against each other.
  assert.equal(byValueDesc(pos({ positionValue: null }), pos({ positionValue: null })), 0);
});

test("sumOf: the total travels with how much of the book it covers", () => {
  assert.deepEqual(sumOf([1, 2, 3]), { total: 6, seen: 3, of: 3 });
  // A figure missing from ONE of twelve present rows is a case the data produces, and
  // the header used to print the sum of eleven as though it were the book's total.
  assert.deepEqual(sumOf([1, null, 3]), { total: 4, seen: 2, of: 3 });
  // No inputs at all is the dash, never a 0 built of unknowns.
  assert.deepEqual(sumOf([null, null]), { total: null, seen: 0, of: 2 });
  assert.deepEqual(sumOf([]), { total: null, seen: 0, of: 0 });
  // A real zero is a reading and contributes to the coverage count.
  assert.deepEqual(sumOf([0, null]), { total: 0, seen: 1, of: 2 });
  // Negatives are ordinary: an unrealised book can be under water.
  assert.deepEqual(sumOf([-5, 2]), { total: -3, seen: 2, of: 2 });
});

test("maintenanceShare: a percentage needs both figures and a positive denominator", () => {
  // Live 7d #1: 16,832,367.54 required against 108.44M of equity.
  const share = maintenanceShare(16_832_367.54, 108_440_000);
  assert.ok(share !== null && Math.abs(share - 15.52) < 0.01, `got ${share}`);
  assert.equal(maintenanceShare(null, 100), null);
  assert.equal(maintenanceShare(10, null), null);
  // A ratio of a zero account is not a percentage, and 0% would read as "nothing at
  // risk" over an account that has no equity left at all.
  assert.equal(maintenanceShare(10, 0), null);
  assert.equal(maintenanceShare(10, -5), null);
  // A genuine zero requirement against real equity IS a reading.
  assert.equal(maintenanceShare(0, 100), 0);
});
