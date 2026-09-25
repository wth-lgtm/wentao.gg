// Keep-your-place (DESIGN §4.2.3): ONE correction per trigger, for the whole page. A mode switch (a resize across
// the pin gate, Reduce Motion toggled with the page open, a list that no longer fits its band) changes a pinned
// chapter's height by hundreds of pixels, and everything below it moves. The ChapterDirector snapshots one
// reading place from the layout still on screen, flips every chapter's mode in one commit, then applies one
// instant scrollTo computed here. Pure: the director measures, this decides.
//
//   Where the reader was                           Where the correction puts them
//   inside chapter C, and C changed to flow/static  C's shown row on the reading line
//   inside chapter C, and C changed to pinned       pinAtBeat(shown) in C
//   outside every chapter (or C unchanged)          the element at the viewport centre keeps its viewport top
//   above every chapter that changed                nothing moves (that element's page top did not change)

import { pinAtBeat, type ChapterLayout } from "./chapterList";

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
  chapters: readonly ChapterBox[];
  /** each chapter's displayed beat (−1 when nothing is marked) */
  shown: Readonly<Record<string, number>>;
  /** the element at the viewport centre (outside every chapter where possible), as a key and its page top */
  centre: { key: string; pageTop: number } | null;
}

export type Place =
  | { kind: "chapter"; id: string; beat: number; mode: ChapterMode; fallback: { key: string; viewportTop: number } | null }
  | { kind: "element"; key: string; viewportTop: number }
  | { kind: "none" };

export function snapshotPlace(input: PlaceInput): Place {
  const centreY = input.scrollY + input.viewportH / 2;
  const fallback = input.centre ? { key: input.centre.key, viewportTop: input.centre.pageTop - input.scrollY } : null;
  const c = input.chapters.find((ch) => centreY >= ch.top && centreY < ch.top + ch.height);
  const beat = c ? input.shown[c.id] ?? -1 : -1;
  if (c && beat >= 0) return { kind: "chapter", id: c.id, beat, mode: c.mode, fallback };
  if (fallback) return { kind: "element", ...fallback };
  return { kind: "none" };
}

export interface AfterInput {
  chapters: readonly ChapterBox[];
  /** the page top, in the NEW layout, of the element a snapshot keyed; null if it is gone */
  pageTopOf(key: string): number | null;
  /** the reading line in viewport px (flow mode) */
  readingLine: number;
}

/** The scrollY that keeps the reader's place in the new layout, or null for "do not move". */
export function correctPlace(place: Place, after: AfterInput): number | null {
  if (place.kind === "none") return null;
  if (place.kind === "chapter") {
    const ch = after.chapters.find((c) => c.id === place.id);
    if (ch && ch.mode !== place.mode) {
      if (ch.mode === "pinned") return Math.max(0, ch.top + pinAtBeat(place.beat, ch.layout) * Math.max(0, ch.height - ch.stageHeight));
      const rowTop = ch.beatTops[place.beat];
      return rowTop === undefined ? Math.max(0, ch.top) : Math.max(0, rowTop - after.readingLine);
    }
    if (!place.fallback) return null;
    const top = after.pageTopOf(place.fallback.key);
    return top === null ? null : Math.max(0, top - place.fallback.viewportTop);
  }
  const top = after.pageTopOf(place.key);
  return top === null ? null : Math.max(0, top - place.viewportTop);
}
