// Aggregate reads across the whole board. Pure arithmetic — no I/O, no new request:
// the leaderboard hook already downloads all four windows in one call and this works
// over what is already in memory.
//
// What makes this tab worth building is that the four measurements below all point
// the same way, and it is not the way the leaderboard reads. A board sorted by PnL
// looks like a ranking of skill. Measured against the same payload it is closer to a
// ranking of capital: the address at #1 by PnL sits at #50 of 50 by return in three
// of the four windows, and rho(PnL, ROI) is NEGATIVE while rho(PnL, capital) is
// +0.73. So the honest job of this panel is to say what the board is actually
// sorting, not to decorate it.
//
// Nothing here fabricates a series. There is no time dimension in the payload — one
// snapshot per window, no history — so there are no sparklines and no trends. The
// concentration curve is a cumulative distribution over the fifty values that are
// genuinely present, which is a real shape, not an interpolation.

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

export function concentration(rows: TraderMetrics[]): Concentration {
  // Sorted on a COPY: these arrays come straight out of the hook's state, and
  // sorting in place would reorder the leaderboard's own render as a side effect.
  const pnls = rows.map((r) => r.pnl).sort((a, b) => b - a);
  const total = pnls.reduce((s, v) => s + v, 0);

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
  /** rho between PnL and return. Measured negative in three of four windows. */
  pnlVsRoi: number | null;
  /** rho between PnL and account size. */
  pnlVsCapital: number | null;
  pnlLeader: TraderMetrics | null;
  roiLeader: TraderMetrics | null;
  /** Where the PnL leader places when the same fifty are ranked by return. */
  pnlLeaderRoiRank: number | null;
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
    };
  }

  // `winRate` is ROI, already a percent — the field name is upstream's, and the
  // comment on TraderMetrics has said so since the type was written.
  const pnl = rows.map((r) => r.pnl);
  const roi = rows.map((r) => r.winRate);
  const capital = rows.map((r) => r.accountValue);

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
 * Measured: only 3 of 50 addresses appear in all four, and the 30d and allTime sets
 * share just 5. The leaderboard's own UI cannot show this — it renders one window at
 * a time — so the churn is invisible exactly where it matters most.
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
 * The addresses reporting exactly zero volume.
 *
 * They carry 74% of all PnL in the 7d and 30d windows, which is the most striking
 * number on this page — and the one most easily overstated. A zero here plausibly
 * means "upstream did not report volume for this address" rather than "this address
 * did not trade", so every label for it says REPORTED volume and the panel never
 * claims they profited without trading.
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
 * A correlation's strength in words, so the number is never the only carrier.
 *
 * Bands are Cohen's conventional ones FOR CORRELATION — 0.1 small, 0.3 medium,
 * 0.5 large. An earlier cut used 0.2/0.4/0.7, which called the measured
 * rho(PnL, ROI) of -0.35 "weak" and materially understated the finding.
 */
export function rhoLabel(rho: number | null): string {
  if (rho === null) return "—";
  const a = Math.abs(rho);
  if (a < 0.1) return "no relationship";
  const strength = a >= 0.5 ? "strong" : a >= 0.3 ? "moderate" : "weak";
  return `${strength} ${rho > 0 ? "positive" : "negative"}`;
}

/**
 * ROI as a percent, compacted. All-time returns reach 2,641,257%, which no fixed
 * format renders sanely alongside a 0.45%.
 */
export function formatRoi(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const a = Math.abs(pct);
  if (a >= 1_000_000) return `${(pct / 1_000_000).toFixed(1)}M%`;
  if (a >= 10_000) return `${(pct / 1_000).toFixed(0)}K%`;
  if (a >= 100) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(a >= 10 ? 1 : 2)}%`;
}

/** A share (0..1) as a percent, or an em dash when it could not be computed. */
export function formatShare(share: number | null, decimals = 0): string {
  return share === null ? "—" : `${(share * 100).toFixed(decimals)}%`;
}

/**
 * Build an SVG polyline for the concentration curve.
 *
 * Coordinates are clamped and non-finite values dropped, so a malformed row cannot
 * put arbitrary text into a `d` attribute.
 */
export function curvePath(curve: number[], width: number, height: number): string {
  if (curve.length === 0) return "";
  const pts: string[] = [];
  for (let i = 0; i < curve.length; i++) {
    const x = ratio(i, curve.length - 1 || 1);
    const y = curve[i];
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
