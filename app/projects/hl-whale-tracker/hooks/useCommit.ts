"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import {
  ARRIVAL_MS,
  GHOST_FADE_MS,
  HELD_TRAVEL_MS,
  INVERSION_MS,
  planCommit,
  type BoardChange,
  type CommitPlan,
} from "../lib/commitPlan";
import type { SurfaceTier } from "./useSurfaceTier";

// THE COMMIT ENGINE.
//
// Was useReSeat, which animated rows to their new berths whenever the sorted ORDER
// changed — and the order changes for four different reasons that deserve four
// different answers. It ran the same 380ms travel on a period switch (7D→30D holds 1 of
// 50: one row travelled while forty-nine popped), on a direction toggle (fifty rows
// reversing to say nothing the chevron does not) and on a wake refetch. Now the KIND of
// change picks the moment (lib/commitPlan.ts), and this hook only drives the DOM:
//
//   sort-field      the inversion: held rows travel, clamped, one uniform 380ms.
//   period          the re-sounding: the outgoing rows dissolve as ONE ghost sheet at
//                   their old berths, the held rows glide to their new rank over an
//                   opaque --card fill, the arrivals seat top-down. 620ms end to end.
//   sort-direction  nothing here; SortHeader turns its chevron (CSS).
//   a refresh       nothing here; the odometers roll the digits that changed.
//
// Travel is pure ARITHMETIC — dy = (prevIndex − newIndex) × ROW_H — and the ghost is
// mounted by its own table geometry, so there is no getBoundingClientRect, no offsetTop
// and no getComputedStyle anywhere in a commit: fifty rows move with zero forced layout.
//
// Handle discipline, because fifty leaked compositor layers is a slow board forever:
// every Animation lives in a Map, a new commit cancel()s what is running before it
// starts, will-change is written the frame BEFORE the travel and cleared in every
// finally — `finished` rejects with AbortError on cancel, and a `.then` alone would have
// parked will-change on every row the moment two clicks overlapped.

/** WAAPI takes a bezier, not a custom property; this is --ease-entrance (globals.css). */
const EASE_ENTRANCE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** Ease-in: the ghost is at its faintest exactly when the first arrivals begin. */
const EASE_DISSOLVE = "cubic-bezier(0.4, 0, 1, 1)";

export interface CommitRefs {
  /** The wrapper the ghost sheet mounts into. Positioned and isolated, so the sheet can
   * sit UNDER the live rows (z-index -1) and the travelling rows pass over it. */
  host: RefObject<HTMLElement | null>;
  /** The live board. Its clone, taken before React touches it, is the ghost. */
  table: RefObject<HTMLTableElement | null>;
}

export function useCommit(
  orderKey: string,
  change: BoardChange,
  tier: SurfaceTier,
  refs: CommitRefs
) {
  // The key is the order's stable identity (page.tsx builds a fresh array per render);
  // splitting it back gives an array whose identity follows the key, so the effect
  // below can depend on it honestly instead of reading a closure past the linter.
  const order = useMemo(() => (orderKey === "" ? [] : orderKey.split("|")), [orderKey]);

  const rows = useRef(new Map<string, HTMLElement>());
  const running = useRef(new Map<string, Animation>());
  const prevOrder = useRef<readonly string[]>([]);
  // A commit is consumed by its sequence number: an order that changes under the seq we
  // have already acted on is a refresh, and a refresh does not travel.
  const seenSeq = useRef(change.seq);
  const frame = useRef<number | null>(null);

  /** The clone taken in the before-mutation phase, waiting for the effect to mount it. */
  const outgoing = useRef<HTMLTableElement | null>(null);
  const ghost = useRef<HTMLTableElement | null>(null);
  const ghostAnim = useRef<Animation | null>(null);

  const registerRow = useCallback((key: string, el: HTMLElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  }, []);

  /**
   * Called by LeaderboardTable's OutgoingBoard from getSnapshotBeforeUpdate — the one
   * point in a React update where the DOM is still the previous board. Effects, layout
   * effects and ref callbacks all run after the rows have been replaced, and by then the
   * departing rows are gone. Only the period commit needs this; the caller gates on kind.
   */
  const snapshotOutgoing = useCallback(() => {
    const table = refs.table.current;
    if (!table || prevOrder.current.length === 0) return;
    outgoing.current = table.cloneNode(true) as HTMLTableElement;
  }, [refs.table]);

  /** Stop everything mid-flight and leave no trace: styles, handles, the ghost. */
  const settle = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    running.current.forEach((anim, key) => {
      anim.cancel();
      const el = rows.current.get(key);
      if (el) release(el);
    });
    running.current.clear();
    ghostAnim.current?.cancel();
    ghostAnim.current = null;
    ghost.current?.remove();
    ghost.current = null;
  }, []);

  useLayoutEffect(() => {
    const prev = prevOrder.current;
    prevOrder.current = order;
    const isNew = change.seq !== seenSeq.current;
    seenSeq.current = change.seq;
    const clone = outgoing.current;
    outgoing.current = null;

    // Not a commit: a refresh, a direction toggle (the chevron's business), a tier that
    // never travels, or a board with nothing on one side (the arming frame).
    if (!isNew || tier !== "commit") return;
    if (change.kind !== "sort-field" && change.kind !== "period") return;
    if (prev.length === 0 || order.length === 0) return;

    settle();
    const plan = planCommit(prev, order);

    // Everything below only promotes layers and parks each animation on its first frame,
    // paused. The travel itself is released on the NEXT frame, so the compositor has the
    // layers before anything asks them to move.
    if (change.kind === "sort-field") {
      armTravel(plan, INVERSION_MS, rows.current, running.current);
    } else {
      const host = refs.host.current;
      if (host && clone) {
        const sheet = mountGhost(clone, plan, prev.length, host);
        if (sheet) {
          ghost.current = sheet;
          const anim = sheet.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: GHOST_FADE_MS,
            easing: EASE_DISSOLVE,
            fill: "forwards",
          });
          anim.pause();
          ghostAnim.current = anim;
          anim.finished
            .catch(() => {})
            .finally(() => {
              // Removed here and in settle(); whichever comes first. The guard keeps a
              // cancelled sheet's finally from removing the next commit's sheet.
              if (ghost.current !== sheet) return;
              ghost.current = null;
              ghostAnim.current = null;
              sheet.remove();
            });
        }
      }
      armTravel(plan, HELD_TRAVEL_MS, rows.current, running.current);
      armArrivals(plan, rows.current, running.current);
    }

    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      running.current.forEach((anim) => anim.play());
      ghostAnim.current?.play();
    });
  }, [order, change, tier, refs.host, settle]);

  useEffect(() => () => settle(), [settle]);

  return { registerRow, snapshotOutgoing };
}

/** The end of a row's part in a commit: no hint, no fill, no handle. */
function release(el: HTMLElement) {
  el.style.willChange = "";
  delete el.dataset.travel;
}

/**
 * Held rows that moved: from their old berth (as an offset) to their new one. The fill
 * is `backwards`, so the parked first frame already shows the offset and the end state
 * is simply the row's own — nothing to hold, nothing to remove.
 */
function armTravel(
  plan: CommitPlan,
  duration: number,
  rows: ReadonlyMap<string, HTMLElement>,
  running: Map<string, Animation>
) {
  for (const { key, dy } of plan.held) {
    if (dy === 0) continue;
    const el = rows.get(key);
    if (!el) continue;
    el.style.willChange = "transform";
    // Opaque --card while travelling (globals.css .hl-berth[data-travel]): two crossing
    // rows were transparent text over transparent text.
    el.dataset.travel = "true";
    const anim = el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration, easing: EASE_ENTRANCE, fill: "backwards" }
    );
    anim.pause();
    track(key, el, anim, running);
  }
}

/** Arrivals seat top-down on the tape's own reveal, each after its plan delay. */
function armArrivals(
  plan: CommitPlan,
  rows: ReadonlyMap<string, HTMLElement>,
  running: Map<string, Animation>
) {
  for (const { key, delayMs } of plan.arrived) {
    const el = rows.get(key);
    if (!el) continue;
    el.style.willChange = "transform, opacity";
    const anim = el.animate(
      [
        { opacity: 0, transform: "translateY(-4px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: ARRIVAL_MS, delay: delayMs, easing: EASE_ENTRANCE, fill: "backwards" }
    );
    anim.pause();
    track(key, el, anim, running);
  }
}

function track(key: string, el: HTMLElement, anim: Animation, running: Map<string, Animation>) {
  running.set(key, anim);
  anim.finished
    .catch(() => {})
    .finally(() => {
      // A newer commit may own this row by now — settle() cancels synchronously and the
      // next armTravel re-hints in the same tick, while this finally runs a microtask
      // later. Cleaning up then would strip the hint the new travel just wrote.
      if (running.get(key) !== anim) return;
      running.delete(key);
      release(el);
    });
}

/**
 * The ghost sheet: the outgoing board, cloned whole so its colgroup gives the rows the
 * live table's exact column widths, mounted over the live table's own box. Its thead is
 * kept but invisible, so the ghost rows begin exactly where the live rows begin without
 * anyone measuring the header. The held rows are hidden in the clone — they travel as
 * themselves — and only the departures remain to dissolve.
 *
 * `inert` and aria-hidden: it is a picture of what was, not content; nothing in it can
 * be focused, hovered or read.
 */
function mountGhost(
  clone: HTMLTableElement,
  plan: CommitPlan,
  outgoingRows: number,
  host: HTMLElement
): HTMLTableElement | null {
  if (plan.departed.length === 0) return null;
  const body = clone.tBodies[0];
  // The clone's rows must be the outgoing order, one <tr> per address, or the indices
  // below would hide the wrong rows. Anything else (an arming frame, an error row) is
  // not a board to dissolve.
  if (!body || body.rows.length !== outgoingRows) return null;

  clone.classList.add("hl-ghost");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  clone.removeAttribute("aria-busy");
  clone.caption?.remove();
  for (const { from } of plan.held) body.rows[from].dataset.held = "true";
  // A row caught mid-travel by the snapshot carries the fill attribute; the ghost is
  // still, so it must not.
  body.querySelectorAll("[data-travel]").forEach((el) => el.removeAttribute("data-travel"));
  clone.style.willChange = "opacity";
  host.appendChild(clone);
  return clone;
}
