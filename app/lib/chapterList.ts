// THE READING CHAPTERS' engine (DESIGN §4.2.1): the owner's highlighted list — "the scrolling animation could be
// added to the experience, education as well as projects section so it has a highlighted bullet point list
// animation like you implemented on augnition's website". Augnition's pinned facts panel
// (sequence-timeline.ts: activeFactAt over a raw chapterPin) rebuilt in ESCAPEMENT for this site's glass.
// Pure; imports nothing; every rule runs in node (tests/chapter-list.test.ts, reading-line, riffle).
//
// ONE SOURCE, ONE DISPLAYED STATE. The target beat is `activeItemAt(raw pin)` (pinned) or
// `readingLineActive(cached row tops)` (flow) — never a damped value. What every display shows is `shown`,
// the committed beat (chapterCommit.ts), which follows the target one beat per 100 ms lattice tick (the
// catch-up riffle), so no two displays disagree in any frame and no row is skipped. Only the rail's fill runs
// free, and never past the next row that has not committed (`headClamp`).
//
// Entries, not bullets (owner, 2026-09-24): "for the bullet points we can keep them empty for now. We just need
// to list the individual experiences and job titles". Experience and Education light ENTRY BY ENTRY — each
// entry is one beat (its layout is all ones, derived from the data in app/lib/content/*). The engine keeps
// the general item/sub shape because Projects (PR 2) lights two rows per project.

/** Scroll per beat, in viewport heights: ≥ Augnition's FACT_BEAT_VH 9 (a test holds ≥ 9), so one wheel notch or a flick never lands past a row unseen. */
export const ITEM_BEAT_VH = 10;
/** extra dwell on the first row while the stage docks */
export const LEAD_VH = 15;
/** extra dwell on the last row before the stage releases */
export const TAIL_VH = 15;
/** Augnition's proven pin gate (the LC graft; 600 refused) */
export const PIN_MIN = { width: 700, height: 720 } as const;
/** THE one media text for "may pin"; tests/pin-query.test.ts holds it equal to app/chapter.css */
export const PIN_QUERY =
  "screen and (prefers-reduced-motion: no-preference) and (forced-colors: none) and (min-width: 700px) and (min-height: 720px)";
/** px: the stage's padding — under the W. / INDEX marks, and above the fold */
export const STAGE_CLEAR = { top: 96, bottom: 40 } as const;
/** 700–1023 px wide, the pinned stage is one column: a compact dial row (72 px, app/chapter.css) and a 16 px gap come off the band */
export const DIAL_ROW_PX = 72 + 16;
/** the width from which the pinned stage has two columns (the dial beside the panel) */
export const TWO_COLUMN_MIN = 1024;
/** pin only with ≥ 16 px spare in the band; unpin at > 0 px overflow (hysteresis, E1) */
export const PIN_SLACK_PX = 16;
/** flow mode: the reading line, as a fraction of the cached client height (the small viewport on iOS) */
export const READING_LINE = 0.62;
export const HYSTERESIS_PX = 24;
/** px/s; above it the riffle holds and resumes once the reader slows (§3.3) */
export const COMMIT_MAX_V = 3000;
/**
 * More than this many beats between `shown` and the target and a step jumps to one short of the target, then
 * steps the last one (an anchor jump from far away). 4, recomputed for the entry-by-entry chapters: the longest
 * move inside Experience (five entries) is 4 beats, so once a chapter has docked nothing inside it is ever
 * skipped — a PageDown through the whole list riffles every entry in turn. (The brief's 3 assumed ten-beat
 * chapters.) Docking itself (nothing shown yet) lands on the target directly.
 */
export const RIFFLE_JUMP = 4;

/** Subs (beats) per item, derived from content data, never typed by hand (tests/content.test.ts holds this). */
export type ChapterLayout = readonly number[];
/** beat = the global index 0..beats − 1; item/sub locate it */
export interface Active { item: number; sub: number; beat: number }

/** Which chapters pin (OC-P, the owner's call at its recommended default: Experience + Projects pinned, Education in flow). */
export const PIN_CHAPTERS: Readonly<Record<string, boolean>> = { experience: true, education: false, projects: true };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const subsOf = (n: number) => Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));

export function beatCount(layout: ChapterLayout): number {
  let n = 0;
  for (const s of layout) n += subsOf(s);
  return n;
}

/** the scroll the pinned stage holds, in vh: lead + beats + tail */
export function heldVh(layout: ChapterLayout): number {
  return LEAD_VH + TAIL_VH + beatCount(layout) * ITEM_BEAT_VH;
}

/** The pinned section's height in svh: 100 (the stage) + the held scroll. The server writes it inline, so the first paint never shifts. */
export function chapterVh(layout: ChapterLayout): number {
  return 100 + heldVh(layout);
}

/**
 * Augnition's pinProgress, over the STAGE's cached clientHeight (100svh), not innerHeight (E7): 0 when the
 * section's top meets the viewport top, 1 when its bottom meets the stage's bottom.
 */
export function chapterPin(sectionTop: number, sectionHeight: number, stageHeight: number): number {
  const travel = sectionHeight - stageHeight;
  if (!(travel > 0)) return sectionTop <= 0 ? 1 : 0;
  const p = -sectionTop / travel;
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

/** item and sub of a global beat (clamped into the layout) */
export function beatToActive(beat: number, layout: ChapterLayout): Active {
  const total = beatCount(layout);
  if (total === 0) return { item: -1, sub: -1, beat: -1 };
  let b = Math.min(total - 1, Math.max(0, Math.floor(beat)));
  const out = b;
  for (let item = 0; item < layout.length; item++) {
    const n = subsOf(layout[item]);
    if (b < n) return { item, sub: b, beat: out };
    b -= n;
  }
  return { item: layout.length - 1, sub: subsOf(layout[layout.length - 1]) - 1, beat: total - 1 };
}

/** the global beat of (item, sub) */
export function beatOf(item: number, sub: number, layout: ChapterLayout): number {
  let b = 0;
  for (let i = 0; i < item && i < layout.length; i++) b += subsOf(layout[i]);
  return b + Math.max(0, Math.min(subsOf(layout[item] ?? 1) - 1, sub));
}

/** the pin at which beat k's scroll slot begins (beat 0's nominal slot begins after the lead) */
export function beatStart(beat: number, layout: ChapterLayout): number {
  return (LEAD_VH + beat * ITEM_BEAT_VH) / heldVh(layout);
}

/**
 * THE one source. Pinned mode: beat 0 through the lead and its own slot, then one beat per ITEM_BEAT_VH, the
 * last beat through its slot and the tail — so pin 0 marks the first row, pin 1 the last, and it is never −1.
 */
export function activeItemAt(pin: number, layout: ChapterLayout): Active {
  const total = beatCount(layout);
  if (total === 0) return { item: -1, sub: -1, beat: -1 };
  const p = Number.isFinite(pin) ? clamp01(pin) : 0;
  const into = p * heldVh(layout) - LEAD_VH;
  const beat = Math.min(total - 1, Math.max(0, Math.floor(into / ITEM_BEAT_VH + 1e-9)));
  return beatToActive(beat, layout);
}

/** Inverse: the pin at the MIDDLE of beat k's slot (keyboard focus, keep-your-place, anchors, tests). */
export function pinAtBeat(beat: number, layout: ChapterLayout): number {
  const total = beatCount(layout);
  const b = Math.min(Math.max(0, Math.floor(beat)), Math.max(0, total - 1));
  return clamp01((LEAD_VH + (b + 0.5) * ITEM_BEAT_VH) / heldVh(layout));
}

/**
 * The raw rail head in px from the rail's top: piecewise-linear through (0, 0), (beatStart(k), rowYs[k]) for
 * every beat, and (1, railLength) — continuous in pin, meeting row k exactly as beat k's slot begins.
 */
export function railHeadAt(pin: number, layout: ChapterLayout, rowYs: readonly number[], railLength: number): number {
  const total = Math.min(beatCount(layout), rowYs.length);
  const p = Number.isFinite(pin) ? clamp01(pin) : 0;
  let x0 = 0, y0 = 0;
  for (let k = 0; k <= total; k++) {
    const x1 = k < total ? beatStart(k, layout) : 1;
    const y1 = k < total ? rowYs[k] : railLength;
    if (p <= x1) return x1 > x0 ? y0 + ((y1 - y0) * (p - x0)) / (x1 - x0) : y1;
    x0 = x1; y0 = y1;
  }
  return railLength;
}

/** The displayed head: never past the next row that has not committed (E2). `shown` −1 (nothing marked) holds it above the first row. */
export function headClamp(rawHead: number, rowYs: readonly number[], shown: number): number {
  const next = shown + 1;
  return next >= 0 && next < rowYs.length ? Math.min(rawHead, rowYs[next]) : rawHead;
}

/**
 * The next displayed beat on a lattice tick: dock straight onto the target when nothing is shown yet, otherwise
 * one step toward it — or, more than RIFFLE_JUMP away, to one short of it (the last row still steps).
 */
export function riffleStep(shown: number, target: number): number {
  if (target < 0) return -1;
  if (shown < 0 || shown === target) return target;
  const d = target - shown;
  if (Math.abs(d) > RIFFLE_JUMP) return target - Math.sign(d);
  return shown + Math.sign(d);
}

/**
 * Flow mode: the last row whose top has crossed `line` (viewport px). Forward immediately; backward only once
 * the held row's top has moved HYSTERESIS_PX below the line, so a row resting on the line never flickers.
 * −1 above the first row.
 */
export function readingLineActive(rowTops: readonly number[], line: number, prev: number): number {
  let fwd = -1, back = -1;
  for (let k = 0; k < rowTops.length; k++) {
    if (rowTops[k] <= line) fwd = k;
    if (rowTops[k] <= line + HYSTERESIS_PX) back = k;
  }
  if (prev < 0 || fwd >= prev) return fwd;
  return Math.max(fwd, Math.min(prev, back));
}

/** the reading line in px for a cached client height */
export function readingLineFor(clientHeight: number): number {
  return Math.round(READING_LINE * clientHeight);
}

/**
 * The reading line, refreshed only on a WIDTH (or orientation) change: iOS's toolbars change innerHeight by
 * 50–80 px as they collapse, and a line that moved with them would flip still rows (E7, O17).
 */
export function createReadingLine(): { at(width: number, clientHeight: number): number } {
  let width = Number.NaN;
  let line = 0;
  return {
    at(w, h) {
      if (w !== width) { width = w; line = readingLineFor(h); }
      return line;
    },
  };
}

/**
 * Band fit with hysteresis (E1). band = stage − 96 − 40 − `extra` (the compact dial row at 700–1023 px). A chapter
 * that is pinned stays pinned while its list fits the band; one that is not pins only with PIN_SLACK_PX to spare.
 */
export function bandFits(listHeight: number, stageHeight: number, pinnedNow: boolean, extra = 0): boolean {
  const band = stageHeight - STAGE_CLEAR.top - STAGE_CLEAR.bottom - extra;
  return pinnedNow ? listHeight <= band : listHeight <= band - PIN_SLACK_PX;
}

/** Review builds only (NEXT_PUBLIC_REVIEW_FLAGS=1): ?pin=exp,edu,proj (or ?pin=none) overrides the pin set. */
export function pinSetFromFlag(search: string): Readonly<Record<string, boolean>> | null {
  const v = new URLSearchParams(search).get("pin");
  if (v === null) return null;
  const ids = v.split(",").map((s) => s.trim().toLowerCase());
  const has = (short: string, long: string) => ids.includes(short) || ids.includes(long);
  return { experience: has("exp", "experience"), education: has("edu", "education"), projects: has("proj", "projects") };
}
