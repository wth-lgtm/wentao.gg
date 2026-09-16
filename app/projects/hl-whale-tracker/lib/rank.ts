import type { TimePeriod, TraderMetrics } from "./types";

// The rank language of the board, second half. lib/tier.ts says how a rank is DRAWN;
// this file says what the number IS.
//
// The berth plate used to print `index + 1` of whatever sort was active, so sorting
// by ROI renumbered the top-ROI trader "01" — which erased the one thing the board is
// for. On the live 7D window the ROI leader sits at PnL rank 35; a plate that says 35
// at the top of the ROI sort is the reading, a plate that says 01 is noise.
//
// canonicalRank is therefore the rank in the window's PnL order and nothing else. It
// is computed once per window's rows and a sort never touches it; the row's POSITION
// is where the sort put it. The delta plate compares that rank with the same trader's
// rank in the next-shorter window, and reads the same PnL order, so the two cannot
// disagree about what "rank" means.
//
// Everything here is pure. hooks/useTableControls.ts attaches the rank; the table
// looks up the reference window.

export interface RankedTrader extends TraderMetrics {
  /** Rank in this window's PnL order, 1-based. Fixed per window; a sort never renumbers it. */
  canonicalRank: number;
}

/**
 * The window a delta plate compares against: the next-shorter one. 24H has no shorter
 * window, so its plate has no reference and renders nothing — not a zero.
 */
export const PREVIOUS_WINDOW: Record<TimePeriod, TimePeriod | null> = {
  "1d": null,
  "7d": "1d",
  "30d": "7d",
  allTime: "30d",
};

/**
 * PnL-descending, stable. mapAllPeriods already sorts and slices the upstream this way
 * (lib/hyperliquid.ts), so for rows straight off the fetch this is the identity — the
 * sort is here so a caller handing over an already re-sorted view gets the same answer.
 * Stability matters for ties: sortRows' PnL tiebreak is also stable, and if the two
 * disagreed on a tie the plate would not match the row's position on the default board.
 */
function pnlOrder<T extends TraderMetrics>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.pnl - a.pnl);
}

/** address → rank in this window's PnL order. The lookup the delta plate uses. */
export function rankByPnl(rows: readonly TraderMetrics[]): Map<string, number> {
  return new Map(pnlOrder(rows).map((row, i) => [row.address, i + 1]));
}

/**
 * The same rows, in the same order, each carrying its canonicalRank. New objects: the
 * input is useLeaderboard's state and must not be written to.
 */
export function withCanonicalRank(rows: readonly TraderMetrics[]): RankedTrader[] {
  const ranked = rows.map((row): RankedTrader => ({ ...row, canonicalRank: 0 }));
  // Assigned through the sorted view's object identity rather than an address lookup,
  // so a duplicated address in a payload cannot make two rows share one rank.
  pnlOrder(ranked).forEach((row, i) => {
    row.canonicalRank = i + 1;
  });
  return ranked;
}

/**
 * How many berths a trader moved between the reference window and this one. Positive
 * is UP the board (rank 10 → 3 is +7). `null` when either side has no rank for the
 * address: the reference payload is a top-50, so a trader outside it had SOME rank we
 * never saw, and that is an unknown — it must never collapse into the zero that means
 * "did not move".
 */
export function rankDelta(
  current: ReadonlyMap<string, number>,
  previous: ReadonlyMap<string, number>,
  address: string
): number | null {
  const now = current.get(address);
  const then = previous.get(address);
  if (now === undefined || then === undefined) return null;
  return then - now;
}
