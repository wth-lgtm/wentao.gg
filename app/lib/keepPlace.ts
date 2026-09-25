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
// across when its top ≤ the line) marks the same entry after the flip as before it. "The line" is a flow list's
// TRAVELLING line (chapterList.flowLine: the page's line, bent to the list's first row near its section's top), so
// the landing is solved in scroll space through flowScrollFor, where the bend is exact. A row landed exactly on the
// line with fractional tops ended a fraction of a pixel below it once the scroll was rounded, and the previous entry
// lit (Cherre → Meta on a 1440 → 960 resize, CMU → UPenn over a Reduce Motion round trip); a rotation kept a px
// offset taller than the entry's new height and lit the next one. Flow and static are both normal flow, so a switch
// between them keeps the reader's offset: the text under their eye does not move (it moved 69–167 px on a phone).
//   outside every chapter                              the element at the viewport centre keeps its viewport top
//   above every chapter that changed                   nothing moves (that element's page top did not change)

import { STAGE_CLEAR, flowLine, flowScrollFor, pinAtBeat, readingLineActive, type ChapterLayout } from "./chapterList";

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
  /** page y of the list's last row's bottom: a flow list stays engaged (its last row marked) while this is below
   *  STAGE_CLEAR.top, so a kept row keeps it there */
  listBottom?: number;
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
  /** `marked`: the beat is the one on screen (shown), not the row the reading line stands in with; `across`: the row
   *  was marked or across its list's travelling line; `viewTop`: the row's viewport top when the place was taken;
   *  `rowOffset`: that top less the page's reading line; `lineOffset`: less the list's travelling line */
  | { kind: "chapter"; id: string; beat: number; mode: ChapterMode; pin: number | null; rowOffset: number; lineOffset: number; marked: boolean; across: boolean; viewTop: number }
  | { kind: "element"; key: string; viewportTop: number }
  | { kind: "none" };

/** a flow (or static) chapter's travelling reading line at `scrollY`, viewport px (chapterList.flowLine) */
export function flowLineOf(ch: ChapterBox, scrollY: number, line: number): number {
  return flowLine(scrollY - ch.top, (ch.beatTops[0] ?? ch.top) - ch.top, line);
}

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
  // (the travelling line: the row the flow gate would mark here, in a static still too)
  const lineHere = c && c.mode !== "pinned" && c.beatTops.length > 0 ? flowLineOf(c, input.scrollY, input.readingLine) : input.readingLine;
  if (c && beat < 0 && (c.mode === "static" || c.mode === "flow") && c.beatTops.length > 0) {
    beat = Math.max(0, readingLineActive(c.beatTops.map((t) => t - input.scrollY), lineHere, -1));
  }
  if (c && beat >= 0) {
    const rowTop = (c.beatTops[beat] ?? c.top) - input.scrollY;
    return { kind: "chapter", id: c.id, beat, mode: c.mode, pin: c.mode === "pinned" ? pinOf(c, input.scrollY) : null, rowOffset: rowTop - input.readingLine, lineOffset: rowTop - lineHere, marked, across: marked || rowTop <= lineHere, viewTop: rowTop };
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
    // a row at or above the travelling line, or a pinned chapter's shown row
    const across = place.across || !same;
    // and the list's bottom stays below the top clear band, so a flow list still marks the kept row
    const keepOn = ch.listBottom === undefined ? -Infinity : STAGE_CLEAR.top + LAND_PX - (ch.listBottom - rowTop);
    // the wanted scroll: from normal flow, the row at its old offset from the travelling line (on the bend's flat
    // piece, where every scroll keeps that offset, the one nearest its old offset from the page's line); from pinned,
    // the row onto the line
    const top = ch.top, o0 = (ch.beatTops[0] ?? top) - top, ok = rowTop - top;
    let uWant = flowScrollFor(ok, o0, line, "first");
    if (same) {
      const t = ok - place.lineOffset;
      uWant = Math.min(flowScrollFor(t, o0, line, "last"), Math.max(flowScrollFor(t, o0, line, "first"), ok - (line + place.rowOffset)));
    }
    const view = landRow({
      uWant, line, across,
      top, firstTop: top + o0, rowTop, nextTop: ch.beatTops[place.beat + 1],
      was: same ? place.viewTop : undefined, keepOn,
    });
    return Math.max(0, rowTop - view);
  }
  const top = after.pageTopOf(place.key);
  return top === null ? null : Math.max(0, top - place.viewportTop);
}

/** landRow's input: the wanted scroll and the page geometry of the kept row's chapter */
export interface RowLanding {
  /** the wanted scroll, as u: the section's top above the viewport's top */
  uWant: number;
  /** the page's reading line, viewport px */
  line: number;
  across: boolean;
  /** page y of the section's top, the list's first row, the kept row and the next row (none for the last) */
  top: number;
  firstTop: number;
  rowTop: number;
  nextTop?: number;
  /** the row's viewport top before the flip (normal flow → normal flow), for the floor */
  was?: number;
  /** the least viewport top that keeps the list's bottom below the top clear band */
  keepOn?: number;
}

/**
 * The kept row's viewport top in the new layout. A row that was across the line (`across`: marked, or the row a
 * static still or an unmarked flow list reads at the line) stays the LAST row across it: LAND_PX of scroll past the
 * point it crosses the line, and LAND_PX of scroll short of the point its next row does (a px offset larger than
 * the entry's new height is clamped). A row that was still below the line stays LAND_PX of scroll short of it, so
 * nothing lights that was not lit. The line is the list's travelling line, so each bound is a scroll
 * (flowScrollFor) — margins in scroll, not in px against the line: inside the bend the line moves at twice the
 * scroll, and a 2 px margin there was one px of scroll, which the rounded scrollTo and one px of wheel ate. The
 * answer is the scroll nearest the wanted one that meets the bounds, ranked as they always were: across first, then
 * the floor and the next row.
 */
export function landRow(r: RowLanding): number {
  const o0 = r.firstTop - r.top, ok = r.rowTop - r.top;
  // u: the section's top above the viewport's top; the row's viewport top is ok − u
  const uWant = r.uWant;
  if (!r.across) return ok - Math.min(uWant, flowScrollFor(ok, o0, r.line, "last") - LAND_PX);
  const uAcross = flowScrollFor(ok, o0, r.line, "first") + LAND_PX;
  const uNext = r.nextTop === undefined ? Infinity : flowScrollFor(r.nextTop - r.top, o0, r.line, "last") - LAND_PX;
  // THE FLOOR. The kept row never lands higher than the reader had it. A phone reader with JST 408 px above a portrait
  // line kept that offset against the landscape line (242 px), and JST landed at −166: its list had gone under the
  // top clear band (the W. / INDEX marks, STAGE_CLEAR.top) and nothing was marked. So a row the reader had in view
  // stays at or below the band. A row that was already above the band (`was`, its viewport top before the flip:
  // Education's last row still marked while the list's bottom slides under the band, the reader already in
  // Projects) is floored where it was, not pulled down to the band. Pulling it down moved Projects' heading 38 to
  // 169 px on a window drag, a height-only resize or a rotation. `keepOn` keeps the list's bottom below the band,
  // so the kept row is still marked. `was` is undefined when the row is new to normal flow (from pinned): the band.
  const keepOn = r.keepOn ?? -Infinity;
  const floor = r.was === undefined ? STAGE_CLEAR.top : Math.max(keepOn, Math.min(STAGE_CLEAR.top, r.was));
  const uLow = Math.min(ok - floor, uNext);
  return ok - Math.max(uAcross, Math.min(uWant, Math.max(uLow, uAcross)));
}
