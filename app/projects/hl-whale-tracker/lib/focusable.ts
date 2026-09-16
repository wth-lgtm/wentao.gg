// What the browser puts in the tab sequence, and which of those a reader can reach.
//
// useTabpanelFocus decides whether the open panel needs its own tab stop by asking the
// DOM for a focusable control. The selector alone over-counted: the board's commit
// engine mounts a GHOST of the outgoing table for the length of a period commit's fade
// (useCommit.ts mountGhost) — a cloned <table>, `inert` and aria-hidden, a picture of
// what was, with fifty cloned inspect <button>s in it — and `button:not([disabled])`
// matched every one of them. The panel then read as "has controls" off elements nothing
// can focus, and a reader parked on it could be handed focus into the ghost. `inert`
// and aria-hidden="true" are the two ways a subtree is taken out of reach, so a control
// counts only when neither is on it or above it.
//
// Pure over anything with Element's `closest`, so tests/focusable.test.ts pins it
// without a DOM.

/** What the browser puts in the tab sequence without being asked. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A subtree nothing inside can be focused or read from. */
export const HIDDEN_SUBTREE = '[inert],[aria-hidden="true"]';

interface Closable {
  closest(selectors: string): unknown;
}

/** Whether a matched control is actually reachable: not inside a hidden subtree. */
export function isReachable(el: Closable): boolean {
  return el.closest(HIDDEN_SUBTREE) === null;
}

/** The first reachable control among the selector's matches, in document order. */
export function firstReachable<T extends Closable>(candidates: Iterable<T>): T | null {
  for (const candidate of candidates) {
    if (isReachable(candidate)) return candidate;
  }
  return null;
}
