"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TraderMetrics, TimePeriod } from "../lib/types";

// Fetches /api/hl-leaderboard and keeps all four periods in memory, so changing the
// time filter is instant and costs no network. Previously this re-downloaded the entire
// ~33MB upstream payload on every filter click, with no abort — so clicking through the
// four periods stacked four concurrent downloads and whichever finished last won.

type Periods = Partial<Record<TimePeriod, TraderMetrics[]>>;

/**
 * Where the rail's AGE field comes from. Both halves are needed because the two clocks
 * involved are not the same clock: `age` is the CDN's own count of how old the body it
 * just handed us is, and `receivedAt` is our clock at that instant. Age is then
 * `ageAtReceipt + (Date.now() - receivedAt)` — a subtraction within one clock, so a
 * visitor whose system time is wrong no longer sees an inflated age, and (worse) one
 * whose clock runs behind no longer sees a stale snapshot clamped to 00:00. Comparing
 * the server's `updatedAt` against the browser's Date.now(), which is what this used to
 * do, is the only path to a false reading here.
 */
export interface LeaderboardSnapshot {
  /** Our clock when the body landed. A delta base, never printed. */
  receivedAt: number;
  /** The `age` response header at that moment, in ms. 0 on a CDN MISS. */
  ageAtReceipt: number;
}

/** "initial" is the mount fetch; "refresh" is the button; "wake" is the TTL/visibility refetch. */
type LoadKind = "initial" | "refresh" | "wake";

// A word flashed for one 300ms beat is not legible, so the UNCHANGED reading is held
// for twelve (whale-leaderboard-6's verifier note).
const UNCHANGED_MS = 1200;

// visibilitychange and focus both fire when a tab comes forward, and a phone returning
// from the app switcher can fire either twice. One beat of debounce collapses them into
// a single decision.
const WAKE_DEBOUNCE_MS = 300;

export function useLeaderboard(timePeriod: TimePeriod) {
  const [periods, setPeriods] = useState<Periods>({});
  // `loading` means "there is nothing to show yet"; `refreshing` means "a fetch is
  // in flight over data that is already on screen". Collapsing the two would let a
  // refresh replace fifty populated rows with a skeleton.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [rowsSeen, setRowsSeen] = useState<number | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(null);
  // A refresh that came back byte-identical. Transient: the rail's STATE field and the
  // button label say so for UNCHANGED_MS and then return to IDLE / Refresh.
  const [unchanged, setUnchanged] = useState(false);

  // Monotonic run id: a late response from a superseded request must not overwrite a newer
  // one, which is the bug that let the slowest filter click win.
  const runRef = useRef(0);
  // `load` has empty deps, so it cannot read `snapshot` or the previous body out of its
  // closure. These three are the values it has to compare against.
  const updatedAtRef = useRef<number | null>(null);
  const attemptedAtRef = useRef(0);
  const unchangedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(unchangedTimer.current), []);

  const load = useCallback(async (signal: AbortSignal, kind: LoadKind) => {
    const run = ++runRef.current;
    // Stamped before the request, not after it: the rate floor below is "how long since
    // we last ASKED", which is what bounds the fan-out even when answers are slow.
    attemptedAtRef.current = Date.now();
    setRefreshing(true);
    setError(null);
    window.clearTimeout(unchangedTimer.current);
    setUnchanged(false);

    try {
      const res = await fetch("/api/hl-leaderboard", {
        signal,
        // Inert in practice, and kept only so a refetch cannot be answered out of the
        // browser's own cache: Vercel consumes s-maxage at the edge and returns only
        // `cache-control: public` downstream (verified live), so this response is not
        // browser-cacheable anyway and the edge ignores a client no-cache. A
        // cache-busting query string is deliberately NOT used — it would defeat the
        // CDN fan-out cap the route exists for.
        cache: kind === "initial" ? "default" : "no-store",
      });
      const body = await res.json().catch(() => null);
      if (signal.aborted || run !== runRef.current) return;

      if (!res.ok || !body?.periods) {
        throw new Error(body?.error || `Request failed (${res.status})`);
      }

      // Number(null ?? 0) is 0, and a non-numeric header is NaN — either way an absent
      // or unparseable age means "as fresh as we can tell", which is what a CDN MISS is.
      const ageHeader = Number(res.headers.get("age") ?? 0);
      const ageAtReceipt =
        Number.isFinite(ageHeader) && ageHeader > 0 ? ageHeader * 1000 : 0;

      const updatedAt = typeof body.updatedAt === "number" ? body.updatedAt : null;
      const previous = updatedAtRef.current;
      updatedAtRef.current = updatedAt;

      setPeriods(body.periods as Periods);
      setSnapshot({ receivedAt: Date.now(), ageAtReceipt });
      setRowsSeen(typeof body.rowsSeen === "number" ? body.rowsSeen : null);
      setTtlSeconds(typeof body.ttlSeconds === "number" ? body.ttlSeconds : null);
      setLoading(false);
      setRefreshing(false);

      // Only the button's own action reports this. `stale-while-revalidate=900` means
      // even the first click AFTER the TTL is answered from the same CDN snapshot, so
      // no client-side age gate can predict the no-op — comparing the body's own
      // updatedAt is the only honest test. A wake refetch stays silent: nobody asked.
      if (kind === "refresh" && updatedAt !== null && updatedAt === previous) {
        setUnchanged(true);
        unchangedTimer.current = window.setTimeout(
          () => setUnchanged(false),
          UNCHANGED_MS
        );
      }
    } catch (err) {
      if (signal.aborted || run !== runRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch data");
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, "initial");
    return () => controller.abort();
  }, [load]);

  // Refetches keep their own controller so an in-flight one is abandoned, not raced.
  const refetchRef = useRef<AbortController | null>(null);
  const refetch = useCallback(
    (kind: LoadKind) => {
      refetchRef.current?.abort();
      const controller = new AbortController();
      refetchRef.current = controller;
      void load(controller.signal, kind);
    },
    [load]
  );

  const refresh = useCallback(() => refetch("refresh"), [refetch]);

  // The board used to fetch once per mount: no interval, no listener, nothing. A tab
  // left open showed a snapshot whose age counter rolled past an hour with no comment
  // (critic: "nothing ever refetches after the snapshot ages out").
  //
  // Two gates, both required:
  //   1. the snapshot has passed its TTL — otherwise there is nothing to fetch;
  //   2. at least a TTL has passed since we last asked. This is the one that bounds
  //      the rate. Inside the SWR window the CDN legitimately answers with a body
  //      that is ALREADY past its TTL, so gate 1 alone would be satisfied by the very
  //      answer it just produced and the page would refetch as fast as the network
  //      allowed.
  // A hidden tab is never fetched for: the timer that fires behind it does nothing and
  // the visibility listener picks it up when the reader actually comes back.
  useEffect(() => {
    if (snapshot === null || ttlSeconds === null) return;
    const ttlMs = ttlSeconds * 1000;
    const expiresAt = snapshot.receivedAt + ttlMs - snapshot.ageAtReceipt;

    let debounce: number | undefined;
    const consider = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        const now = Date.now();
        if (now < expiresAt || now - attemptedAtRef.current < ttlMs) return;
        refetch("wake");
      }, WAKE_DEBOUNCE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") consider();
    };

    // Fires at the later of the two gates, so a page left open in the foreground
    // refreshes itself once without waiting for a tab switch that may never come.
    const dueIn = Math.max(0, Math.max(expiresAt, attemptedAtRef.current + ttlMs) - Date.now());
    const expiry = window.setTimeout(consider, dueIn);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", consider);

    return () => {
      window.clearTimeout(debounce);
      window.clearTimeout(expiry);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", consider);
    };
  }, [snapshot, ttlSeconds, refetch]);

  return {
    traders: periods[timePeriod] ?? [],
    // All four windows, for the analytics tab's cross-window reads. Already in state
    // from the single request above, so exposing it costs nothing and the tab makes
    // no request of its own.
    periods,
    loading,
    refreshing,
    error,
    snapshot,
    rowsSeen,
    ttlSeconds,
    unchanged,
    refresh,
  };
}
