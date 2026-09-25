// The scroll store (DESIGN §3.2): one passive `scroll` listener feeding a plain object — no React state.
// Consumers (the reading chapters now; the gain needle and the travelling field later) subscribe and are
// called in the frame's READ phase, once per frame however many scroll events arrived. Native scroll stays
// THE scroll: this only watches it. PR 3's eased wheel will publish its own writes through `sampleScroll`,
// so read-phase consumers in the same frame are not one frame stale.
//
// Velocity is an EMA (50 ms time constant) over the samples, signed, in px/s; ONE timeout zeroes it 120 ms
// after the last sample (and notifies, so a step held above COMMIT_MAX_V resumes) — there is no rAF of its
// own. maxY comes from a ResizeObserver on <html>, cached. HeroMeta, NameCaustic and the jack field's
// scroll-end debounce keep their own listeners, untouched.

import { onFrame } from "./frame";

export interface ScrollState {
  y: number;
  /** where the scroll is going: y for native scroll; the eased wheel's target once PR 3 lands */
  target: number;
  /** px/s, signed (+ = down the page) */
  velocity: number;
  direction: -1 | 0 | 1;
  /** document scroll height − viewport height, cached */
  maxY: number;
  /** y / maxY, 0..1 */
  progress: number;
  /** true while a script (the eased wheel) is driving the scroll */
  smoothing: boolean;
}

export const VELOCITY_TAU_MS = 50;
export const VELOCITY_ZERO_MS = 120;

export interface ScrollEnv {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** run `cb` in the next frame's read phase (deduped by identity) */
  read(cb: () => void): void;
}

export interface ScrollStore {
  get(): Readonly<ScrollState>;
  subscribe(cb: (s: Readonly<ScrollState>) => void): () => void;
  sample(y: number, now: number): void;
  setMaxY(maxY: number): void;
  subscribers(): number;
}

export function createScrollStore(env: ScrollEnv): ScrollStore {
  const state: ScrollState = { y: 0, target: 0, velocity: 0, direction: 0, maxY: 0, progress: 0, smoothing: false };
  const subs = new Set<(s: Readonly<ScrollState>) => void>();
  let lastT = Number.NaN;
  let zeroTimer: unknown = null;

  const flush = () => { for (const cb of [...subs]) cb(state); };
  const notify = () => { if (subs.size) env.read(flush); };
  const zero = () => {
    zeroTimer = null;
    if (state.velocity === 0 && state.direction === 0) return;
    state.velocity = 0;
    state.direction = 0;
    notify();
  };

  return {
    get: () => state,
    subscribe(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    sample(y, now) {
      const dy = y - state.y;
      const dt = now - lastT;
      if (Number.isFinite(dt) && dt > 0) {
        const inst = (dy / dt) * 1000;
        const a = 1 - Math.exp(-dt / VELOCITY_TAU_MS);
        state.velocity += a * (inst - state.velocity);
      } else if (!Number.isFinite(lastT)) {
        state.velocity = 0;
      }
      if (dy !== 0) state.direction = dy > 0 ? 1 : -1;
      lastT = now;
      state.y = y;
      if (!state.smoothing) state.target = y;
      state.progress = state.maxY > 0 ? Math.min(1, Math.max(0, y / state.maxY)) : 0;
      if (zeroTimer !== null) env.clearTimeout(zeroTimer);
      zeroTimer = env.setTimeout(zero, VELOCITY_ZERO_MS);
      notify();
    },
    setMaxY(maxY) {
      state.maxY = Math.max(0, maxY);
      state.progress = state.maxY > 0 ? Math.min(1, Math.max(0, state.y / state.maxY)) : 0;
    },
    subscribers: () => subs.size,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The page's store: attached on the first subscription, detached after the last.

let store: ScrollStore | null = null;
let detach: (() => void) | null = null;

/** The page store's own callbacks (its scroll listener, its velocity-zero timer), counted for the harness's
 *  "the chapter code runs 0 callbacks at rest" (ChapterDirector's ?chapterDebug counter sums them in). Review
 *  builds only (NEXT_PUBLIC_REVIEW_FLAGS=1, a build-time constant): a production build compiles the counting out. */
export const scrollStoreCalls = { listener: 0, timer: 0 };
const COUNT = process.env.NEXT_PUBLIC_REVIEW_FLAGS === "1";

function pageStore(): ScrollStore {
  if (!store) {
    store = createScrollStore({
      setTimeout: COUNT ? (cb, ms) => setTimeout(() => { scrollStoreCalls.timer++; cb(); }, ms) : (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      read: (cb) => { onFrame("read", cb); },
    });
  }
  return store;
}

function attach(s: ScrollStore): () => void {
  const html = document.documentElement;
  const measure = () => s.setMaxY(html.scrollHeight - window.innerHeight);
  const onScroll = () => { if (COUNT) scrollStoreCalls.listener++; s.sample(window.scrollY, performance.now()); };
  measure();
  s.sample(window.scrollY, performance.now());
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", measure);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  ro?.observe(html);
  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", measure);
    ro?.disconnect();
  };
}

/** The current scroll state (a live object: read it, never keep it). */
export function getScroll(): Readonly<ScrollState> {
  return pageStore().get();
}

/** Subscribe; the callback runs in the read phase of the frame after each scroll (and after velocity zeroes). */
export function subscribeScroll(cb: (s: Readonly<ScrollState>) => void): () => void {
  const s = pageStore();
  const off = s.subscribe(cb);
  if (!detach && typeof window !== "undefined") detach = attach(s);
  return () => {
    off();
    if (s.subscribers() === 0 && detach) { detach(); detach = null; }
  };
}

/** A script-driven scroll publishes its own write (PR 3's eased wheel). */
export function sampleScroll(y: number, now: number): void {
  pageStore().sample(y, now);
}
