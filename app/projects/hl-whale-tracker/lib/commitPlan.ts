import type { SortField } from "./types";
import type { WhaleUrlState } from "./urlState";

// The commit engine's arithmetic. hooks/useCommit.ts drives the DOM; everything it
// needs to decide is decided here, from the two orders and the two control states,
// with no measurement — which is what lets a fifty-row commit run with zero forced
// layout. Row height is locked in CSS (.hl-board tbody tr), so travel is exact.
//
// The plan of record names three moments, and the KIND of change picks the moment:
//
//   sort-field      THE INVERSION. The same fifty addresses in a new order: every row
//                   travels, distance clamped, one uniform duration, and the board
//                   settles as one gesture. When the field is volume, the rows that
//                   traded nothing stack into one labelled block.
//   sort-direction  Not a travel. Reversing fifty rows carries zero information the
//                   reader did not already have; the header's chevron turns instead.
//   period          THE RE-SOUNDING. A different window is mostly different people —
//                   7D→30D holds 1 of 50 on the live board, 24H↔7D holds 38 — so the
//                   rows that leave dissolve as one ghost sheet at their old berths, the
//                   rows that stay glide to their new rank, and the rows that arrive
//                   seat top-down. Sequenced, never superimposed.
//
// Timings are the plan's own. 380 and 620 are stated there and stand; the pieces
// inside the re-sounding start and end on 100ms beats (ESCAPEMENT LAW 2) where the
// plan left them approximate.

/** One berth. .hl-board tbody tr is locked to this; the two must move together. */
export const ROW_H = 44;

/** Measured max travel is ~2100px, which an expo-out front-loads into a blur. Ten rows
 * keeps the gesture legible while still showing direction. */
export const MAX_TRAVEL_ROWS = 10;

/** The inversion: all travel, one duration, no stagger, so the board settles at once. */
export const INVERSION_MS = 380;

/** The re-sounding, end to end. The last arrival lands exactly here. */
export const RESOUNDING_MS = 620;

/** The ghost sheet's dissolve. Ease-in, so it is gone before the arrivals begin. */
export const GHOST_FADE_MS = 180;

/** Held rows glide for five beats; the plan's "~480" rounded onto the beat. */
export const HELD_TRAVEL_MS = 500;

/** Each arrival's own seat, after its delay. */
export const ARRIVAL_MS = 240;
const ARRIVAL_BASE_MS = 140;
const ARRIVAL_STEP_MS = 8;
const ARRIVAL_STAGGER_CAP_MS = 240;

export type ChangeKind = "period" | "sort-field" | "sort-direction";

/**
 * What the last control change was, and a sequence number so the same kind twice in a
 * row is still two commits. The engine consumes a commit by its `seq`: an order change
 * that arrives with the seq it has already seen is a refresh — the odometers roll the
 * changed digits and nothing travels.
 */
export interface BoardChange {
  kind: ChangeKind | null;
  seq: number;
}

export const NO_CHANGE: BoardChange = { kind: null, seq: 0 };

type Controls = Pick<WhaleUrlState, "period" | "sort" | "dir">;

/**
 * The kind of change between two control states, or null when nothing the board sorts
 * by moved (a tab or a trader). Derived from the URL state rather than recorded at the
 * click, so Back and Forward — which never pass through a handler — get the same
 * moment a click would.
 *
 * Priority when several move at once (Back can revert the window and the sort in one
 * step; a field change resets the direction with it): the bigger change names it.
 */
export function changeKind(prev: Controls, next: Controls): ChangeKind | null {
  if (prev.period !== next.period) return "period";
  if (prev.sort !== next.sort) return "sort-field";
  if (prev.dir !== next.dir) return "sort-direction";
  return null;
}

/**
 * Where a held row starts, relative to its new berth, in px. Positive is below: a row
 * climbing from berth 10 to berth 3 begins 7 × ROW_H low and travels up to zero.
 */
export function travelPx(fromIndex: number, toIndex: number): number {
  const rows = fromIndex - toIndex;
  const capped = Math.min(Math.abs(rows), MAX_TRAVEL_ROWS);
  return Math.sign(rows) * capped * ROW_H;
}

/** Arrivals seat top-down: 140ms + min(rank × 8ms, 240ms), rank being the 1-based berth. */
export function arrivalDelayMs(rank: number): number {
  return ARRIVAL_BASE_MS + Math.min(rank * ARRIVAL_STEP_MS, ARRIVAL_STAGGER_CAP_MS);
}

// Three of the fields below are the PLAN's vocabulary rather than the engine's input:
// `HeldRow.to`, `ArrivedRow.to` and `DepartedRow.from` are computed and no consumer reads
// them. They are kept, and said so here, because the plan is a value the tests assert
// whole (tests/commitPlan.test.ts) — a berth pair reads as a move, where `dy` alone reads
// as a number — and because dropping a field from a tested pure module to save three
// integers per row is not a trade worth making. What was wrong was the DOC: it named a
// consumer for one of them that has never existed.
export interface HeldRow {
  key: string;
  /** The berth it held in the OLD order. The one index the engine does read: the ghost
   * sheet hides these rows in the clone, because a held row travels as itself. */
  from: number;
  /** Its berth in the NEW order. Descriptive — the array is already in that order. */
  to: number;
  /** travelPx(from, to). Zero for a row that did not move; the engine skips it, the
   * ghost still hides it. */
  dy: number;
}

export interface DepartedRow {
  key: string;
  /** The berth it leaves from. Descriptive: the ghost sheet keeps a departure visible by
   * NOT hiding it — it hides the held rows by index and leaves the rest alone — so
   * nothing reads this. The doc used to claim the sheet used it. */
  from: number;
}

export interface ArrivedRow {
  key: string;
  /** Its berth in the NEW order. Descriptive; `delayMs` is what the engine uses. */
  to: number;
  delayMs: number;
}

export interface CommitPlan {
  /** In the NEW order, so the engine walks the board top-down. */
  held: HeldRow[];
  /** In the OLD order. */
  departed: DepartedRow[];
  /** In the NEW order. */
  arrived: ArrivedRow[];
}

/**
 * Classify every address across the two orders. Pure; the engine decides per kind what
 * each list gets (the inversion has only `held`, a refresh gets nothing at all).
 */
export function planCommit(prev: readonly string[], next: readonly string[]): CommitPlan {
  const prevIndex = new Map(prev.map((key, i) => [key, i]));
  const nextIndex = new Map(next.map((key, i) => [key, i]));

  const held: HeldRow[] = [];
  const arrived: ArrivedRow[] = [];
  next.forEach((key, to) => {
    const from = prevIndex.get(key);
    if (from === undefined) arrived.push({ key, to, delayMs: arrivalDelayMs(to + 1) });
    else held.push({ key, from, to, dy: travelPx(from, to) });
  });

  const departed: DepartedRow[] = [];
  prev.forEach((key, from) => {
    if (!nextIndex.has(key)) departed.push({ key, from });
  });

  return { held, departed, arrived };
}

export interface ZeroBlock {
  /** Index of the first zero-volume row in display order. */
  start: number;
  count: number;
  /** Rows under the block. The overlay is anchored to the table's BOTTOM edge, because
   * the tbody ends where the table ends and the thead's height is then never needed. */
  below: number;
}

/**
 * The rows that traded exactly nothing, as one span. Only the volume sort puts them
 * together (they tie at 0.00 and the PnL tiebreak keeps the tie contiguous); under any
 * other field they are scattered and there is no block to label.
 */
export function zeroBlock(
  rows: readonly { volume: number }[],
  sort: SortField
): ZeroBlock | null {
  if (sort !== "volume") return null;
  const start = rows.findIndex((r) => r.volume === 0);
  if (start === -1) return null;
  let count = 0;
  for (const r of rows) if (r.volume === 0) count++;
  return { start, count, below: rows.length - start - count };
}
