"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { TraderFills, TraderPositions } from "../lib/trader";

/** One upstream's worth of answer. Three states, and `data` with `error` set is a
 * failed RETRY over a reading that is still on screen. */
export interface TraderSlice<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const IDLE = { data: null, loading: false, error: null } as const;

/**
 * Fetches one trader, as two independent readings.
 *
 * It used to be one request for one object, so the Positions tab waited on userFills:
 * 1.16-1.38s for 658-745KB that only the Trades tab reads, against 0.39-0.49s for the
 * perp state Positions actually needs. Both are fired here, in parallel, from the same
 * effect — NOT lazily on Trades-tab open and not sequentially after positions, either
 * of which would put a fresh ~1s skeleton in front of a Trades tab that is instant
 * today.
 *
 * They share ONE AbortController and ONE monotonic run id, which is what keeps the two
 * slices describing the same address: clicking through several rows quickly cannot let
 * a slow earlier response land on the row you actually stopped on — the same race the
 * leaderboard's filter had before PR #35 — and a run that loses the race loses both
 * halves, so the panels can never disagree about whose trader they are showing.
 */
export function useTrader(address: string | null) {
  const [positions, setPositions] = useState<TraderSlice<TraderPositions>>(IDLE);
  const [fills, setFills] = useState<TraderSlice<TraderFills>>(IDLE);
  const runRef = useRef(0);
  // Declared above the effect because the effect's cleanup aborts it too.
  const reloadRef = useRef<AbortController | null>(null);

  const load = useCallback((addr: string, signal: AbortSignal) => {
    const run = ++runRef.current;
    // `data` is deliberately left alone here: a retry over a partial body keeps the
    // half that did answer on screen, and the effect below is what clears a previous
    // address. Both slices go busy in this one synchronous tick, so React batches
    // them into a single render however the two requests then settle.
    setPositions((s) => ({ ...s, loading: true, error: null }));
    setFills((s) => ({ ...s, loading: true, error: null }));

    const fetchSlice = async <T,>(
      url: string,
      set: Dispatch<SetStateAction<TraderSlice<T>>>
    ) => {
      try {
        const res = await fetch(url, { signal });
        const body = await res.json().catch(() => null);
        if (signal.aborted || run !== runRef.current) return;
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        set({ data: body as T, loading: false, error: null });
      } catch (err) {
        if (signal.aborted || run !== runRef.current) return;
        set((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load trader",
        }));
      }
    };

    // Two calls, not awaited in sequence: whichever upstream answers first renders
    // first, which is the whole point of the split.
    void fetchSlice<TraderPositions>(`/api/hl-trader/${addr}`, setPositions);
    void fetchSlice<TraderFills>(`/api/hl-trader/${addr}/fills`, setFills);
  }, []);

  useEffect(() => {
    if (!address) {
      setPositions(IDLE);
      setFills(IDLE);
      return;
    }
    // The previous address's readings are cleared BEFORE the new requests start, so the
    // panels fall back to their skeleton rather than showing one trader's numbers
    // under another's legend for the length of a fetch. Since the panels render an
    // affirmative "Tape unavailable" for a null part, keeping the old reading would
    // attribute a failure to an address that never failed. This batches with load's
    // own busy flags below — both run in this same synchronous tick — so it costs no
    // extra render.
    setPositions(IDLE);
    setFills(IDLE);
    const controller = new AbortController();
    load(address, controller.signal);
    // A retry started under the OLD address must die with it. Without this the
    // effect's early return for a null address (every switch back to the Leaderboard
    // tab) never calls load, so runRef is never bumped, and an orphaned reload still
    // satisfied `run === runRef.current` and landed its setState AFTER this branch's
    // reset — the next row then rendered the previous trader's figures because `data`
    // was non-null and the skeleton was skipped.
    return () => {
      controller.abort();
      reloadRef.current?.abort();
    };
  }, [address, load]);

  // The one thing this hook had no way to do: ask again for the SAME address. The
  // effect keys on `address`, so re-selecting the row a visitor is already on is a
  // no-op — which meant the panels' failure states had nothing to offer but a page
  // reload. It keeps its own controller so a second click abandons the first pair of
  // requests instead of racing them, and `load`'s monotonic run id still decides which
  // answer wins if the effect fires in between. Both slices are re-read, because the
  // button means "re-read this trader": the panel that is not on screen would
  // otherwise keep a failure the visitor has already asked to clear.
  const reload = useCallback(() => {
    if (!address) return;
    reloadRef.current?.abort();
    const controller = new AbortController();
    reloadRef.current = controller;
    load(address, controller.signal);
  }, [address, load]);

  return { positions, fills, reload };
}
