"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TraderMetrics, TimePeriod } from "../lib/types";

// Fetches /api/hl-leaderboard ONCE and keeps all four periods in memory, so changing the
// time filter is instant and costs no network. Previously this re-downloaded the entire
// ~33MB upstream payload on every filter click, with no abort — so clicking through the
// four periods stacked four concurrent downloads and whichever finished last won.

type Periods = Partial<Record<TimePeriod, TraderMetrics[]>>;

export function useLeaderboard(timePeriod: TimePeriod) {
  const [periods, setPeriods] = useState<Periods>({});
  // `loading` means "there is nothing to show yet"; `refreshing` means "a fetch is
  // in flight over data that is already on screen". Collapsing the two would let a
  // refresh replace fifty populated rows with a skeleton.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [rowsSeen, setRowsSeen] = useState<number | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(null);

  // Monotonic run id: a late response from a superseded request must not overwrite a newer
  // one, which is the bug that let the slowest filter click win.
  const runRef = useRef(0);

  const load = useCallback(async (signal: AbortSignal, force: boolean) => {
    const run = ++runRef.current;
    setRefreshing(true);
    setError(null);

    try {
      const res = await fetch("/api/hl-leaderboard", {
        signal,
        cache: force ? "no-store" : "default",
      });
      const body = await res.json().catch(() => null);
      if (signal.aborted || run !== runRef.current) return;

      if (!res.ok || !body?.periods) {
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      setPeriods(body.periods as Periods);
      setLastUpdated(typeof body.updatedAt === "number" ? body.updatedAt : Date.now());
      setRowsSeen(typeof body.rowsSeen === "number" ? body.rowsSeen : null);
      setTtlSeconds(typeof body.ttlSeconds === "number" ? body.ttlSeconds : null);
      setLoading(false);
      setRefreshing(false);
    } catch (err) {
      if (signal.aborted || run !== runRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch data");
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, false);
    return () => controller.abort();
  }, [load]);

  // Refresh keeps its own controller so an in-flight refresh is abandoned, not raced.
  const refreshRef = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    refreshRef.current?.abort();
    const controller = new AbortController();
    refreshRef.current = controller;
    void load(controller.signal, true);
  }, [load]);

  return {
    traders: periods[timePeriod] ?? [],
    loading,
    refreshing,
    error,
    lastUpdated,
    rowsSeen,
    ttlSeconds,
    refresh,
  };
}
