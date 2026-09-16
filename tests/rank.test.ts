import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PREVIOUS_WINDOW,
  rankByPnl,
  rankDelta,
  withCanonicalRank,
} from "../app/projects/hl-whale-tracker/lib/rank";
import type { TraderMetrics } from "../app/projects/hl-whale-tracker/lib/types";

// The berth plate used to print `index + 1` of the CURRENT sort, so sorting by ROI
// renumbered the top-ROI trader "01" — erasing the inversion the board exists to show
// (live 7D: the ROI leader sits at PnL rank 35). canonicalRank is the rank in the
// window's PnL order and nothing else; the delta plate compares that rank against the
// same trader's rank in the next-shorter window. Both are pure so they are testable
// without a fetch, and both read the SAME PnL order so they cannot disagree.

const row = (address: string, pnl: number, extra: Partial<TraderMetrics> = {}): TraderMetrics => ({
  address,
  pnl,
  winRate: 0,
  volume: 0,
  accountValue: 0,
  lastUpdated: 0,
  ...extra,
});

test("rankByPnl: rank is the position in PnL-descending order, 1-based", () => {
  const ranks = rankByPnl([row("0xa", 10), row("0xb", 30), row("0xc", 20)]);
  assert.equal(ranks.get("0xb"), 1);
  assert.equal(ranks.get("0xc"), 2);
  assert.equal(ranks.get("0xa"), 3);
});

test("rankByPnl: the input order is irrelevant — a sorted view of the same rows ranks identically", () => {
  const rows = [row("0xa", 10, { winRate: 900 }), row("0xb", 30, { winRate: 1 }), row("0xc", 20, { winRate: 50 })];
  const byRoi = [...rows].sort((a, b) => b.winRate - a.winRate);
  assert.deepEqual([...rankByPnl(byRoi)], [...rankByPnl(rows)]);
});

test("rankByPnl: equal PnL keeps arrival order, matching sortRows' stable tiebreak", () => {
  // mapAllPeriods sorts by pnl desc and slices to 50, so arrival order IS the upstream
  // tiebreak. Re-sorting must not shuffle ties or the plate would disagree with the
  // row's position on the default PnL-desc board.
  const ranks = rankByPnl([row("0xa", 5), row("0xb", 5), row("0xc", 5)]);
  assert.equal(ranks.get("0xa"), 1);
  assert.equal(ranks.get("0xb"), 2);
  assert.equal(ranks.get("0xc"), 3);
});

test("rankByPnl: an empty board has no ranks", () => {
  assert.equal(rankByPnl([]).size, 0);
});

test("withCanonicalRank: annotates every row and preserves the caller's order", () => {
  const rows = [row("0xa", 10), row("0xb", 30), row("0xc", 20)];
  const ranked = withCanonicalRank(rows);
  assert.deepEqual(
    ranked.map((r) => [r.address, r.canonicalRank]),
    [["0xa", 3], ["0xb", 1], ["0xc", 2]]
  );
  // A new array of new objects: the hook caches on the input's identity, and mutating
  // the fetched rows in place would write a rank into useLeaderboard's state.
  assert.notEqual(ranked, rows);
  assert.equal("canonicalRank" in rows[0], false);
});

test("withCanonicalRank: the plate equals the position when the board is PnL-descending", () => {
  const rows = [row("0xb", 30), row("0xc", 20), row("0xa", 10)];
  withCanonicalRank(rows).forEach((r, i) => assert.equal(r.canonicalRank, i + 1));
});

test("rankDelta: positive means the trader climbed, negative means it fell", () => {
  const previous = new Map([["0xa", 10], ["0xb", 2]]);
  const current = new Map([["0xa", 3], ["0xb", 7]]);
  // 10 → 3 is seven berths UP the board.
  assert.equal(rankDelta(current, previous, "0xa"), 7);
  // 2 → 7 is five berths DOWN.
  assert.equal(rankDelta(current, previous, "0xb"), -5);
});

test("rankDelta: the same berth in both windows is a real zero", () => {
  const same = new Map([["0xa", 4]]);
  assert.equal(rankDelta(same, same, "0xa"), 0);
});

test("rankDelta: a trader absent from the previous board is unknown, not zero", () => {
  // The previous window's payload is a top-50; a trader outside it has SOME rank we
  // never saw. null is the "unknown" the row renders as a legend, and it must never
  // collapse into the middle dot that means "did not move".
  const current = new Map([["0xa", 1]]);
  assert.equal(rankDelta(current, new Map(), "0xa"), null);
});

test("rankDelta: a trader missing from the CURRENT map is a caller bug and also unknown", () => {
  assert.equal(rankDelta(new Map(), new Map([["0xa", 1]]), "0xa"), null);
});

test("PREVIOUS_WINDOW: each window compares against the next-shorter one; 24H has none", () => {
  assert.equal(PREVIOUS_WINDOW["1d"], null);
  assert.equal(PREVIOUS_WINDOW["7d"], "1d");
  assert.equal(PREVIOUS_WINDOW["30d"], "7d");
  assert.equal(PREVIOUS_WINDOW.allTime, "30d");
});
