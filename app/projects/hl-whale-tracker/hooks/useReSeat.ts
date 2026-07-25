"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

// THE RE-SEAT.
//
// When the sort changes, every row travels to its new berth. Sort is the right place
// for this: it holds 100% of the addresses, so all fifty move and nobody enters or
// leaves — whereas switching the time period replaces 68-90% of the rows, where
// travel would be mostly fiction.
//
// Travel is pure ARITHMETIC: dy = (prevIndex - newIndex) x ROW_H. There is no
// getBoundingClientRect anywhere, so no forced layout, and the distance is
// integer-exact because every row is locked to the same height.
//
// Two things that keep it from reading as jank:
//  - distance is CLAMPED. Measured max travel is ~2100px, and an expo-out ease
//    front-loads most of that into the first few frames — a blur, not a movement.
//    Capping at ten rows keeps the gesture legible while still showing direction.
//  - duration is uniform. Scaling it by distance produced a 320-560ms spread that
//    nobody can perceive, at the cost of the board settling raggedly.

export const ROW_H = 44;
const DURATION_MS = 380;
const MAX_TRAVEL_ROWS = 10;
const STAGGER_MS = 4;
const MAX_STAGGER_MS = 160;

export function useReSeat(orderKey: string, order: string[]) {
  const reduce = useReducedMotion() ?? false;
  const prevOrder = useRef<string[] | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const running = useRef(new Map<string, Animation>());

  const registerRow = useCallback((key: string, el: HTMLElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  }, []);

  useEffect(() => {
    const prev = prevOrder.current;
    // `order` is read straight from the closure. It is not in the dep array because
    // it is a fresh array on every render; orderKey is its stable identity, and the
    // two always change together. Writing it into a ref during render — which is
    // what I reached for first — is a real React violation, not a style nit.
    const next = order;
    prevOrder.current = next;

    // First render has nothing to travel from, and a reduced-motion visitor gets the
    // re-ranked board directly — the berth plates already carry the new order.
    if (!prev || reduce) return;

    const prevIndex = new Map(prev.map((key, i) => [key, i]));

    for (let newIdx = 0; newIdx < next.length; newIdx++) {
      const key = next[newIdx];
      const oldIdx = prevIndex.get(key);
      if (oldIdx === undefined || oldIdx === newIdx) continue;

      const el = rows.current.get(key);
      if (!el) continue;

      const rowsMoved = oldIdx - newIdx;
      const capped = Math.min(Math.abs(rowsMoved), MAX_TRAVEL_ROWS);
      const dy = Math.sign(rowsMoved) * capped * ROW_H;

      running.current.get(key)?.cancel();
      const anim = el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        {
          duration: DURATION_MS,
          delay: Math.min(newIdx * STAGGER_MS, MAX_STAGGER_MS),
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "backwards",
        }
      );
      running.current.set(key, anim);
      // `finished` rejects with AbortError when cancelled; without the catch the
      // rejection is unhandled and the handle leaks.
      anim.finished.catch(() => {}).finally(() => {
        running.current.delete(key);
      });
    }
    // `order` is intentionally omitted: it is a fresh array on every render, so
    // including it would cancel and restart the animation continuously. orderKey is
    // its stable identity and the two always change together — this is the case the
    // rule cannot see, not an oversight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, reduce]);

  useEffect(
    () => () => {
      running.current.forEach((a) => a.cancel());
      running.current.clear();
    },
    []
  );

  return registerRow;
}
