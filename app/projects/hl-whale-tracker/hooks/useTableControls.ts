"use client";

import { useCallback, useState } from "react";
import { TraderMetrics, SortField, SortDirection, TimePeriod } from "../lib/types";

// Was useSortAndFilter. Renamed because it never filtered, and because it used to
// TAKE the traders array — the page called it with a literal [] and then
// re-implemented the sort inline and unmemoized. Now it owns the control state
// and exposes the sort as a function, so there is exactly one sort site.
export function useTableControls() {
  const [sortField, setSortField] = useState<SortField>("pnl");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("7d");

  const handleSort = useCallback((field: SortField) => {
    setSortField((prevField) => {
      if (prevField === field) {
        setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
        return prevField;
      }
      setSortDirection("desc");
      return field;
    });
  }, []);

  const sortRows = useCallback(
    (rows: TraderMetrics[]): TraderMetrics[] => {
      const key: Record<SortField, (t: TraderMetrics) => number> = {
        pnl: (t) => t.pnl,
        winRate: (t) => t.winRate,
        volume: (t) => t.volume,
      };
      const read = key[sortField];
      // Deterministic tiebreak on pnl: sixteen of the top fifty have a volume of
      // exactly 0.00, and without this they'd shuffle between renders.
      return [...rows].sort((a, b) => {
        const diff = read(a) - read(b);
        const primary = sortDirection === "desc" ? -diff : diff;
        return primary !== 0 ? primary : b.pnl - a.pnl;
      });
    },
    [sortField, sortDirection]
  );

  return { sortField, sortDirection, timePeriod, handleSort, setTimePeriod, sortRows };
}
