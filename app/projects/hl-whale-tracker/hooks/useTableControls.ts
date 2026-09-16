"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TraderMetrics, SortField, TimePeriod } from "../lib/types";
import { readWhaleState, whaleQuery, type WhaleUrlState } from "../lib/urlState";
import { withCanonicalRank, type RankedTrader } from "../lib/rank";
import { changeKind, NO_CHANGE, type BoardChange } from "../lib/commitPlan";
import type { Tab, TabActivation } from "../components/TabNavigation";

// Was useSortAndFilter, then a bag of plain useStates. Renamed once already because it
// never filtered and used to TAKE the traders array — the page called it with a literal
// [] and re-implemented the sort inline and unmemoized.
//
// Now it owns the page's whole control state, and that state lives in the query string:
// a reload, a shared link and the phone's Back gesture out of Positions all used to
// lose the window, the sort and the trader, and Back left the site entirely because
// nothing had pushed a history entry.
//
// ONE hook writes the query, not one per concern. Every write has to compose the WHOLE
// state — two hooks each writing their own subset would drop each other's params — and
// useSearchParams does not report a write back until the router transition lands, so
// two writes in the same tick would both compose from the pre-write query. The ref
// below is therefore the authoritative base; the params are how state arrives from a
// deep link, a reload, Back or Forward.

/**
 * `push` for a destination (tab, trader), so the phone's Back gesture returns to the
 * board instead of leaving the site. `replace` for a view of the same thing (sort,
 * window), so fifty sort clicks do not bury the page the visitor arrived from.
 */
type Mode = "push" | "replace";

// canonicalRank, computed once per window. Keyed on the rows array itself: useLeaderboard
// holds one array per window for the life of a fetch, so a sort click, a tab switch or
// a re-render finds the ranks already made, and a refetch — a new array — makes new
// ones. A WeakMap rather than a ref because sortRows runs during render, and a memo
// keyed on identity is a pure function of its input where a ref write during render is
// not. Entries die with the arrays they key.
const CANONICAL = new WeakMap<readonly TraderMetrics[], RankedTrader[]>();
function canonical(rows: readonly TraderMetrics[]): RankedTrader[] {
  // `periods[timePeriod] ?? []` hands over a fresh empty array every render while the
  // board is arming; nothing to rank and nothing worth caching.
  if (rows.length === 0) return [];
  let ranked = CANONICAL.get(rows);
  if (ranked === undefined) {
    ranked = withCanonicalRank(rows);
    CANONICAL.set(rows, ranked);
  }
  return ranked;
}

export function useTableControls() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const state = useMemo(() => readWhaleState(params), [params]);

  const base = useRef<WhaleUrlState>(state);
  // Syncs only when the URL changes for a reason we did not cause — a deep link, a
  // reload, Back or Forward. Our own writes land here first (below), and the params
  // catch up to the same value, so this is a no-op for them.
  useEffect(() => {
    base.current = state;
  }, [state]);

  // The KIND of the last change — period, sort field or sort direction — for the
  // board's commit engine, which runs a different moment for each (useCommit.ts). It is
  // derived from the URL state rather than recorded at the click, so it lands in the
  // SAME render as the new order (both come off `state`), and Back or Forward — which
  // never pass through a handler here — get the same moment a click would. The
  // previous-render comparison is React's own pattern for it: a conditional setState
  // during render, which React re-runs immediately, once, before anything is committed.
  // The seq makes the same kind twice in a row two commits; a URL change that moves
  // none of the three (a tab, a trader) leaves it be.
  const [seen, setSeen] = useState<{ state: WhaleUrlState; change: BoardChange }>({
    state,
    change: NO_CHANGE,
  });
  if (seen.state !== state) {
    const kind = changeKind(seen.state, state);
    setSeen({
      state,
      change: kind === null ? seen.change : { kind, seq: seen.change.seq + 1 },
    });
  }

  const commit = useCallback(
    (patch: Partial<WhaleUrlState>, mode: Mode) => {
      const next = { ...base.current, ...patch };
      base.current = next;
      const query = whaleQuery(next);
      const href = query === "" ? pathname : `${pathname}?${query}`;
      // scroll:false throughout: sorting a fifty-row table must not throw the reader
      // back to the top of the page, and the tab rack is already at the top.
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [pathname, router]
  );

  const setTimePeriod = useCallback(
    (period: TimePeriod) => commit({ period }, "replace"),
    [commit]
  );

  // Reads the current field off the base rather than a setState updater. The previous
  // shape nested setSortDirection inside a setSortField updater, which StrictMode
  // double-invokes — so the direction toggled twice and the header sometimes did not
  // move at all (whale-leaderboard-13).
  const handleSort = useCallback(
    (field: SortField) => {
      const current = base.current;
      const dir =
        current.sort === field
          ? current.dir === "desc"
            ? "asc"
            : "desc"
          : "desc";
      commit({ sort: field, dir }, "replace");
    },
    [commit]
  );

  // A click (or Enter/Space) on a tab is a destination, so it gets a history entry and
  // Back returns to the board. An ARROW key is not: the rack activates on focus, so
  // walking Leaderboard → Analytics is four activations of a control the reader is still
  // moving through, and pushing four entries would mean four Back presses to leave the
  // page. The URL still ends up correct either way — only the history does not grow.
  const selectTab = useCallback(
    (tab: Tab, via: TabActivation) =>
      commit({ tab }, via === "keyboard" ? "replace" : "push"),
    [commit]
  );

  // Selecting a row jumps straight to its positions — the tab is the destination, so
  // one history entry covers both halves of the change and one Back returns to the
  // board.
  const selectTrader = useCallback(
    (trader: string) => commit({ trader, tab: "positions" }, "push"),
    [commit]
  );

  const clearTrader = useCallback(
    () => commit({ trader: null, tab: "leaderboard" }, "push"),
    [commit]
  );

  // Returns rows that carry their canonicalRank, so the plate reads the window's PnL
  // rank while the row's position is whatever this sort says. The plate used to be
  // `index + 1` of this very output, which renumbered it on every click.
  const sortRows = useCallback(
    (rows: TraderMetrics[]): RankedTrader[] => {
      const key: Record<SortField, (t: TraderMetrics) => number> = {
        pnl: (t) => t.pnl,
        winRate: (t) => t.winRate,
        volume: (t) => t.volume,
      };
      const read = key[state.sort];
      // Deterministic tiebreak on pnl: sixteen of the top fifty have a volume of
      // exactly 0.00, and without this they'd shuffle between renders.
      return [...canonical(rows)].sort((a, b) => {
        const diff = read(a) - read(b);
        const primary = state.dir === "desc" ? -diff : diff;
        return primary !== 0 ? primary : b.pnl - a.pnl;
      });
    },
    [state.sort, state.dir]
  );

  return {
    activeTab: state.tab,
    focused: state.trader,
    timePeriod: state.period,
    sortField: state.sort,
    sortDirection: state.dir,
    change: seen.change,
    setTimePeriod,
    handleSort,
    selectTab,
    selectTrader,
    clearTrader,
    sortRows,
  };
}
