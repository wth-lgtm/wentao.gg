// The motion policy's store (DESIGN §3.4): the LIVE reduced-motion, forced-colours and fine-pointer queries as
// one snapshot, for useSyncExternalStore (SiteMotion.tsx `useSiteMotion`) and for plain modules (the
// ChapterDirector). framer's useReducedMotion() is mount-latched (`useState(prefersReducedMotion.current)`),
// so a visitor who turns Reduce Motion on with the page open kept every canvas and spring running; everything
// new reads this instead. The blocking theme script in layout.tsx writes the same answer to
// html[data-site-motion] before first paint (BOOT_MOTION_SCRIPT below), so CSS can lay out the first paint
// without waiting for hydration; SiteMotion keeps that attribute live afterwards.

export interface SiteMotionState {
  /** motion may play: no reduced-motion preference and no forced colours */
  allowed: boolean;
  reduced: boolean;
  forcedColors: boolean;
  /** (hover: hover) and (pointer: fine) */
  finePointer: boolean;
}

export const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
export const FORCED_QUERY = "(forced-colors: active)";
export const FINE_QUERY = "(hover: hover) and (pointer: fine)";

/** The statement the blocking <head> script runs before first paint (layout.tsx). JS off → no attribute → static. */
export const BOOT_MOTION_SCRIPT = `document.documentElement.dataset.siteMotion = (matchMedia('${REDUCE_QUERY}').matches || matchMedia('${FORCED_QUERY}').matches) ? 'off' : 'on';`;

const SERVER: SiteMotionState = Object.freeze({ allowed: false, reduced: false, forcedColors: false, finePointer: false });

let snapshot: SiteMotionState | null = null;
const listeners = new Set<() => void>();
let queries: MediaQueryList[] | null = null;

function read(): SiteMotionState {
  const reduced = matchMedia(REDUCE_QUERY).matches;
  const forcedColors = matchMedia(FORCED_QUERY).matches;
  const finePointer = matchMedia(FINE_QUERY).matches;
  return { allowed: !reduced && !forcedColors, reduced, forcedColors, finePointer };
}

function same(a: SiteMotionState, b: SiteMotionState): boolean {
  return a.allowed === b.allowed && a.reduced === b.reduced && a.forcedColors === b.forcedColors && a.finePointer === b.finePointer;
}

function onChange() {
  const next = read();
  if (snapshot && same(snapshot, next)) return;
  snapshot = next;
  document.documentElement.dataset.siteMotion = next.allowed ? "on" : "off";
  for (const l of [...listeners]) l();
}

export function subscribeSiteMotion(cb: () => void): () => void {
  listeners.add(cb);
  if (!queries && typeof window !== "undefined") {
    queries = [REDUCE_QUERY, FORCED_QUERY, FINE_QUERY].map((q) => matchMedia(q));
    for (const q of queries) q.addEventListener("change", onChange);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && queries) {
      for (const q of queries) q.removeEventListener("change", onChange);
      queries = null;
    }
  };
}

export function getSiteMotion(): SiteMotionState {
  if (typeof window === "undefined") return SERVER;
  // subscribed: the change listener keeps the snapshot current; not subscribed: read the queries now
  if (!queries || !snapshot) snapshot = keep(read());
  return snapshot;
}

/** reuse the cached object when nothing changed, so useSyncExternalStore sees a stable snapshot */
function keep(next: SiteMotionState): SiteMotionState {
  return snapshot && same(snapshot, next) ? snapshot : next;
}

export function getServerSiteMotion(): SiteMotionState {
  return SERVER;
}
