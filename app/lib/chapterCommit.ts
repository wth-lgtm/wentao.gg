// The commit (DESIGN §4.2.2): how the displayed beat `shown` follows the target — a catch-up riffle ON THE
// BEAT, never React state (E2). Pure apart from the injected lattice (mechanism.atBeat in the browser, a fake
// clock in tests/chapter-commit.test.ts).
//
//   - When target ≠ shown and nothing is pending, arm ONE step on the next 100 ms boundary:
//     shown = riffleStep(shown, target). After each step, if target ≠ shown, arm the next. A double notch or
//     a PageDown therefore steps through every row in turn at ten rows a second, like a Solari drum catching up.
//   - If the target returns to shown before the boundary, the pending step is cancelled.
//   - While |velocity| > COMMIT_MAX_V (a fling), no step is armed; `resume()` (the scroll store zeroing the
//     velocity) re-arms from where shown stands.
//   - A target of −1 (the reader left the engaged zone) clears the marks on the next beat; `clear()` clears them
//     synchronously (the chapter's observer detaching, a mode switch), so a stale mark never shows on return.
//   - At rest nothing is pending: the chapter costs no callbacks.

import { COMMIT_MAX_V, riffleStep } from "./chapterList";

export interface CommitDeps {
  /** arm `cb` on the next lattice boundary; returns cancel() */
  atBeat(cb: () => void): () => void;
  /** the scroll's current velocity, px/s (signed) */
  velocity(): number;
  /** a step landed: write the marks for `next` (−1 = none), synchronously, inside the beat's timeout */
  onStep(next: number, prev: number): void;
}

export interface Commit {
  readonly shown: number;
  readonly target: number;
  readonly pending: boolean;
  readonly held: boolean;
  setTarget(target: number): void;
  resume(): void;
  clear(): void;
}

export function createCommit(deps: CommitDeps): Commit {
  let shown = -1;
  let target = -1;
  let cancel: (() => void) | null = null;
  let held = false;

  const fast = () => Math.abs(deps.velocity()) > COMMIT_MAX_V;

  function arm() {
    if (cancel || target === shown) return;
    if (fast()) { held = true; return; }
    held = false;
    cancel = deps.atBeat(tick);
  }

  function tick() {
    cancel = null;
    if (target === shown) return;
    if (fast()) { held = true; return; }
    const prev = shown;
    shown = riffleStep(shown, target);
    deps.onStep(shown, prev);
    arm();
  }

  return {
    get shown() { return shown; },
    get target() { return target; },
    get pending() { return cancel !== null; },
    get held() { return held; },
    setTarget(t) {
      target = t < 0 ? -1 : Math.floor(t);
      if (target === shown) {
        cancel?.();
        cancel = null;
        held = false;
        return;
      }
      arm();
    },
    resume() {
      if (held) held = false;
      arm();
    },
    clear() {
      cancel?.();
      cancel = null;
      held = false;
      target = -1;
      if (shown !== -1) {
        const prev = shown;
        shown = -1;
        deps.onStep(-1, prev);
      }
    },
  };
}
