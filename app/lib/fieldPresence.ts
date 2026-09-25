// Which composition the hero's jack field was born with, if it is mounted at all — published by JackField.tsx,
// read by the ChapterDirector to place each chapter's title in the corridor between the packs (packCorridor.ts).
// null: no field (phones, coarse pointers, reduced motion, before its deferred birth, or unmounted by a live
// Reduce Motion toggle) — the dial then sits at the stage's top. Three-free; no React.

import type { Pack } from "./fieldPacks";

let packs: readonly Pack[] | null = null;
const listeners = new Set<() => void>();

export function publishFieldPacks(next: readonly Pack[] | null): void {
  if (next === packs) return;
  packs = next;
  for (const l of [...listeners]) l();
}

export function getFieldPacks(): readonly Pack[] | null {
  return packs;
}

export function onFieldPacks(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
