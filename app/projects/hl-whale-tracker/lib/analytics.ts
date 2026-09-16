// Aggregate reads across the whole board. Pure arithmetic — no I/O, no new request:
// the leaderboard hook already downloads all four windows in one call and this works
// over what is already in memory.
//
// What makes this tab worth building is that a board sorted by PnL reads as a ranking
// of skill, and measuring the same payload says it is closer to a ranking of capital:
// rho(PnL, capital) clears the noise floor in every window while rho(PnL, return)
// mostly does not, and the address at #1 by PnL is rarely near the top by return.
// (Measured 2026-09-16: capital +0.74 / +0.75 / +0.67 / +0.35, return -0.31 / -0.15 /
// -0.23 / -0.01, leader's return rank #21 / #26 / #50 / #1.) Those figures move every
// refresh, which is why nothing in the panel hard-codes one of them any more — the
// honest job here is to say what the board is sorting TODAY, not to decorate it.
//
// Nothing here fabricates a series. There is no time dimension in the payload — one
// snapshot per window, no history — so there are no sparklines and no trends. The
// concentration curve is a cumulative distribution over the fifty values that are
// genuinely present, which is a real shape, not an interpolation.

import { formatPercent } from "./formatters";
import { TimePeriod, TraderMetrics } from "./types";

export const WINDOWS: TimePeriod[] = ["1d", "7d", "30d", "allTime"];

export const WINDOW_LABEL: Record<TimePeriod, string> = {
  "1d": "24H",
  "7d": "7D",
  "30d": "30D",
  allTime: "ALL",
};

export type Periods = Partial<Record<TimePeriod, TraderMetrics[]>>;

/** Ratio guarded against a zero or non-finite denominator. */
function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

export interface Concentration {
  /**
   * The arithmetic sum of the window's PnL, and a NET one — it is returned unchanged
   * on the branch that refuses every share, so it is the one field here whose meaning
   * does not depend on the others being readable. That makes it a reading and NOT a
   * denominator: when a row is negative the shares below are null precisely because
   * dividing by this total produces figures over 100%, so anything derived from it
   * would be the number the null is there to withhold. No consumer reads it today and
   * that is the reason to say so here rather than after one does.
   */
  total: number;
  /** Share of the window's total PnL held by the single largest address. */
  topShare: number | null;
  top5Share: number | null;
  /**
   * Cumulative share of total PnL after each address, largest first — a Lorenz
   * curve read from the top down. Values run 0..1 and the last entry is 1.
   */
  curve: number[];
}

/**
 * How much of a window's profit sits in how few addresses.
 *
 * Shares are only computed when every row is a gain. A cumulative share of a NET
 * total is not a share: [100, 50, -30, -20] nets to 100, so the running curve read
 * 1, 1.5, 1.3, 1 — clamped flat along the top of the chart — and topShare printed
 * "100%" for an address holding more than the whole board's profit. No live top-fifty
 * row is negative today (checked in all four windows), so rather than silently
 * redefine the denominator this returns nothing and the panel prints its em dash,
 * which is the same thing it already does for a zero total.
 */
export function concentration(rows: TraderMetrics[]): Concentration {
  // Sorted on a COPY: these arrays come straight out of the hook's state, and
  // sorting in place would reorder the leaderboard's own render as a side effect.
  const pnls = rows.map((r) => r.pnl).sort((a, b) => b - a);
  const total = pnls.reduce((s, v) => s + v, 0);

  if (pnls.some((v) => v < 0)) {
    return { total, topShare: null, top5Share: null, curve: [] };
  }

  const curve: number[] = [];
  let running = 0;
  for (const v of pnls) {
    running += v;
    const share = ratio(running, total);
    // A null share means the total is zero, in which case a cumulative curve has no
    // meaning at all — better an empty curve the UI can skip than a line of NaNs.
    if (share === null) {
      curve.length = 0;
      break;
    }
    curve.push(share);
  }

  return {
    total,
    topShare: pnls.length > 0 ? ratio(pnls[0], total) : null,
    top5Share: pnls.length > 0 ? ratio(pnls.slice(0, 5).reduce((s, v) => s + v, 0), total) : null,
    curve,
  };
}

/**
 * Spearman rank correlation — Pearson's r computed over averaged ranks.
 *
 * Deliberately NOT the 1 - 6*d²/(n(n²-1)) shortcut. That form is only valid when
 * there are no ties, and this data ties: twelve to sixteen addresses per window
 * report exactly zero volume, and account values repeat. Fed a variable with no
 * variance at all the shortcut returns 0.5 for a correlation that is genuinely
 * undefined, which is worse than returning nothing.
 *
 * Ties take averaged ranks, so a tied block cannot have a correlation manufactured
 * out of whatever order upstream happened to send it in. Zero variance in either
 * input yields null, because a flat variable correlates with nothing.
 */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  const rx = averagedRanks(xs.slice(0, n));
  const ry = averagedRanks(ys.slice(0, n));

  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx;
    const dy = ry[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }

  const denom = Math.sqrt(vx * vy);
  const r = ratio(cov, denom);
  // Clamped because accumulated floating-point error can push a perfect
  // correlation a hair past ±1.
  return r === null ? null : clamp(r, -1, 1);
}

function averagedRanks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    // Mean of the 1-based positions this tied block occupies.
    const mean = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = mean;
    i = j + 1;
  }
  return ranks;
}

/** Where one address sits in a ranking by some field, 1-based. */
function rankBy(
  rows: TraderMetrics[],
  address: string,
  field: (r: TraderMetrics) => number
): number | null {
  const sorted = [...rows].sort((a, b) => field(b) - field(a));
  const idx = sorted.findIndex((r) => r.address === address);
  return idx === -1 ? null : idx + 1;
}

export interface Divergence {
  window: TimePeriod;
  count: number;
  /** rho between PnL and return. Negative in most windows, rarely by enough to say so. */
  pnlVsRoi: number | null;
  /** rho between PnL and account size. */
  pnlVsCapital: number | null;
  pnlLeader: TraderMetrics | null;
  roiLeader: TraderMetrics | null;
  /** Where the PnL leader places when the same rows are ranked by return. */
  pnlLeaderRoiRank: number | null;
  /** Where the return leader places when the same rows are ranked by PnL. */
  roiLeaderPnlRank: number | null;
}

export function divergence(window: TimePeriod, rows: TraderMetrics[]): Divergence {
  if (rows.length === 0) {
    return {
      window,
      count: 0,
      pnlVsRoi: null,
      pnlVsCapital: null,
      pnlLeader: null,
      roiLeader: null,
      pnlLeaderRoiRank: null,
      roiLeaderPnlRank: null,
    };
  }

  // `winRate` is ROI, already a percent — the field name is upstream's, and the
  // comment on TraderMetrics has said so since the type was written.
  const pnl = rows.map((r) => r.pnl);
  const roi = rows.map((r) => r.winRate);
  const capital = rows.map((r) => r.accountValue);

  // Two independent reduces over the same rows, so nothing stops them landing on one
  // address — in the live all-time window they do (0x4ec8fe22, #1 by both). The panel
  // needs the return leader's PnL rank to tell the two cases apart without guessing.
  const pnlLeader = rows.reduce((a, b) => (b.pnl > a.pnl ? b : a));
  const roiLeader = rows.reduce((a, b) => (b.winRate > a.winRate ? b : a));

  return {
    window,
    count: rows.length,
    pnlVsRoi: spearman(pnl, roi),
    pnlVsCapital: spearman(pnl, capital),
    pnlLeader,
    roiLeader,
    pnlLeaderRoiRank: rankBy(rows, pnlLeader.address, (r) => r.winRate),
    roiLeaderPnlRank: rankBy(rows, roiLeader.address, (r) => r.pnl),
  };
}

export interface Churn {
  /** Overlap counts between every pair of windows, keyed "1d|7d". */
  overlap: Record<string, number>;
  /** Addresses present in every window that has data. */
  persistent: string[];
  /** Windows that actually arrived — the matrix must not claim rows it lacks. */
  present: TimePeriod[];
}

export const overlapKey = (a: TimePeriod, b: TimePeriod) => `${a}|${b}`;

/**
 * How much the top fifty is the same fifty across windows.
 *
 * The overlap is small and it moves (measured 2026-09-16: 1 address in all four
 * windows, 18 shared between 30d and allTime). The leaderboard's own UI cannot show
 * this — it renders one window at a time — so the churn is invisible exactly where it
 * matters most, and the panel must read the counts off this rather than repeat them.
 */
export function churnMatrix(periods: Periods): Churn {
  const present = WINDOWS.filter((w) => (periods[w]?.length ?? 0) > 0);
  const sets = new Map<TimePeriod, Set<string>>(
    present.map((w) => [w, new Set((periods[w] ?? []).map((r) => r.address))])
  );

  const overlap: Record<string, number> = {};
  for (const a of present) {
    for (const b of present) {
      const sa = sets.get(a)!;
      const sb = sets.get(b)!;
      let n = 0;
      for (const addr of sa) if (sb.has(addr)) n++;
      overlap[overlapKey(a, b)] = n;
    }
  }

  let persistent: string[] = [];
  if (present.length > 0) {
    const [first, ...rest] = present;
    persistent = [...sets.get(first)!].filter((addr) =>
      rest.every((w) => sets.get(w)!.has(addr))
    );
  }

  return { overlap, persistent, present };
}

export interface Cohort {
  count: number;
  pnl: number;
  /** Share of the window's total PnL this cohort accounts for. */
  share: number | null;
}

/**
 * The addresses with exactly zero perpetuals volume.
 *
 * This is the most striking number on the page (measured 2026-09-16: 40 of the 50
 * 30-day rows, carrying 94% of that window's profit) and the one that was most
 * overstated. The panel used to hedge that a zero was "as likely" to mean upstream
 * published no figure — it is not: `vlm` is present on every window entry of the raw
 * leaderboard (0 missing across 180,340 entries) and mapRow in hyperliquid.ts now
 * DROPS a row whose vlm cannot be read rather than zero-filling it, so a zero that
 * reaches here was published as a zero.
 *
 * What the zeroes are is spot holders. `vlm` is perpetuals volume while PnL and
 * accountValue mark spot holdings to market, so an address can post a large PnL in a
 * window without a perp trade. Probed 2026-09-16 via /api/hl-trader: 0x0d446c33 (capital
 * $68.7M) has 0 perp positions, 0 fills, vlm 0.0 in every window and 99,000,088 TREND
 * in spot; 0xa822a9ce (30-day PnL +$812M, capital $14.8B) has 0 fills and 499M USOL
 * plus 894M UFART in spot.
 */
export function zeroVolumeCohort(rows: TraderMetrics[]): Cohort {
  const total = rows.reduce((s, r) => s + r.pnl, 0);
  const zero = rows.filter((r) => r.volume === 0);
  const pnl = zero.reduce((s, r) => s + r.pnl, 0);
  return { count: zero.length, pnl, share: ratio(pnl, total) };
}

/** Median of a numeric list, on a copy. Null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * The |rho| below which a sample of n ranks says nothing about direction.
 *
 * 2/sqrt(n) is the standard approximation of the 95% critical value: 0.283 at n = 50
 * against an exact 0.279, which is close enough that no t-table is needed. Below
 * n = 5 it exceeds 1, and that is the honest answer — four ranks can produce any
 * correlation at all, ±1 included.
 *
 * Infinity rather than 1, because the floor is tested with `<`: pinning it at 1 left
 * |rho| = 1 ABOVE the floor and labelled "strong", and ±1 is the only value n = 2 can
 * produce — the exact case the pin exists for.
 */
export function rhoNoiseFloor(n: number): number {
  return n > 4 ? 2 / Math.sqrt(n) : Number.POSITIVE_INFINITY;
}

/**
 * A correlation's strength in words, so the number is never the only carrier.
 *
 * Bands are Cohen's conventional ones FOR CORRELATION — 0.1 small, 0.3 medium,
 * 0.5 large. An earlier cut used 0.2/0.4/0.7, which called a measured rho of -0.35
 * "weak" and materially understated the finding.
 *
 * The bands only apply ABOVE the noise floor, which is why n is a parameter. Without
 * it this printed "weak negative" for the live -0.15 and -0.23 at n = 50, where fifty
 * ranks produce |rho| up to 0.28 by chance — a sign the sample cannot support, on the
 * one panel built to stop the board overclaiming. The wording is "within noise" and
 * not "indistinguishable from zero" because these cells are white-space: nowrap and
 * the table already overflows a 390px phone; and not "not significant" because the
 * fifty rows are selected on PnL out of 45,000, so a formal p-value would itself
 * overclaim.
 */
export function rhoLabel(rho: number | null, n: number): string {
  if (rho === null) return "—";
  const a = Math.abs(rho);
  if (a < rhoNoiseFloor(n)) return "within noise";
  const strength = a >= 0.5 ? "strong" : a >= 0.3 ? "moderate" : "weak";
  return `${strength} ${rho > 0 ? "positive" : "negative"}`;
}

/**
 * A count with the noun that agrees with it.
 *
 * The churn panel read "Only 1 addresses hold a place in every window" on the live
 * board, because the count is derived and the noun was not.
 */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * ROI as a percent, in the BOARD's compact form. All-time returns reach 2,641,257%,
 * which no fixed format renders sanely alongside a 0.45% — and this file used to carry
 * its own tiers for that, so the same ROI printed "44K%" here and "43626%" on the board
 * a tab away (whale-plan-2). One formatter now; the caller puts the exact figure in a
 * `title`, as LeaderboardRow and TraderCard do. Null and non-finite stay the em dash.
 */
export function formatRoi(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return formatPercent(pct, { compact: true });
}

/** A share (0..1) as a percent, or an em dash when it could not be computed. */
export function formatShare(share: number | null, decimals = 0): string {
  return share === null ? "—" : `${(share * 100).toFixed(decimals)}%`;
}

/**
 * Build an SVG polyline for the concentration curve.
 *
 * The series is prepended with the origin. `curve[i]` is the share held after i+1
 * addresses, so plotting curve[0] at x = 0 started the line at (0, topShare) and left
 * out (0, 0) — on five equal PnLs the path began 1/n up the box while the equality
 * diagonal it is read against began at the floor. Roughly 1/n of the gap the copy
 * calls "the concentration" was an artefact of the missing point.
 *
 * Coordinates are clamped and non-finite values dropped, so a malformed row cannot
 * put arbitrary text into a `d` attribute.
 */
export function curvePath(curve: number[], width: number, height: number): string {
  if (curve.length === 0) return "";
  const pts: string[] = [];
  const series = [0, ...curve];
  for (let i = 0; i < series.length; i++) {
    const x = ratio(i, series.length - 1 || 1);
    const y = series[i];
    if (x === null || !Number.isFinite(y)) continue;
    const px = clamp(x, 0, 1) * width;
    const py = height - clamp(y, 0, 1) * height;
    pts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
  }
  return pts.length === 0 ? "" : `M${pts.join(" L")}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
