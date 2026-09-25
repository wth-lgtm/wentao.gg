// The one DOM clock (E4): a thin adapter over an INJECTABLE scheduler. In the browser it is framer-motion's
// `frame` batcher (already in the home page's first bundle; wired by app/lib/frameFramer.ts, which only client
// code imports); in node, tests inject `createStepper()` and step it by hand. framer's batcher captures
// requestAnimationFrame when its module evaluates and is a no-op under `node --test`, so this module never
// imports it.
//
// Three guarantees on top of the batcher:
//   - ERROR ISOLATION. framer's render step has no try/catch, and a throw leaves the step's `isProcessing`
//     true, which stalls that step for good. Every callback is wrapped; a throw is re-raised in a microtask,
//     so it is still reported and nothing else in the frame stops.
//   - DEDUPE. Requesting the same callback twice in one phase before it runs queues it ONCE. framer's step
//     queues are Sets keyed by function identity, so the wrapper for each (callback, phase) is cached in a
//     WeakMap and a second request adds the same function.
//   - ONCE. A request runs the callback in the next frame's phase and is then spent; loops re-request.
//
// Phases (framer's names; the unused ones are left out on purpose):
//   setup      the deferred keyboard-focus scroll (and PR 3's eased wheel)
//   read       the scroll store, the chapter's pin and row tops (arithmetic on cached layout)
//   update     unused
//   render     chapter DOM writes: the rail fill's transform, --pin-progress
//   postRender unused
// Scroll events only REQUEST the next frame's phases; with no scroll, nothing runs.

export type Phase = "setup" | "read" | "update" | "render" | "postRender";
export const PHASES: readonly Phase[] = ["setup", "read", "update", "render", "postRender"];

export interface FrameData {
  /** ms since the previous frame (framer caps it at 40 and reports 1000/60 on the first frame after a wake) */
  delta: number;
  /** the frame's performance.now() */
  timestamp: number;
}

export type FrameCallback = (d: FrameData) => void;

export interface Scheduler {
  schedule(phase: Phase, fn: FrameCallback): void;
  cancel(phase: Phase, fn: FrameCallback): void;
}

/** A manual scheduler: `step()` runs one frame, phase by phase, in order. For tests (and nothing else). */
export interface Stepper extends Scheduler {
  step(timestamp?: number): void;
  pending(): number;
}

export function createStepper(): Stepper {
  const queues = new Map<Phase, Set<FrameCallback>>(PHASES.map((p) => [p, new Set()]));
  let last = 0;
  return {
    schedule(phase, fn) { queues.get(phase)!.add(fn); },
    cancel(phase, fn) { queues.get(phase)!.delete(fn); },
    step(timestamp) {
      const ts = timestamp ?? last + 1000 / 60;
      const data: FrameData = { delta: last ? Math.min(40, ts - last) : 1000 / 60, timestamp: ts };
      last = ts;
      for (const phase of PHASES) {
        const q = queues.get(phase)!;
        const run = [...q];
        q.clear();
        for (const fn of run) fn(data);
      }
    },
    pending() { let n = 0; for (const q of queues.values()) n += q.size; return n; },
  };
}

/** Fallback when nothing was injected in a browser (frameFramer.ts not loaded yet): one rAF per frame, same phases. */
function rafScheduler(): Scheduler {
  const s = createStepper();
  let raf = 0;
  return {
    schedule(phase, fn) {
      s.schedule(phase, fn);
      if (!raf) raf = requestAnimationFrame((ts) => { raf = 0; s.step(ts); });
    },
    cancel(phase, fn) { s.cancel(phase, fn); },
  };
}

let scheduler: Scheduler | null = null;

/** Inject the scheduler (frameFramer.ts in the browser; a stepper in tests). `null` resets to the default. */
export function setScheduler(s: Scheduler | null): void {
  scheduler = s;
}

function current(): Scheduler | null {
  if (scheduler) return scheduler;
  if (typeof requestAnimationFrame === "function") scheduler = rafScheduler();
  return scheduler;
}

const wrappers = new WeakMap<FrameCallback, Map<Phase, FrameCallback>>();

function wrapperFor(phase: Phase, cb: FrameCallback): FrameCallback {
  let byPhase = wrappers.get(cb);
  if (!byPhase) { byPhase = new Map(); wrappers.set(cb, byPhase); }
  let w = byPhase.get(phase);
  if (!w) {
    w = (d: FrameData) => {
      try { cb(d); } catch (err) { queueMicrotask(() => { throw err; }); }
    };
    byPhase.set(phase, w);
  }
  return w;
}

/**
 * Run `cb` once in `phase` of the next frame. Requesting the same `cb` again before it runs queues it once.
 * Returns cancel(). A no-op (returning a no-op) where there is no scheduler at all (node without a stepper).
 */
export function onFrame(phase: Phase, cb: FrameCallback): () => void {
  const s = current();
  if (!s) return () => {};
  const w = wrapperFor(phase, cb);
  s.schedule(phase, w);
  return () => s.cancel(phase, w);
}
