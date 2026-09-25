// ESCAPEMENT, built (D-0020): the one lattice, the easing language and the two masses. Pure: no DOM at
// import, never imports three, safe in node (tests/mechanism.test.ts holds every value here equal to its
// CSS twin in app/globals.css).
//
// LAW 1 — discrete things land on N × BEAT_MS: list mark switches (each step of a catch-up riffle), dot
// seats, readout and drum flips, word and stagger onsets. LAW 2 — continuous things (the rail fill, tint
// fades, the year wheel's roll) run free on the compositor and only start and end on a beat. Input is never
// quantized.
//
// The lattice is a PHASE on performance.now(), not a running tick: `atBeat` arms one timeout to the next
// boundary and nothing at all is pending at rest. D-0020's 10 Hz MechanismProvider is deliberately not built
// (a context re-render ten times a second over the live fluid is a reconciliation storm). The hero's
// SplitFlap keeps its own setInterval phase (a lock); the page lattice and the flap lattice never both drive
// text on one screen (one moving text layer per screen).

/** One beat. SplitFlap's FLAP_MS re-exports it; `--beat` in globals.css is its twin. */
export const BEAT_MS = 100;
/** one physical flap of the Solari board (SplitFlap.tsx), value unchanged */
export const FLAP_MS = BEAT_MS;
/** the board's dwell on a finished word: 40 beats (SplitFlap.tsx), value unchanged */
export const HOLD_MS = 40 * BEAT_MS;
/** n beats in ms */
export const beats = (n: number): number => n * BEAT_MS;

/** The one easing language (D-0011 → D-0044): the entrance curve, the ambient loop, and the hard stop. */
export const EASE = {
  entrance: [0.16, 1, 0.3, 1],
  ambient: [0.42, 0, 0.58, 1],
  /** promoted from the SplitFlap's sfDrop: a +5.3 % overshoot peaking at x ≈ 0.485 */
  stop: [0.2, 1.4, 0.4, 1],
} as const;

/** `cubic-bezier(…)` text for an EASE entry, as globals.css writes it */
export function bezierCss(e: readonly [number, number, number, number]): string {
  return `cubic-bezier(${e.join(", ")})`;
}

/**
 * The CSS custom properties this module mirrors (globals.css `:root`). The test parses globals.css and holds
 * each one equal, so a change on either side without the other fails `npm test`.
 */
export const CSS_TOKENS: Readonly<Record<string, string>> = {
  "--beat": `${BEAT_MS}ms`,
  "--ease-entrance": bezierCss(EASE.entrance),
  "--ease-ambient": bezierCss(EASE.ambient),
  "--ease-stop": bezierCss(EASE.stop),
};

/**
 * framer spring configs. True overshoot (ζ = c / 2√(km)): panel ζ 0.885 → 0.26 %, trim ζ 0.694 → 4.8 %.
 * D-0020's prose said ≈ 2 % / ≈ 8 %; the owner kept these springs and the prose is corrected (OC-G).
 */
export const MASS = {
  panel: { type: "spring", stiffness: 180, damping: 26, mass: 1.2 },
  trim: { type: "spring", stiffness: 420, damping: 18, mass: 0.4 },
} as const;

/** damping ratio ζ = c / (2√(k·m)) */
export function dampingRatio(s: { stiffness: number; damping: number; mass: number }): number {
  return s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
}

/** the step response's peak overshoot as a fraction (0 when critically or over-damped) */
export function springOvershoot(s: { stiffness: number; damping: number; mass: number }): number {
  const z = dampingRatio(s);
  return z >= 1 ? 0 : Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
}

/**
 * y(x) of a CSS cubic-bezier(x1, y1, x2, y2), solved for t by bisection on the monotone x(t) (x1, x2 ∈
 * [0, 1] make it monotone). Used by the tests to hold the `--ease-stop` peak, and nowhere at runtime.
 */
export function bezierAt(e: readonly [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = e;
  const coord = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (coord(mid, x1, x2) < x) lo = mid; else hi = mid;
  }
  return coord((lo + hi) / 2, y1, y2);
}

/** Fewer ms than this before a boundary and the boundary is skipped: a timeout never fires "on" a beat it cannot make. */
export const BEAT_SLACK_MS = 2;

/**
 * The first lattice boundary strictly after `now + BEAT_SLACK_MS`, plus (n − 1) beats. Boundaries are the
 * multiples of BEAT_MS on the performance.now() timeline, so every caller shares one phase.
 */
export function nextBeat(now: number, n = 1): number {
  const first = (Math.floor((now + BEAT_SLACK_MS) / BEAT_MS) + 1) * BEAT_MS;
  return first + (Math.max(1, Math.floor(n)) - 1) * BEAT_MS;
}

/** the clock `atBeat` runs on; injectable so node can drive it */
export interface BeatClock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const browserClock: BeatClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * One setTimeout to the next boundary (n = 1) or the n-th, then `cb`. Returns cancel(). No interval, no rAF:
 * the lattice costs one timer per pending event and nothing at rest.
 */
export function atBeat(cb: () => void, n = 1, clock: BeatClock = browserClock): () => void {
  const now = clock.now();
  const id = clock.setTimeout(cb, Math.max(0, nextBeat(now, n) - now));
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    clock.clearTimeout(id);
  };
}
