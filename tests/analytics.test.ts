import { test } from "node:test";
import assert from "node:assert/strict";

import {
  churnMatrix,
  concentration,
  curvePath,
  divergence,
  overlapKey,
  plural,
  rhoLabel,
  rhoNoiseFloor,
  spearman,
} from "../app/projects/hl-whale-tracker/lib/analytics";
import type { TraderMetrics } from "../app/projects/hl-whale-tracker/lib/types";

// The Analytics tab's arithmetic, pinned to the shapes the live board actually
// produces. Figures below were read off /api/hl-leaderboard on 2026-09-16
// (rowsSeen 45,091, n = 50 in all four windows): rho(PnL, return) runs -0.31 / -0.15
// / -0.23 / -0.01 and rho(PnL, capital) +0.74 / +0.75 / +0.67 / +0.35, the all-time
// PnL leader and return leader are the SAME address (0x4ec8fe22), and 40 of the 50
// rows in the 30-day window report zero perpetuals volume.
//
// Those two facts are why this file exists: the panel used to caption two identical
// cards "a different trader entirely", and it used to print "weak negative" for
// correlations that fifty ranks cannot distinguish from zero.

/** A board row with only the fields the analytics read. */
function row(address: string, pnl: number, roi = 0, capital = 1, volume = 1): TraderMetrics {
  return { address, pnl, winRate: roi, volume, accountValue: capital, lastUpdated: 0 };
}

test("spearman: ties take averaged ranks", () => {
  // Hand-computed: y ties at 7, so its ranks are 1, 2, 3.5, 3.5 over the last block
  // and r comes out 0.8208 exactly. The 1 - 6d²/n(n²-1) shortcut cannot produce this.
  const r = spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]);
  assert.ok(r !== null);
  assert.equal(r.toFixed(4), "0.8208");
});

test("spearman: a perfect inversion is exactly -1, not -1.0000000000000002", () => {
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
});

test("spearman: a variable with no variance correlates with nothing", () => {
  // Twelve to sixteen addresses per window report exactly zero volume, so a flat
  // input is a real case, not a hypothetical. null, never 0.5.
  assert.equal(spearman([1, 1, 1, 1], [1, 2, 3, 4]), null);
  assert.equal(spearman([1, 2, 3, 4], [7, 7, 7, 7]), null);
});

test("spearman: fewer than two pairs is not a correlation", () => {
  assert.equal(spearman([], []), null);
  assert.equal(spearman([1], [2]), null);
  // Ragged inputs use the shorter length, which is still n = 1 here.
  assert.equal(spearman([1], [2, 3, 4]), null);
});

test("rhoNoiseFloor: 2/sqrt(n), and a full 1 where n is too small to say anything", () => {
  assert.equal(rhoNoiseFloor(50).toFixed(4), "0.2828");
  assert.equal(rhoNoiseFloor(10).toFixed(4), "0.6325");
  // At n <= 4 every |rho| below 1 is reachable by chance, so the floor admits none.
  assert.equal(rhoNoiseFloor(4), 1);
  assert.equal(rhoNoiseFloor(0), 1);
});

test("rhoLabel: at n = 50 the floor is 0.28, so the live -0.15 and -0.23 get no direction", () => {
  // The two cells that read "WEAK NEGATIVE" on screen while t = -1.0 and -1.6.
  assert.equal(rhoLabel(-0.1462, 50), "within noise");
  assert.equal(rhoLabel(-0.2282, 50), "within noise");
  assert.equal(rhoLabel(-0.0062, 50), "within noise");
  // Just under and just over the floor: the sign appears only once it is earned.
  assert.equal(rhoLabel(0.28, 50), "within noise");
  assert.equal(rhoLabel(0.29, 50), "weak positive");
  // The four capital correlations and the 24H return correlation do clear it.
  assert.equal(rhoLabel(-0.3115, 50), "moderate negative");
  assert.equal(rhoLabel(0.3453, 50), "moderate positive");
  assert.equal(rhoLabel(0.751, 50), "strong positive");
  // The cells are white-space: nowrap on a 390px phone, so the label stays short.
  assert.ok(rhoLabel(0, 50).length <= 15);
});

test("rhoLabel: the floor scales with n — at n = 10 half a correlation is still noise", () => {
  assert.equal(rhoLabel(0.5, 10), "within noise");
  assert.equal(rhoLabel(-0.6, 10), "within noise");
  assert.equal(rhoLabel(0.7, 10), "strong positive");
  // n = 2 can only ever produce ±1, and that is not a finding either.
  assert.equal(rhoLabel(0.99, 2), "within noise");
});

test("rhoLabel: an uncomputable correlation is an em dash, not a zero", () => {
  assert.equal(rhoLabel(null, 50), "—");
  assert.equal(rhoLabel(null, 0), "—");
});

test("concentration: a Lorenz curve over positive PnL runs 0..1 and ends at 1", () => {
  const rows = [row("0xa", 40), row("0xb", 30), row("0xc", 20), row("0xd", 10)];
  const c = concentration(rows);
  assert.equal(c.total, 100);
  assert.equal(c.topShare, 0.4);
  assert.equal(c.top5Share, 1);
  assert.deepEqual(c.curve, [0.4, 0.7, 0.9, 1]);
});

test("concentration: one dominant address is a share, not a rounding artefact", () => {
  // The 30-day shape: one address at 94% of the window and a long flat tail.
  const rows = [row("0xa", 940), ...Array.from({ length: 49 }, (_, i) => row(`0x${i}`, 60 / 49))];
  const c = concentration(rows);
  assert.ok(c.topShare !== null);
  assert.equal(c.topShare.toFixed(3), "0.940");
  assert.equal(c.curve.length, 50);
  assert.equal(c.curve[0], c.topShare);
  assert.equal(c.curve[49].toFixed(6), "1.000000");
  // Monotone non-decreasing: a cumulative share that dipped would be a bug.
  for (let i = 1; i < c.curve.length; i++) assert.ok(c.curve[i] >= c.curve[i - 1]);
});

test("concentration: a negative PnL has no share of a net total, so nothing is claimed", () => {
  // [100, 50, -30, -20] nets to 100, which made the cumulative curve read
  // 1, 1.5, 1.3, 1 — every point clamped flat at the top of the box and topShare
  // printed "100%" for an address holding more than the whole board's profit.
  const c = concentration([row("0xa", 100), row("0xb", 50), row("0xc", -30), row("0xd", -20)]);
  assert.equal(c.total, 100);
  assert.equal(c.topShare, null);
  assert.equal(c.top5Share, null);
  assert.deepEqual(c.curve, []);
});

test("concentration: a zero total is still no curve at all", () => {
  const c = concentration([row("0xa", 50), row("0xb", -50)]);
  assert.equal(c.total, 0);
  assert.equal(c.topShare, null);
  assert.deepEqual(c.curve, []);
});

test("curvePath: a perfectly equal board traces the equality diagonal exactly", () => {
  // The curve holds the share AFTER each address, so plotting curve[0] at x = 0 put
  // the first point 1/n up the box: the gap the copy calls "the concentration" was
  // partly an artefact of the missing origin.
  const equal = [0.2, 0.4, 0.6, 0.8, 1];
  const d = curvePath(equal, 100, 40);
  assert.equal(d, "M0.00,40.00 L20.00,32.00 L40.00,24.00 L60.00,16.00 L80.00,8.00 L100.00,0.00");
});

test("curvePath: an empty curve draws nothing, and coordinates stay inside the box", () => {
  assert.equal(curvePath([], 100, 40), "");
  // A clamped-out value cannot put arbitrary text into a `d` attribute.
  const d = curvePath([2, Number.NaN, 1], 100, 40);
  assert.ok(/^M[-0-9., L]+$/.test(d));
  assert.ok(d.startsWith("M0.00,40.00"));
});

test("churnMatrix: overlap is symmetric and the diagonal is each window's own size", () => {
  const periods = {
    "1d": [row("0xa", 1), row("0xb", 1), row("0xc", 1)],
    "7d": [row("0xb", 1), row("0xc", 1), row("0xd", 1)],
    "30d": [row("0xc", 1), row("0xd", 1)],
  };
  const churn = churnMatrix(periods);
  assert.deepEqual(churn.present, ["1d", "7d", "30d"]);
  for (const a of churn.present) {
    for (const b of churn.present) {
      assert.equal(
        churn.overlap[overlapKey(a, b)],
        churn.overlap[overlapKey(b, a)],
        `${a} vs ${b} is not symmetric`
      );
    }
  }
  assert.equal(churn.overlap[overlapKey("1d", "1d")], 3);
  assert.equal(churn.overlap[overlapKey("30d", "30d")], 2);
  assert.equal(churn.overlap[overlapKey("1d", "7d")], 2);
  assert.equal(churn.overlap[overlapKey("1d", "30d")], 1);
  assert.deepEqual(churn.persistent, ["0xc"]);
});

test("churnMatrix: a window that never arrived is not a row of zeroes", () => {
  const churn = churnMatrix({ "1d": [row("0xa", 1)], "7d": [] });
  assert.deepEqual(churn.present, ["1d"]);
  assert.equal(churn.overlap[overlapKey("1d", "7d")], undefined);
  assert.deepEqual(churn.persistent, ["0xa"]);
});

test("divergence: roiLeaderPnlRank places the return leader on the PnL ranking", () => {
  // The return leader is the SMALLEST PnL here, so it is last by PnL.
  const rows = [row("0xa", 100, 5), row("0xb", 50, 10), row("0xc", 10, 900)];
  const d = divergence("7d", rows);
  assert.equal(d.pnlLeader?.address, "0xa");
  assert.equal(d.roiLeader?.address, "0xc");
  assert.equal(d.roiLeaderPnlRank, 3);
  assert.equal(d.pnlLeaderRoiRank, 3);
  assert.equal(d.count, 3);
});

test("divergence: when one address leads both, each rank is #1 and the panel must not say otherwise", () => {
  // The live all-time window: pnlLeader === roiLeader === 0x4ec8fe22.
  const rows = [row("0x4ec8fe22", 100, 900), row("0xb", 50, 10), row("0xc", 10, 5)];
  const d = divergence("allTime", rows);
  assert.equal(d.pnlLeader?.address, d.roiLeader?.address);
  assert.equal(d.roiLeaderPnlRank, 1);
  assert.equal(d.pnlLeaderRoiRank, 1);
});

test("divergence: an empty window ranks nobody", () => {
  const d = divergence("1d", []);
  assert.equal(d.count, 0);
  assert.equal(d.pnlLeader, null);
  assert.equal(d.roiLeader, null);
  assert.equal(d.pnlLeaderRoiRank, null);
  assert.equal(d.roiLeaderPnlRank, null);
});

test("plural: the panel printed 'Only 1 addresses hold a place in every window'", () => {
  assert.equal(plural(1, "address holds", "addresses hold"), "1 address holds");
  assert.equal(plural(0, "address holds", "addresses hold"), "0 addresses hold");
  assert.equal(plural(18, "address holds", "addresses hold"), "18 addresses hold");
});
