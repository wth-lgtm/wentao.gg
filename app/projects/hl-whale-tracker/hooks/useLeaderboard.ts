"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TraderMetrics, TimePeriod } from "../lib/types";
import { TTL_S } from "../lib/config";
import {
  isUnreadableBoard,
  isUnreadableWindow,
  unreadableBoardMessage,
} from "../lib/boardHealth";

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

/**
 * The earliest moment a wake refetch is allowed, on the client clock — the whole of the
 * refetch policy, as the later of two gates:
 *
 *   - the FLOOR, one request per TTL counted from when we last asked. This is the gate
 *     that bounds the rate: inside `stale-while-revalidate` the edge legitimately
 *     answers with a body ALREADY past its s-maxage, so an expiry-only gate is
 *     satisfied by the very answer it just produced and the page would refetch as fast
 *     as the network allowed.
 *   - the EXPIRY, which only exists once there is a snapshot to age. With none — a
 *     first load that failed — the floor alone schedules the retry, which is what
 *     makes recovery automatic instead of dependent on the visitor doing something.
 *
 * Exported because this is the part with two failure modes that no screenshot shows: a
 * request loop, and a page that never comes back. See tests/wakeSchedule.test.ts.
 */
export function nextWakeAt({
  snapshot,
  ttlMs,
  attemptedAt,
}: {
  snapshot: LeaderboardSnapshot | null;
  ttlMs: number;
  attemptedAt: number;
}): number {
  const floor = attemptedAt + ttlMs;
  if (snapshot === null) return floor;
  return Math.max(floor, snapshot.receivedAt + ttlMs - snapshot.ageAtReceipt);
}

/** Per-window counts, keeping only the entries that are actually numbers: an absent or
 * unreadable figure is null on the rail, never a confident 0. */
function readRowsPartial(raw: unknown): Partial<Record<TimePeriod, number>> {
  if (raw === null || typeof raw !== "object") return {};
  const out: Partial<Record<TimePeriod, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key as TimePeriod] = value;
    }
  }
  return out;
}

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
  // Rows upstream returned that could not be read completely, PER WINDOW — the figure
  // lib/hyperliquid.ts has published since PR #53 with nothing to consume it. It is
  // what lets the rail explain a board that is short instead of the route answering
  // 502 the moment one field is renamed. See app/api/hl-leaderboard/route.ts.
  const [rowsPartial, setRowsPartial] = useState<Partial<Record<TimePeriod, number>>>({});
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(null);
  // A refresh that came back byte-identical. Transient: the rail's STATE field and the
  // button label say so for UNCHANGED_MS and then return to IDLE / Refresh.
  const [unchanged, setUnchanged] = useState(false);
  // The body arrived and held no readable row in any window. See lib/boardHealth.
  const [unreadable, setUnreadable] = useState(false);
  // Bumped whenever a load SETTLES, success or failure. The wake effect below keys on
  // it: a failed refetch leaves `snapshot` untouched, so without this the effect never
  // re-ran and the expiry timer was never rescheduled — one failure and the page
  // stopped trying until the visitor switched tabs.
  const [attempts, setAttempts] = useState(0);

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
    // `error` and `unreadable` are deliberately NOT cleared here. Clearing them in the
    // prologue meant a refresh over a failed board dropped BOARD UNAVAILABLE the instant
    // the button was pressed: the table flashed back to its empty state — or to the
    // "No traders found" sentence — for the length of the request, and then the failure
    // returned. A failure stands until something better arrives, so both are cleared on
    // the success path below. (`unchanged` is not a failure; it is a transient status
    // field about the click that is happening, so it resets here.)
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

      const partialRows = readRowsPartial(body.rowsPartial);

      setPeriods(body.periods as Periods);
      setSnapshot({ receivedAt: Date.now(), ageAtReceipt });
      setRowsSeen(typeof body.rowsSeen === "number" ? body.rowsSeen : null);
      setRowsPartial(partialRows);
      setTtlSeconds(typeof body.ttlSeconds === "number" ? body.ttlSeconds : null);
      // The answer landed and it is a board, so whatever failure was on screen is over.
      setError(null);
      setLoading(false);
      setRefreshing(false);
      setAttempts((n) => n + 1);

      // A 200 that is not a board. The route now serves a payload whose rows all landed
      // incomplete rather than answering 502 — the right call, since it can say how many
      // and the rail shows it — but `periods` is then empty in every window and
      // LeaderboardTable reads no rows with no error as EMPTY: "No traders found with
      // activity in this period", a fact about the market that nothing measured. The
      // flag is recorded rather than the sentence because the sentence names the window
      // the visitor is ON, which this callback cannot read (empty deps, by design); it
      // is composed at the return below so switching the filter re-states it with that
      // window's own count — the same number the rail's DROPPED field shows.
      setUnreadable(isUnreadableBoard(body));

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
      setAttempts((n) => n + 1);
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
  // The decision is nextWakeAt's; this effect only arranges the three moments it can be
  // asked. It runs on every settled attempt, not just on a new snapshot, because a
  // FAILED refetch changes neither `snapshot` nor `ttlSeconds` — keying on those alone
  // meant one failure ended the retries, and a failed FIRST load returned early here
  // and never registered a listener at all.
  //
  // A hidden tab is never fetched for: the timer that fires behind it declines, and the
  // visibility listener picks it up when the reader actually comes back.
  //
  // It also relies on effect ORDER within the commit: `load` writes attemptedAtRef
  // synchronously, before its fetch, while this effect reads that ref only when a timer
  // or a listener fires — never during the commit that re-ran it. So the ref is always
  // the stamp of the most recent ASK by the time nextWakeAt sees it, and the rate floor
  // cannot be computed against a stale attempt. Moving the stamp into an effect would
  // break that silently.
  useEffect(() => {
    // Until a body has told us, our own route's s-maxage is the honest cadence — it is
    // the window the CDN would have served anyway, and a failed first load never got
    // to report one.
    const ttlMs = (ttlSeconds ?? TTL_S) * 1000;

    let debounce: number | undefined;
    const consider = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        if (Date.now() < nextWakeAt({ snapshot, ttlMs, attemptedAt: attemptedAtRef.current }))
          return;
        refetch("wake");
      }, WAKE_DEBOUNCE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") consider();
    };

    // The timer means a page left open in the foreground recovers on its own, without
    // waiting for a tab switch that may never come.
    const expiry = window.setTimeout(
      consider,
      Math.max(0, nextWakeAt({ snapshot, ttlMs, attemptedAt: attemptedAtRef.current }) - Date.now())
    );
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", consider);

    return () => {
      window.clearTimeout(debounce);
      window.clearTimeout(expiry);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", consider);
    };
  }, [snapshot, ttlSeconds, attempts, refetch]);

  // The two failures the composed `error` below merges, told apart. A thrown request and
  // a 200 whose rows could not be read read identically to a caller, and the live region
  // in page.tsx called both of them a failed refresh — so a click that COMPLETED and
  // came back with an unreadable board announced "Refresh failed".
  // `unreadable` is the whole board — every window empty, recorded at load time because
  // it is a property of the body — and isUnreadableWindow is the window ON SCREEN,
  // derived here rather than stored so switching the filter re-asks the question for the
  // window the visitor moved to.
  const windowUnreadable =
    unreadable || isUnreadableWindow(periods[timePeriod], rowsPartial[timePeriod]);

  return {
    traders: periods[timePeriod] ?? [],
    // All four windows, for the analytics tab's cross-window reads. Already in state
    // from the single request above, so exposing it costs nothing and the tab makes
    // no request of its own.
    periods,
    loading,
    refreshing,
    // A thrown request wins: it is the more specific failure, and one sentence per
    // failure is the rule the announcement effect in page.tsx depends on.
    // Two unreadable shapes, one sentence — see windowUnreadable above. The count is
    // always the window's own, which is what keeps this and the rail's DROPPED field
    // from printing two numbers for one failure.
    error:
      error ?? (windowUnreadable ? unreadableBoardMessage(rowsPartial[timePeriod] ?? null) : null),
    /** Which of the two the string above is, so a caller can word it. */
    errorKind: error !== null ? "request" : windowUnreadable ? "unreadable" : null,
    snapshot,
    rowsSeen,
    // Scoped to the window on screen, because the figures pnl/roi/vlm are: a row whose
    // 7d volume is missing is dropped from the 7d board alone. `?? null` keeps the
    // distinction the payload makes — 0 is "every row read cleanly", null is "the body
    // did not say".
    rowsPartial: rowsPartial[timePeriod] ?? null,
    ttlSeconds,
    unchanged,
    refresh,
  };
}
