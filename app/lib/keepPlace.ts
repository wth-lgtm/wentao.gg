// Keep-your-place (DESIGN §4.2.3): ONE correction per trigger, for the whole page. A mode switch (a resize across
// the pin gate, Reduce Motion toggled with the page open, a list that no longer fits its band) changes a pinned
// chapter's height by hundreds of pixels, and everything below it moves; a resize alone reflows every row. The
// ChapterDirector keeps one reading place — taken from the layout on screen before a switch, or at the last
// scroll rest before a resize (svh units have already moved by the time a resize event runs) — flips every
// chapter's mode in one commit, then applies one instant scrollTo computed here. Pure: the director measures,
// this decides.
//
//   Where the reader was (the marked chapter, else the one at the viewport's centre)  Where the correction puts them
//   inside chapter C, which is (still) pinned          the same pin in C (the same entry, the same instant)
//   inside chapter C, which just became pinned         pinAtBeat(shown) in C
//   inside chapter C, which just flowed (from pinned)  C's shown row just past the reading line (LAND_PX above it)
//   inside chapter C, flow ↔ static or still in either C's shown row at the same offset from the reading line
//   (nothing marked in a static or flow C)             the row on the reading line stands in for the shown row
//
// THE MARKED ENTRY IS THE PLACE. Wherever a row lands, it lands as the LAST row across the line in the new layout —
// at least LAND_PX above the line and more than LAND_PX above the next row's top — so the flow gate (a row is
// across when its top ≤ the line) marks the same entry after the flip as before it. A row landed exactly on the
// line with fractional tops ended a fraction of a pixel below it once the scroll was rounded, and the previous entry
// lit (Cherre → Meta on a 1440 → 960 resize, CMU → UPenn over a Reduce Motion round trip); a rotation kept a px
// offset taller than the entry's new height and lit the next one. Flow and static are both normal flow, so a switch
// between them keeps the reader's offset: the text under their eye does not move (it moved 69–167 px on a phone).
//   outside every chapter                              the element at the viewport centre keeps its viewport top
//   above every chapter that changed                   nothing moves (that element's page top did not change)

import { STAGE_CLEAR, pinAtBeat, readingLineActive, type ChapterLayout } from "./chapterList";

/** px: a kept row lands at least this far past the reading line, and this far clear of the next row's top */
export const LAND_PX = 2;

export type ChapterMode = "pinned" | "flow" | "static";

export interface ChapterBox {
  id: string;
  /** page y of the section's top */
  top: number;
  height: number;
  mode: ChapterMode;
  /** the stage's cached clientHeight (pinned travel = height − stageHeight) */
  stageHeight: number;
  /** page y of each beat's row */
  beatTops: readonly number[];
  layout: ChapterLayout;
}

export interface PlaceInput {
  scrollY: number;
  viewportH: number;
  /** the reading line, viewport px */
  readingLine: number;
  chapters: readonly ChapterBox[];
  /** each chapter's displayed beat (−1 when nothing is marked) */
  shown: Readonly<Record<string, number>>;
  /** the element at the viewport centre (outside every chapter), as a key and its page top */
  centre: { key: string; pageTop: number } | null;
}

export type Place =
  /** `marked`: the beat is the one on screen (shown), not the row the reading line stands in with */
  | { kind: "chapter"; id: string; beat: number; mode: ChapterMode; pin: number | null; rowOffset: number; marked: boolean }
  | { kind: "element"; key: string; viewportTop: number }
  | { kind: "none" };

function pinOf(ch: ChapterBox, scrollY: number): number {
  const travel = ch.height - ch.stageHeight;
  if (!(travel > 0)) return 0;
  return Math.min(1, Math.max(0, (scrollY - ch.top) / travel));
}

export function snapshotPlace(input: PlaceInput): Place {
  const centreY = input.scrollY + input.viewportH / 2;
  // the MARKED chapter first: the reader's eye is at its mark (the reading line, or the docked stage), and the
  // viewport's centre can already sit in the next chapter — a phone with JST marked just past the 62 % line had its
  // centre in Education, which kept an unmarked Education row, and after a rotation nothing was marked at all.
  // Otherwise the chapter that contains the centre.
  const c = input.chapters.find((ch) => (input.shown[ch.id] ?? -1) >= 0)
    ?? input.chapters.find((ch) => centreY >= ch.top && centreY < ch.top + ch.height);
  let beat = c ? input.shown[c.id] ?? -1 : -1;
  const marked = beat >= 0;
  // nothing marked in a static or flow chapter (the static still marks nothing; a flow list may be disengaged): the
  // entry being read is the row on the reading line, from the cached row tops — so leaving static mid-chapter
  // (Reduce Motion or forced colours turned off) keeps the entry the reader was on, not the chapter's first
  if (c && beat < 0 && (c.mode === "static" || c.mode === "flow") && c.beatTops.length > 0) {
    beat = Math.max(0, readingLineActive(c.beatTops.map((t) => t - input.scrollY), input.readingLine, -1));
  }
  if (c && beat >= 0) {
    const rowTop = (c.beatTops[beat] ?? c.top) - input.scrollY;
    return { kind: "chapter", id: c.id, beat, mode: c.mode, pin: c.mode === "pinned" ? pinOf(c, input.scrollY) : null, rowOffset: rowTop - input.readingLine, marked };
  }
  if (input.centre) return { kind: "element", key: input.centre.key, viewportTop: input.centre.pageTop - input.scrollY };
  return { kind: "none" };
}

export interface AfterInput {
  chapters: readonly ChapterBox[];
  /** the page top, in the NEW layout, of the element a snapshot keyed; null if it is gone */
  pageTopOf(key: string): number | null;
  /** the reading line in viewport px, in the new layout */
  readingLine: number;
}

/** The scrollY that keeps the reader's place in the new layout, or null for "do not move". */
export function correctPlace(place: Place, after: AfterInput): number | null {
  if (place.kind === "none") return null;
  if (place.kind === "chapter") {
    const ch = after.chapters.find((c) => c.id === place.id);
    if (!ch) return null;
    const travel = Math.max(0, ch.height - ch.stageHeight);
    if (ch.mode === "pinned") {
      const pin = place.mode === "pinned" && place.pin !== null ? place.pin : pinAtBeat(place.beat, ch.layout);
      return Math.max(0, ch.top + pin * travel);
    }
    const rowTop = ch.beatTops[place.beat];
    if (rowTop === undefined) return Math.max(0, ch.top);
    // flow and static are both normal flow (the new mode is one of them here): from either, the row keeps its offset
    const same = place.mode !== "pinned";
    const line = after.readingLine;
    // across the line: the marked row (a row held by the reading line's hysteresis may sit up to 24 px below it),
    // a row at or above the line, or a pinned chapter's shown row
    const across = place.marked || place.rowOffset <= 0 || !same;
    const view = landRow(line + (same ? place.rowOffset : 0), line, across, ch.beatTops[place.beat + 1], rowTop);
    return Math.max(0, rowTop - view);
  }
  const top = after.pageTopOf(place.key);
  return top === null ? null : Math.max(0, top - place.viewportTop);
}

/**
 * The kept row's viewport top in the new layout. A row that was across the line (`across`: marked, or the row a
 * static still or an unmarked flow list reads at the line) stays the LAST row across it: at least LAND_PX above the line, and its next row's top at least
 * LAND_PX below the line (a px offset larger than the entry's new height is clamped). A row that was
 * still below the line stays at least LAND_PX below it, so nothing lights that was not lit.
 */
export function landRow(view: number, line: number, across: boolean, nextTop: number | undefined, rowTop: number): number {
  if (!across) return Math.max(view, line + LAND_PX);
  const hi = line - LAND_PX;
  // and never above the top clear band (the W. / INDEX marks, STAGE_CLEAR.top): a phone reader with JST 408 px above
  // a portrait line kept that offset against the landscape line (242 px) and JST landed at −166, its list gone
  // under the band, nothing marked. The kept row is the one the reader was reading, so it stays in view.
  const lo = Math.max(STAGE_CLEAR.top, nextTop === undefined ? -Infinity : line - (nextTop - rowTop) + LAND_PX);
  return Math.min(hi, Math.max(view, Math.min(lo, hi)));
}
