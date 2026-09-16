import type { SortDirection, SortField, TimePeriod } from "./types";
import type { Tab } from "../components/TabNavigation";
import { ADDRESS_RE } from "./trader";

// The whale tracker's five controls, as a query string.
//
// They used to be four plain useStates, so a reload, a shared link or the phone's
// Back gesture out of Positions lost the window, the sort and the trader — and Back
// left the site entirely, because nothing had ever pushed a history entry. Putting
// them in the URL makes the page linkable; putting the READER here makes the
// fallbacks testable without a router.
//
// Everything in this file is pure. The hook that writes the query is
// hooks/useTableControls.ts.

/**
 * Structural stand-in for URLSearchParams, so the reader accepts Next's
 * ReadonlyURLSearchParams (which is not assignable to URLSearchParams) without
 * importing anything from next/navigation into a module the tests run in Node.
 */
interface ParamReader {
  get(name: string): string | null;
}

export interface WhaleUrlState {
  tab: Tab;
  /** Lowercased 40-hex address, or null for "no berth selected". */
  trader: string | null;
  period: TimePeriod;
  sort: SortField;
  dir: SortDirection;
}

const TABS: readonly Tab[] = ["leaderboard", "positions", "trades", "analytics"];
const PERIODS: readonly TimePeriod[] = ["1d", "7d", "30d", "allTime"];
const DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

// types.ts:49 keeps the upstream field name `winRate` with the note "Actually ROI from
// API"; renaming it touches nine files and the public /api/hl-leaderboard response
// shape (whale-plan-5 rules that out of a copy change). A query string is copy-pasted
// and read aloud, so it carries the word every column header, the analytics panel and
// the meta description use, and the alias lives here instead.
const SORT_PARAM: Record<SortField, string> = {
  pnl: "pnl",
  winRate: "roi",
  volume: "volume",
};
const SORT_FIELD: Record<string, SortField> = {
  pnl: "pnl",
  roi: "winRate",
  // Accepted, never written: a link built from the internal name still works.
  winrate: "winRate",
  volume: "volume",
};

export const DEFAULT_WHALE_STATE: WhaleUrlState = {
  tab: "leaderboard",
  trader: null,
  period: "7d",
  sort: "pnl",
  dir: "desc",
};

/**
 * Case-insensitive match against a closed set. A URL that has been through a chat
 * client, a QR code or a capitalising keyboard still names a real window, and
 * silently resetting it to the default would look like a bug rather than a link.
 */
function oneOf<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  if (raw === null) return fallback;
  const lowered = raw.toLowerCase();
  return allowed.find((value) => value.toLowerCase() === lowered) ?? fallback;
}

/**
 * Reads the five controls out of a query string. Each value falls back on its own:
 * a mistyped `tab` must not also cost the `window` that came with it in the link.
 */
export function readWhaleState(params: ParamReader): WhaleUrlState {
  const rawSort = params.get("sort");
  const rawTrader = params.get("trader");

  return {
    tab: oneOf(params.get("tab"), TABS, DEFAULT_WHALE_STATE.tab),
    // ADDRESS_RE is the gate the trader route already applies to this exact value,
    // so a link the API would 400 on never reaches the page as a selection.
    // Lowercased because LeaderboardTable compares `trader.address ===
    // selectedAddress` and upstream's ethAddress is lowercase — an EIP-55
    // checksummed address in a shared link would otherwise load the right book and
    // highlight no row.
    trader:
      rawTrader !== null && ADDRESS_RE.test(rawTrader)
        ? rawTrader.toLowerCase()
        : null,
    period: oneOf(params.get("window"), PERIODS, DEFAULT_WHALE_STATE.period),
    sort:
      rawSort === null
        ? DEFAULT_WHALE_STATE.sort
        : SORT_FIELD[rawSort.toLowerCase()] ?? DEFAULT_WHALE_STATE.sort,
    dir: oneOf(params.get("dir"), DIRECTIONS, DEFAULT_WHALE_STATE.dir),
  };
}

/**
 * The inverse: the shortest query string that reads back as this state.
 *
 * Defaults are omitted so the board's own state is the bare /projects/hl-whale-tracker,
 * and the key order is fixed so an unchanged state always produces a byte-identical
 * string — two spellings of one state would let `router.replace` churn history.
 */
export function whaleQuery(state: WhaleUrlState): string {
  const query = new URLSearchParams();
  if (state.tab !== DEFAULT_WHALE_STATE.tab) query.set("tab", state.tab);
  // Not conditional on the tab: switching back to the board keeps the row
  // highlighted, and a reload there keeps the selection.
  if (state.trader !== null) query.set("trader", state.trader);
  if (state.period !== DEFAULT_WHALE_STATE.period) query.set("window", state.period);
  if (state.sort !== DEFAULT_WHALE_STATE.sort) query.set("sort", SORT_PARAM[state.sort]);
  if (state.dir !== DEFAULT_WHALE_STATE.dir) query.set("dir", state.dir);
  return query.toString();
}

// ── Writes in flight ──────────────────────────────────────────────────────────
//
// useTableControls composes every write from a base, and `useSearchParams` does not
// report a write back until the router transition lands. The hook used to reset the
// base to the URL's reading whenever the params changed — including when an EARLIER
// write's params landed. Three writes in quick succession then went: write1, write2,
// (write1 lands → base regresses to write1), write3 composed from the stale base — and
// write2's change was gone from the URL for good. The three functions below are the
// pure half of the fix, so tests/urlState.test.ts can replay that exact sequence: the
// hook keeps the queue of states it has WRITTEN and composes from the newest until the
// URL reflects it.

/** Field-by-field equality of the five controls. */
export function sameWhaleState(a: WhaleUrlState, b: WhaleUrlState): boolean {
  return (
    a.tab === b.tab &&
    a.trader === b.trader &&
    a.period === b.period &&
    a.sort === b.sort &&
    a.dir === b.dir
  );
}

/** A write: the whole state, from a base and the fields the control changed. Every
 * write has to carry the WHOLE state — a partial one would drop the other controls. */
export function composeWrite(
  base: WhaleUrlState,
  patch: Partial<WhaleUrlState>
): WhaleUrlState {
  return { ...base, ...patch };
}

/**
 * The queue after the URL reports `landed`.
 *
 * A landing that matches a written state settles it and everything written before it
 * (the router applies writes in order, so an older one cannot still be in flight behind
 * a newer one that has arrived). A landing that matches NONE of them is a navigation we
 * did not cause — Back, Forward, a deep link — and the queue is stale: the URL's reading
 * is then the only honest base, so the queue is cleared.
 */
export function settlePending(
  pending: readonly WhaleUrlState[],
  landed: WhaleUrlState
): WhaleUrlState[] {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (sameWhaleState(pending[i], landed)) return pending.slice(i + 1);
  }
  return [];
}
