"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TraderMetrics, SortField, TimePeriod } from "../lib/types";
import { readWhaleState, whaleQuery, type WhaleUrlState } from "../lib/urlState";
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

  const sortRows = useCallback(
    (rows: TraderMetrics[]): TraderMetrics[] => {
      const key: Record<SortField, (t: TraderMetrics) => number> = {
        pnl: (t) => t.pnl,
        winRate: (t) => t.winRate,
        volume: (t) => t.volume,
      };
      const read = key[state.sort];
      // Deterministic tiebreak on pnl: sixteen of the top fifty have a volume of
      // exactly 0.00, and without this they'd shuffle between renders.
      return [...rows].sort((a, b) => {
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
    setTimePeriod,
    handleSort,
    selectTab,
    selectTrader,
    clearTrader,
    sortRows,
  };
}
