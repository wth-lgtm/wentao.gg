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
  // Declared above the effect because the effect's cleanup aborts it too.
  const reloadRef = useRef<AbortController | null>(null);

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
    // The previous address's snapshot is cleared BEFORE the new request starts, so the
    // panels fall back to their skeleton rather than showing one trader's numbers
    // under another's legend for the length of a fetch. Since the panels now render an
    // affirmative "Tape unavailable" for a null part, keeping the old snapshot would
    // attribute a failure to an address that never failed. This batches with load's
    // own setLoading(true) below — both run in this same synchronous tick — so it
    // costs no extra render.
    setData(null);
    const controller = new AbortController();
    void load(address, controller.signal);
    // A retry started under the OLD address must die with it. Without this the
    // effect's early return for a null address (every switch back to the Leaderboard
    // tab) never calls load, so runRef is never bumped, and an orphaned reload still
    // satisfied `run === runRef.current` and landed its setData AFTER this branch's
    // setData(null) — the next row then rendered the previous trader's figures
    // because `data` was non-null and the skeleton was skipped.
    return () => {
      controller.abort();
      reloadRef.current?.abort();
    };
  }, [address, load]);

  // The one thing this hook had no way to do: ask again for the SAME address. The
  // effect keys on `address`, so re-selecting the row a visitor is already on is a
  // no-op — which meant the panels' failure states had nothing to offer but a page
  // reload. It keeps its own controller so a second click abandons the first request
  // instead of racing it, and `load`'s monotonic run id still decides which answer
  // wins if the effect fires in between. Same shape as useLeaderboard's refresh.
  const reload = useCallback(() => {
    if (!address) return;
    reloadRef.current?.abort();
    const controller = new AbortController();
    reloadRef.current = controller;
    void load(address, controller.signal);
  }, [address, load]);

  return { data, loading, error, reload };
}
