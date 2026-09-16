"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TraderSnapshot } from "../lib/trader";

// Fetches one trader's snapshot. A monotonic run id means clicking through several
// rows quickly can't let a slow earlier response overwrite the row you actually
// landed on — the same race the leaderboard's filter had before PR #35.
export function useTrader(address: string | null) {
  const [data, setData] = useState<TraderSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef(0);

  const load = useCallback(async (addr: string, signal: AbortSignal) => {
    const run = ++runRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hl-trader/${addr}`, { signal });
      const body = await res.json().catch(() => null);
      if (signal.aborted || run !== runRef.current) return;
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      setData(body as TraderSnapshot);
      setLoading(false);
    } catch (err) {
      if (signal.aborted || run !== runRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load trader");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    void load(address, controller.signal);
    return () => controller.abort();
  }, [address, load]);

  // The one thing this hook had no way to do: ask again for the SAME address. The
  // effect keys on `address`, so re-selecting the row a visitor is already on is a
  // no-op — which meant the panels' failure states had nothing to offer but a page
  // reload. It keeps its own controller so a second click abandons the first request
  // instead of racing it, and `load`'s monotonic run id still decides which answer
  // wins if the effect fires in between. Same shape as useLeaderboard's refresh.
  const reloadRef = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    if (!address) return;
    reloadRef.current?.abort();
    const controller = new AbortController();
    reloadRef.current = controller;
    void load(address, controller.signal);
  }, [address, load]);

  return { data, loading, error, reload };
}
