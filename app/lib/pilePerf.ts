// The pile's frame-budget sampler, pure so the step-down it drives can be fed a sequence of
// frame deltas in node and asked whether it would fire. Two independent triggers, because
// one alone has a blind spot:
//
// - MEAN: twenty consecutive frames under SLOW averaging more than MEAN_LIMIT. Catches the
//   GPU that keeps up but only just — 25–40 ms frames at DPR 2 that a real display shows as
//   a stutter. Frames at or over SLOW are kept OUT of this mean: the first frames of a pour
//   compile the physical material's shaders (~150 ms each) and would have tripped a fast
//   GPU on its first window.
// - SLOW COUNT: frames at or over SLOW, counted on their own. Catches the GPU whose EVERY
//   pour frame is over 100 ms — the class the step-down exists for — which the mean trigger
//   can never see because it never accumulates a sample. A compile blip is two or three
//   such frames; SLOW_LIMIT is set where only a sustained ≤ 10 fps device arrives.
//
// A delta at or over GAP is neither: the tab was hidden or the frameloop idle, and the first
// frame back carries the whole gap. Each degrade is a one-way step (the canvas only ever
// lowers DPR, then drops ContactShadows) and there are at most MAX_STEPS of them; nothing
// here steps back up, so the picture cannot flap.

export const PERF = {
  /** frames per mean window */
  WINDOW: 20,
  /** seconds; a window averaging above this degrades */
  MEAN_LIMIT: 0.02,
  /** seconds; a frame at or over this is "slow" and leaves the mean */
  SLOW: 0.1,
  /** slow frames in one pour that degrade — a compile blip is 2–3, a 10 fps pour is 20+ */
  SLOW_LIMIT: 12,
  /** seconds; at or over this the delta is an idle or hidden-tab gap, not a frame */
  GAP: 1,
  /** DPR 1, then no ContactShadows */
  MAX_STEPS: 2,
} as const;

export interface PerfSampler {
  n: number;
  sum: number;
  slow: number;
  steps: number;
}

export function createSampler(): PerfSampler {
  return { n: 0, sum: 0, slow: 0, steps: 0 };
}

/**
 * Feed one frame delta (seconds). Returns true on a frame that steps the canvas down —
 * at most MAX_STEPS times over the sampler's life, each trigger re-arming after it fires so
 * a still-slow GPU can take the second step.
 */
export function sampleFrame(s: PerfSampler, delta: number): boolean {
  if (s.steps >= PERF.MAX_STEPS || delta >= PERF.GAP) return false;
  if (delta >= PERF.SLOW) {
    s.slow++;
    if (s.slow >= PERF.SLOW_LIMIT) {
      s.slow = 0;
      s.steps++;
      return true;
    }
    return false;
  }
  s.n++;
  s.sum += delta;
  if (s.n < PERF.WINDOW) return false;
  const mean = s.sum / s.n;
  s.n = 0;
  s.sum = 0;
  if (mean > PERF.MEAN_LIMIT) {
    s.steps++;
    return true;
  }
  return false;
}

/** How many step-downs a whole sequence of deltas would produce. */
export function stepsFor(deltas: readonly number[]): number {
  const s = createSampler();
  for (const d of deltas) sampleFrame(s, d);
  return s.steps;
}
