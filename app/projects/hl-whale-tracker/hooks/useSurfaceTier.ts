"use client";

import { useSyncExternalStore } from "react";

// THE SURFACE TIER — the one structural gate every motion on the board reads.
//
// Before this, each moving part asked its own question: the odometer and the re-seat
// each called useReducedMotion, the caustic checked pointer: coarse in CSS, and nothing
// asked about the viewport at all — so a tablet at 800px got fifty rows travelling
// under a finger that cannot hover. One decision, made from three media queries, and
// every consumer compares against it.
//
// It is a ladder, not a boolean:
//
//   still   prefers-reduced-motion. The designed still: plates seat, figures print at
//           their final digit, nothing travels or rolls. A still, not a slowdown.
//   seat    Motion is not refused, but there is no fine pointer or the window is below
//           sm. Discrete on-beat changes may still land (a tab plate seating); nothing
//           continuous runs. This is the phone and the tablet.
//   commit  Fine pointer, motion allowed, at least sm. The only tier that may run
//           travel — the re-seat, the odometer roll, and the period commit to come.
//
// Consumers gate on a threshold: `tier === "commit"` for anything that travels,
// `tier !== "still"` for a discrete beat. The decision is pure and exported so the
// ladder is tested as three booleans, without a window.
//
// useSyncExternalStore rather than a useState + effect: the server has no window and
// renders the still, hydration reads the same still (no mismatch), and the first
// client render after that reads the real answer — one render, not a flash of
// motion-on followed by motion-off.

export type SurfaceTier = "still" | "seat" | "commit";

export interface SurfaceSignals {
  reducedMotion: boolean;
  finePointer: boolean;
  atLeastSm: boolean;
}

/** What the server says, and what hydration reads: the safe default is nothing moving. */
export const SERVER_SURFACE_TIER: SurfaceTier = "still";

export function decideSurfaceTier({
  reducedMotion,
  finePointer,
  atLeastSm,
}: SurfaceSignals): SurfaceTier {
  if (reducedMotion) return "still";
  if (!finePointer || !atLeastSm) return "seat";
  return "commit";
}

// `pointer`, not `any-pointer`: the question is what the visitor is holding, and a
// laptop with a touchscreen is still driven by its trackpad. 40rem is Tailwind v4's
// `sm`, stated in rem so it tracks the same root size the `sm:` utilities do.
const QUERIES = {
  reducedMotion: "(prefers-reduced-motion: reduce)",
  finePointer: "(pointer: fine)",
  atLeastSm: "(min-width: 40rem)",
} as const;

type Lists = Record<keyof typeof QUERIES, MediaQueryList>;

// Built on first use, on the client only — module evaluation must not touch `window`,
// because the tests import the pure decision above from Node.
let lists: Lists | null = null;
function mediaLists(): Lists {
  if (lists === null) {
    lists = {
      reducedMotion: window.matchMedia(QUERIES.reducedMotion),
      finePointer: window.matchMedia(QUERIES.finePointer),
      atLeastSm: window.matchMedia(QUERIES.atLeastSm),
    };
  }
  return lists;
}

function subscribe(onChange: () => void): () => void {
  const all = Object.values(mediaLists());
  all.forEach((list) => list.addEventListener("change", onChange));
  return () => all.forEach((list) => list.removeEventListener("change", onChange));
}

// Returns a string, so React's identity check on the snapshot is a value comparison and
// an unchanged answer never re-renders.
function getSnapshot(): SurfaceTier {
  const { reducedMotion, finePointer, atLeastSm } = mediaLists();
  return decideSurfaceTier({
    reducedMotion: reducedMotion.matches,
    finePointer: finePointer.matches,
    atLeastSm: atLeastSm.matches,
  });
}

function getServerSnapshot(): SurfaceTier {
  return SERVER_SURFACE_TIER;
}

export function useSurfaceTier(): SurfaceTier {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
