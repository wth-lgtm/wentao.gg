// Keep-your-place (DESIGN §4.2.3): ONE correction per trigger, for the whole page. A mode switch (a resize across
// the pin gate, Reduce Motion toggled with the page open, a list that no longer fits its band) changes a pinned
// chapter's height by hundreds of pixels, and everything below it moves; a resize alone reflows every row. The
// ChapterDirector keeps one reading place — taken from the layout on screen before a switch, or at the last
// scroll rest before a resize (svh units have already moved by the time a resize event runs) — flips every
// chapter's mode in one commit, then applies one instant scrollTo computed here. Pure: the director measures,
// this decides.
//
//   Where the reader was                               Where the correction puts them
//   inside chapter C, which is (still) pinned          the same pin in C (the same entry, the same instant)
//   inside chapter C, which just became pinned         pinAtBeat(shown) in C
//   inside chapter C, which just flowed or went static C's shown row on the reading line
//   inside chapter C, still in flow / static           C's shown row at the same offset from the reading line
//   (nothing marked in a static or flow C)             the row on the reading line stands in for the shown row
//   outside every chapter                              the element at the viewport centre keeps its viewport top
//   above every chapter that changed                   nothing moves (that element's page top did not change)

import { pinAtBeat, readingLineActive, type ChapterLayout } from "./chapterList";

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
  | { kind: "chapter"; id: string; beat: number; mode: ChapterMode; pin: number | null; rowOffset: number }
  | { kind: "element"; key: string; viewportTop: number }
  | { kind: "none" };

function pinOf(ch: ChapterBox, scrollY: number): number {
  const travel = ch.height - ch.stageHeight;
  if (!(travel > 0)) return 0;
  return Math.min(1, Math.max(0, (scrollY - ch.top) / travel));
}

export function snapshotPlace(input: PlaceInput): Place {
  const centreY = input.scrollY + input.viewportH / 2;
  const c = input.chapters.find((ch) => centreY >= ch.top && centreY < ch.top + ch.height);
  let beat = c ? input.shown[c.id] ?? -1 : -1;
  // nothing marked in a static or flow chapter (the static still marks nothing; a flow list may be disengaged): the
  // entry being read is the row on the reading line, from the cached row tops — so leaving static mid-chapter
  // (Reduce Motion or forced colours turned off) keeps the entry the reader was on, not the chapter's first
  if (c && beat < 0 && (c.mode === "static" || c.mode === "flow") && c.beatTops.length > 0) {
    beat = Math.max(0, readingLineActive(c.beatTops.map((t) => t - input.scrollY), input.readingLine, -1));
  }
  if (c && beat >= 0) {
    const rowTop = (c.beatTops[beat] ?? c.top) - input.scrollY;
    return { kind: "chapter", id: c.id, beat, mode: c.mode, pin: c.mode === "pinned" ? pinOf(c, input.scrollY) : null, rowOffset: rowTop - input.readingLine };
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
    const offset = place.mode === ch.mode ? place.rowOffset : 0;
    return Math.max(0, rowTop - after.readingLine - offset);
  }
  const top = after.pageTopOf(place.key);
  return top === null ? null : Math.max(0, top - place.viewportTop);
}
