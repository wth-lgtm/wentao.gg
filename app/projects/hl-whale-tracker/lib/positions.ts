import type { PerpPosition } from "./trader";

// The Positions tab's arithmetic, lifted out of the component that owned it.
//
// These four were component-local helpers inside PositionsPanel.tsx — pure functions
// with no test, in a file no test can load — so the two facts that matter most about
// them held only by comment: that a figure upstream did not send never becomes a 0,
// and that a position with no notional never sorts as though it were worth nothing.
// tests/positions.test.ts pins both.

/** Largest notional first, unknown value last. Upstream order is asset-index order
 * and carries no meaning to a reader — it is why a $0.35 SUI residue sat between INJ
 * at $1.63M and XRP at $19.6M. Sort is stable, so equal values keep upstream order. */
export function byValueDesc(a: PerpPosition, b: PerpPosition): number {
  if (a.positionValue === b.positionValue) return 0;
  if (a.positionValue === null) return 1;
  if (b.positionValue === null) return -1;
  return b.positionValue - a.positionValue;
}

/**
 * The gate is ABSOLUTE and stays that way.
 *
 * A relative gate (`positionValue < totalNtlPos * 0.0001`) was probed against live
 * accounts and collapses real trades: eight positions of $1.3K–$12K for 0x45d26f28,
 * eight more for 0x7fdafde5, a $21,070 ASTER position for 0xb83de012. The residues
 * this is for measured $0.01, $0.35, $3, $18 and $22, so ten dollars catches the
 * garbage without hiding anybody's trade.
 */
export const DUST_USD = 10;

/** An UNPRICED position is never dust: "we could not price this" is not "this is
 * worth nothing", and folding it away would hide a holding with no figure. */
export const isDust = (p: PerpPosition) =>
  p.positionValue !== null && p.positionValue < DUST_USD;

/** A sum together with how much of the book it actually covers. */
export interface Aggregate {
  /** null when upstream gave none of the inputs: the dash, never a 0 built of unknowns. */
  total: number | null;
  /** Rows that contributed a figure. */
  seen: number;
  /** Rows that were asked for one. */
  of: number;
}

/**
 * Sum over the values upstream actually gave, and remember how many that was.
 *
 * Returning only the number was a quieter version of the same lie the dash exists to
 * prevent: a figure missing from ONE of twelve present rows is a case the data really
 * produces (tests/trader.test.ts pins that a missing figure inside a present row stays
 * null, never 0), and the header then printed a sum of eleven under a bare "Unrealised"
 * as though it were the book's total. The count travels with the total so the cell can
 * say "11 of 12".
 */
export function sumOf(values: (number | null)[]): Aggregate {
  let total = 0;
  let seen = 0;
  for (const v of values) {
    if (v !== null) {
      total += v;
      seen += 1;
    }
  }
  return { total: seen === 0 ? null : total, seen, of: values.length };
}

/** Maintenance margin as a share of equity: 100% is the liquidation line. Null unless
 * both figures are present AND equity is above zero — a ratio of a zero account is not
 * a percentage, and printing 0% there would read as "nothing at risk". */
export function maintenanceShare(
  required: number | null,
  equity: number | null
): number | null {
  if (required === null || equity === null || equity <= 0) return null;
  return (required / equity) * 100;
}
