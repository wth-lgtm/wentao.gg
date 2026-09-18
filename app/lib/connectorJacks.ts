// The card's second reading of its own data: what the twelve floating connector jacks
// beside the activity grid are allowed to claim. Kept pure so every rule — one jack per
// week, size from commits, which weeks the route's paging left UNKNOWN, the fixed casting
// — can be tested without a DOM or a WebGL context.

import type { CommitDay } from "./githubStats";
import { rand } from "./seed";

export type Family = "accent" | "white" | "black";
export type Finish = "matte" | "glossy";

export interface Jack {
  /** the week's first UTC day */
  week: string;
  /** commits summed over the week's seven days — 0 for an unknown week is not a count */
  commits: number;
  /** false when the route's paging cut off before this week began */
  known: boolean;
  /** mesh scale, SCALE_MIN..SCALE_MIN + SCALE_SPAN; the body radius is 1.05·scale */
  scale: number;
  family: Family;
  finish: Finish;
}

/**
 * One seed for the casting, the spawn, the orientations and the click kicks. Of seeds 1–60,
 * 9 is the shuffle with the fewest adjacent same-family pairs (one) and no two glossies side
 * by side; Lusion's own 'balloon24' put the twelve into three family blocks, which — with
 * the pull targets x-ordered by week — read as a sorted row, not a mixed set.
 */
export const SEED = 9;
/**
 * A quiet week is 0.86 of a unit jack and the busiest 1.2 — a 1.4× diameter ratio, the
 * most size can carry beside perspective across the pack's z ±1.6 (0.88–1.15×) without
 * a far busy jack reading smaller than a near quiet one. Relative to the busiest KNOWN
 * week, so equal commits are always equal sizes: an all-equal window is twelve ceilings
 * and an all-zero one twelve floors.
 */
export const SCALE_MIN = 0.86;
export const SCALE_SPAN = 0.34;

// Lusion's set is two-thirds matte (16 rough : 6 glossy : 2 glass of 24); twelve gives
// 8 : 4, with the single glossy accent and the single glossy white as the highlights and
// two glossy blacks, which read only through what they reflect.
const CASTING: readonly { family: Family; finish: Finish }[] = [
  { family: "accent", finish: "matte" },
  { family: "accent", finish: "matte" },
  { family: "accent", finish: "matte" },
  { family: "accent", finish: "glossy" },
  { family: "white", finish: "matte" },
  { family: "white", finish: "matte" },
  { family: "white", finish: "matte" },
  { family: "white", finish: "glossy" },
  { family: "black", finish: "matte" },
  { family: "black", finish: "matte" },
  { family: "black", finish: "glossy" },
  { family: "black", finish: "glossy" },
];

/**
 * The casting by week index: the twelve roles above, shuffled once with `rand(i, seed)`
 * (Fisher–Yates, the swap partner drawn per position). Never data — colour and finish
 * would otherwise read as an encoding the legend does not state.
 */
export function castingFor(n: number, seed: number): { family: Family; finish: Finish }[] {
  const cast = Array.from({ length: n }, (_, i) => CASTING[i % CASTING.length]);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand(i, seed) * (i + 1));
    [cast[i], cast[j]] = [cast[j], cast[i]];
  }
  return cast;
}

/**
 * The debug override, from location.search: how many of the oldest weeks the card draws as
 * ghosts (the unknown-week glass, jackGlass.ts) on a payload that has no cut — N only with
 * ?jacksDebug present AND jacksUnknown=N, a positive integer; 0 otherwise. The legend does
 * not follow it: a lever for seeing the ghost, not a claim about the data.
 */
export function unknownOverride(search: string): number {
  const q = new URLSearchParams(search);
  if (!q.has("jacksDebug")) return 0;
  const n = Number(q.get("jacksUnknown"));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * One jack per week of the board's window, oldest first. `days` is the same array the
 * board draws (buildDayWindow, `weeks × 7` days), so a stale snapshot aligns both readings.
 *
 * Truncation: the route pages newest-first and keeps the pages in hand, so the known
 * region is [oldest dated commit, snapshot] and only days BEFORE the oldest dated commit
 * are unknown. A week is known iff it starts on or after that day; the week containing
 * it is partial and therefore unknown. The inverse rule — "older than the NEWEST commit"
 * — marked eleven of twelve weeks unknown on every truncated payload.
 */
export function jacksForWeeks(days: readonly CommitDay[], weeks: number, truncated: boolean, seed: number): Jack[] {
  let minKnown: string | null = null;
  if (truncated) {
    for (const d of days) if (d.count > 0 && (minKnown === null || d.date < minKnown)) minKnown = d.date;
  }
  const cast = castingFor(weeks, seed);
  const rows: { week: string; commits: number; known: boolean }[] = [];
  for (let w = 0; w < weeks; w++) {
    const slice = days.slice(w * 7, w * 7 + 7);
    if (slice.length === 0) break;
    const known = !truncated || (minKnown !== null && slice[0].date >= minKnown);
    rows.push({ week: slice[0].date, commits: known ? slice.reduce((n, d) => n + d.count, 0) : 0, known });
  }
  const max = rows.reduce((m, r) => (r.known ? Math.max(m, r.commits) : m), 0);
  return rows.map((r, i) => ({
    ...r,
    scale: r.known && max > 0 ? SCALE_MIN + (SCALE_SPAN * r.commits) / max : SCALE_MIN,
    family: cast[i].family,
    finish: cast[i].finish,
  }));
}
