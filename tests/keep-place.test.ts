import { test } from "node:test";
import assert from "node:assert/strict";

import { LAND_PX, correctPlace, snapshotPlace, type ChapterBox, type ChapterMode } from "../app/lib/keepPlace";
import { HYSTERESIS_PX, STAGE_CLEAR, pinAtBeat, readingLineActive } from "../app/lib/chapterList";
import { EXPERIENCE_LAYOUT } from "../app/lib/content/experience";
import { EDUCATION_LAYOUT } from "../app/lib/content/education";

// 1440 × 900: the hero 900 tall; Experience pinned at 180 svh (1620 px), Education in flow (≈ 500 px); below
// them Projects. At 1440 × 700 Experience flows (≈ 760 px, rows 150 px apart).
const exPinned: ChapterBox = { id: "experience", top: 900, height: 1620, mode: "pinned", stageHeight: 900, beatTops: [1200, 1290, 1380, 1470, 1560], layout: EXPERIENCE_LAYOUT };
const edFlow: ChapterBox = { id: "education", top: 2520, height: 500, mode: "flow", stageHeight: 900, beatTops: [2640, 2740], layout: EDUCATION_LAYOUT };
const exFlow: ChapterBox = { id: "experience", top: 700, height: 760, mode: "flow", stageHeight: 700, beatTops: [860, 1010, 1160, 1310, 1460], layout: EXPERIENCE_LAYOUT };
const edFlowShort: ChapterBox = { ...edFlow, top: 1460, beatTops: [1580, 1680] };
const snap = (scrollY: number, viewportH: number, chapters: ChapterBox[], shown: Record<string, number>, centre: { key: string; pageTop: number } | null = null) =>
  snapshotPlace({ scrollY, viewportH, readingLine: Math.round(0.62 * viewportH), chapters, shown, centre });

test("inside a chapter that goes pinned → flow: its shown row lands just past the reading line (LAND_PX above it)", () => {
  const scrollY = 900 + pinAtBeat(3, EXPERIENCE_LAYOUT) * (1620 - 900);
  const place = snap(scrollY, 900, [exPinned, edFlow], { experience: 3, education: -1 });
  assert.equal(place.kind, "chapter");
  const y = correctPlace(place, { chapters: [exFlow, edFlowShort], pageTopOf: () => null, readingLine: 434 });
  assert.equal(y, 1310 - 434 + LAND_PX);
});

test("inside a chapter that goes flow → pinned: pinAtBeat(shown) in it", () => {
  const place = snap(1310 - 434, 700, [exFlow, edFlowShort], { experience: 3 });
  const y = correctPlace(place, { chapters: [exPinned, edFlow], pageTopOf: () => null, readingLine: 558 });
  assert.equal(y, 900 + pinAtBeat(3, EXPERIENCE_LAYOUT) * 720);
});

test("inside a chapter that stays pinned across a resize: the same pin (the same entry, the same instant)", () => {
  const place = snap(900 + 0.61 * 720, 900, [exPinned, edFlow], { experience: 3 });
  const exWider: ChapterBox = { ...exPinned, top: 780, height: 1404, stageHeight: 780 };
  const y = correctPlace(place, { chapters: [exWider, edFlow], pageTopOf: () => null, readingLine: 484 });
  assert.ok(Math.abs(y! - (780 + 0.61 * 624)) < 1e-9);
});

test("inside a flow chapter whose mode did not change (Experience above it flipped, or the window rotated): the shown row keeps its offset from the reading line", () => {
  // the reader is in Education, its row 0 is 20 px above the line; Experience above flips pinned → flow
  const scrollY = 2640 - 558 + 20;
  const place = snap(scrollY, 900, [exPinned, edFlow], { experience: -1, education: 0 });
  assert.equal(place.kind, "chapter");
  const y = correctPlace(place, { chapters: [exFlow, edFlowShort], pageTopOf: () => null, readingLine: 434 });
  assert.equal(y, 1580 - 434 + 20);
});

test("outside every chapter, below one that changed: the centre element keeps its viewport top (two chapters flipping in one trigger)", () => {
  const place = snap(3400, 900, [exPinned, edFlow], { experience: -1, education: -1 }, { key: "projects-row", pageTop: 3800 });
  assert.equal(place.kind, "element");
  const edStatic: ChapterBox = { ...edFlowShort, mode: "static" };
  // in the new layout everything below Experience moved up by 1620 − 760 + (900 − 700) = 1060
  const y = correctPlace(place, { chapters: [exFlow, edStatic], pageTopOf: (k) => (k === "projects-row" ? 3800 - 1060 : null), readingLine: 434 });
  assert.equal(y, 3400 - 1060);
});

test("above every chapter that changed: nothing moves", () => {
  const place = snap(0, 900, [exPinned, edFlow], {}, { key: "hero-h1", pageTop: 359 });
  const y = correctPlace(place, { chapters: [exFlow, edFlowShort], pageTopOf: () => 359, readingLine: 434 });
  assert.equal(y, 0, "the correction is the scroll the page already has");
});

test("a live Reduce Motion toggle mid-Education (flow → static, Experience pinned → static above it): Education's shown row keeps its offset from the reading line (flow and static are both normal flow)", () => {
  const scrollY = 2740 - 558 + 12; // row 1 is 12 px above the line
  const place = snap(scrollY, 900, [exPinned, edFlow], { experience: -1, education: 1 });
  const exStatic: ChapterBox = { ...exFlow, mode: "static", top: 900 };
  const edStatic: ChapterBox = { ...edFlow, mode: "static", top: 1660, beatTops: [1780, 1880] };
  const y = correctPlace(place, { chapters: [exStatic, edStatic], pageTopOf: () => null, readingLine: 558 });
  assert.equal(y, 1880 - 558 + 12, "the text under the reader's eye does not move");
});

test("leaving static mid-chapter (forced colours or Reduce Motion off → pinned): the entry on the reading line, not the chapter's first", () => {
  // static Experience at 1440 × 900 (nothing marked): the reader has JST's row (beat 4) just above the reading line
  const exStatic: ChapterBox = { ...exFlow, mode: "static", top: 900, height: 900, stageHeight: 900, beatTops: [1060, 1210, 1360, 1510, 1660] };
  const scrollY = 1660 - 558 + 15; // row 4 is 15 px above the line
  const place = snap(scrollY, 900, [exStatic, edFlow], { experience: -1, education: -1 });
  assert.equal(place.kind, "chapter");
  assert.equal(place.kind === "chapter" ? place.beat : -1, 4);
  const y = correctPlace(place, { chapters: [exPinned, edFlow], pageTopOf: () => null, readingLine: 558 });
  assert.equal(y, 900 + pinAtBeat(4, EXPERIENCE_LAYOUT) * 720, "pinned at JST's beat, not at the section top (pin 0, Mercor)");
});

test("nothing marked in a flow chapter whose rows are all still below the line: the first row stands in, at its own offset", () => {
  // the viewport centre (2525) is inside Education; its rows sit at 565 and 665, below the 558 line
  const place = snap(2075, 900, [exPinned, edFlow], { experience: -1, education: -1 }, { key: "x", pageTop: 2520 });
  assert.equal(place.kind, "chapter");
  assert.equal(place.kind === "chapter" ? place.beat : -1, 0);
  assert.equal(place.kind === "chapter" ? place.rowOffset : null, 2640 - 2075 - 558);
  // the same flow mode after the trigger: the row keeps that offset (nothing moves that did not move)
  assert.equal(correctPlace(place, { chapters: [exPinned, edFlow], pageTopOf: () => null, readingLine: 558 }), 2075);
});

// THE MARKED ENTRY AFTER A FLIP (review round 3): the flow gate marks the last row whose top is ≤ the line, and
// the director's instant scroll is rounded. Every correction must leave the kept entry marked — with fractional row
// tops, after the rounding, whatever mode it came from.
const markedAfter = (tops: readonly number[], y: number, line: number) => readingLineActive(tops.map((t) => t - Math.round(y)), line, -1);

test("with fractional row tops, the entry marked after a flip is the entry kept (pinned → flow by a resize: Cherre stayed Cherre)", () => {
  // 1440 × 900 → 960 × 600: Experience pinned → flow; Cherre (beat 2) was marked; the new rows sit at .34 px
  const place = snap(900 + pinAtBeat(2, EXPERIENCE_LAYOUT) * 720, 900, [exPinned, edFlow], { experience: 2 });
  const tops = [1100.34, 1250.34, 1400.34, 1550.34, 1700.34];
  const exNarrow: ChapterBox = { ...exFlow, top: 1000, height: 860, stageHeight: 600, beatTops: tops };
  const y = correctPlace(place, { chapters: [exNarrow], pageTopOf: () => null, readingLine: 372 })!;
  assert.equal(markedAfter(tops, y, 372), 2);
});

test("flow → static → flow (a Reduce Motion round trip mid-Education at 390 × 844): the same entry, and the text does not move", () => {
  const line = 523;
  const edFlow390: ChapterBox = { id: "education", top: 1500.4, height: 700, mode: "flow", stageHeight: 844, beatTops: [1640.4, 1880.7], layout: EDUCATION_LAYOUT };
  const edStatic390: ChapterBox = { ...edFlow390, mode: "static", top: 1449.6, beatTops: [1589.6, 1829.9] };
  // CMU (beat 1) marked, its top 0.3 px above the line
  const y0 = 1880.7 - line + 0.3;
  const leg1 = snapshotPlace({ scrollY: y0, viewportH: 844, readingLine: line, chapters: [edFlow390], shown: { education: 1 }, centre: null });
  const y1 = correctPlace(leg1, { chapters: [edStatic390], pageTopOf: () => null, readingLine: line })!;
  assert.equal(markedAfter(edStatic390.beatTops, y1, line), 1, "the static still reads CMU at the line");
  assert.ok(Math.abs((1829.9 - Math.round(y1)) - (1880.7 - y0)) <= LAND_PX + 0.5, "leg 1 moves the text by no more than the landing margin");
  const leg2 = snapshotPlace({ scrollY: Math.round(y1), viewportH: 844, readingLine: line, chapters: [edStatic390], shown: { education: -1 }, centre: null });
  const y2 = correctPlace(leg2, { chapters: [edFlow390], pageTopOf: () => null, readingLine: line })!;
  assert.equal(markedAfter(edFlow390.beatTops, y2, line), 1, "CMU is marked again, not UPenn");
});

test("a rotation (flow → flow) with an offset taller than the entry's new height: clamped, so the next entry does not light", () => {
  // 844 × 390 → 390 × 844: UPenn's top was 180 px above the line in landscape; in portrait UPenn is 140 px tall
  const land: ChapterBox = { id: "education", top: 1000, height: 600, mode: "flow", stageHeight: 390, beatTops: [1100, 1400], layout: EDUCATION_LAYOUT };
  const port: ChapterBox = { ...land, top: 2000, stageHeight: 844, beatTops: [2100.5, 2240.5] };
  const place = snapshotPlace({ scrollY: 1100 - 242 + 180, viewportH: 390, readingLine: 242, chapters: [land], shown: { education: 0 }, centre: null });
  const y = correctPlace(place, { chapters: [port], pageTopOf: () => null, readingLine: 523 })!;
  assert.equal(markedAfter(port.beatTops, y, 523), 0, "UPenn stays marked");
});

test("a row the reading line's hysteresis still holds below the line stays marked after a flip", () => {
  // scrolling back up: Meta (beat 1) is still marked with its top 20 px BELOW the line (within HYSTERESIS_PX)
  const tops = [860, 1010, 1160, 1310, 1460];
  const place = snapshotPlace({ scrollY: 1010 - 434 - 20, viewportH: 700, readingLine: 434, chapters: [exFlow], shown: { experience: 1 }, centre: null });
  assert.ok(20 < HYSTERESIS_PX);
  const exStatic: ChapterBox = { ...exFlow, mode: "static" as ChapterMode, beatTops: tops.map((t) => t - 0.4) };
  const y = correctPlace(place, { chapters: [exStatic], pageTopOf: () => null, readingLine: 434 })!;
  assert.equal(markedAfter(exStatic.beatTops, y, 434), 1);
});

test("the marked entry survives every flip: a sweep of fractional tops, lines, offsets and mode pairs", () => {
  const modes: ChapterMode[] = ["pinned", "flow", "static"];
  let cases = 0;
  for (const from of modes) for (const to of ["flow", "static"] as ChapterMode[]) {
    for (let frac = 0; frac < 1; frac += 0.13) for (const line of [372, 434, 523, 558]) for (const gap of [60, 95.5, 150.25, 240]) {
      const n = 5;
      const oldTops = Array.from({ length: n }, (_, k) => 1000 + k * 150 + frac);
      const newTops = Array.from({ length: n }, (_, k) => 3000.5 + k * gap - frac);
      const oldBox: ChapterBox = { id: "experience", top: 900, height: from === "pinned" ? 1620 : 900, mode: from, stageHeight: 900, beatTops: oldTops, layout: EXPERIENCE_LAYOUT };
      const newBox: ChapterBox = { ...oldBox, top: 2900, height: 900, mode: to, beatTops: newTops };
      for (const beat of [0, 2, 4]) for (const off of [-140, -60, -0.4, 0]) {
        const scrollY = from === "pinned" ? 900 + pinAtBeat(beat, EXPERIENCE_LAYOUT) * 720 : oldTops[beat] - line - off;
        const place = snapshotPlace({ scrollY, viewportH: 900, readingLine: line, chapters: [oldBox], shown: { experience: from === "static" ? -1 : beat }, centre: null });
        const kept = place.kind === "chapter" ? place.beat : -1;
        const y = correctPlace(place, { chapters: [newBox], pageTopOf: () => null, readingLine: line })!;
        assert.equal(markedAfter(newTops, y, line), kept, `${from}→${to} beat ${beat} off ${off} line ${line} gap ${gap} frac ${frac.toFixed(2)}`);
        cases++;
      }
    }
  }
  assert.ok(cases > 1000);
});

test("the reading place is the MARKED chapter, even when the viewport's centre already sits in the next one", () => {
  // 390 × 844 (the line at 523, the centre at 422): JST (Experience's beat 4) is marked with its top at 223 and
  // Experience's section ends at 357; Education's dial and panel start there, its first row 76 px below the line. The
  // centre is inside Education, but the reader's mark is JST: a rotation must keep JST, not an unmarked UPenn.
  const line = 523;
  const ex: ChapterBox = { id: "experience", top: 700, height: 1074, mode: "flow", stageHeight: 844, beatTops: [800, 990, 1180, 1400, 1640], layout: EXPERIENCE_LAYOUT };
  const ed: ChapterBox = { id: "education", top: 1774, height: 700, mode: "flow", stageHeight: 844, beatTops: [2016, 2256], layout: EDUCATION_LAYOUT };
  const scrollY = 1640 - 223;
  assert.ok(scrollY + 422 >= ed.top, "the centre is inside Education");
  const place = snapshotPlace({ scrollY, viewportH: 844, readingLine: line, chapters: [ex, ed], shown: { experience: 4, education: -1 }, centre: null });
  assert.equal(place.kind === "chapter" ? `${place.id}:${place.beat}` : place.kind, "experience:4");
  // after the rotation (844 × 390, the line at 242) JST lands as the last row across the line
  const exL: ChapterBox = { ...ex, top: 500, height: 900, stageHeight: 390, beatTops: [560, 700, 840, 990, 1150.5] };
  const y = correctPlace(place, { chapters: [exL, { ...ed, top: 1400, beatTops: [1500, 1640] }], pageTopOf: () => null, readingLine: 242 })!;
  assert.equal(markedAfter(exL.beatTops, y, 242), 4);
});

test("a rotation that would carry the kept row above the top clear band keeps it in view (portrait JST 408 px above the line → landscape)", () => {
  const port: ChapterBox = { id: "experience", top: 700, height: 1074, mode: "flow", stageHeight: 844, beatTops: [800, 990, 1180, 1400, 1640.4], layout: EXPERIENCE_LAYOUT };
  const land: ChapterBox = { ...port, top: 500, height: 900, stageHeight: 390, beatTops: [560, 700, 840, 990, 1150.6] };
  const place = snapshotPlace({ scrollY: 1640.4 - 523 + 408.6, viewportH: 844, readingLine: 523, chapters: [port], shown: { experience: 4 }, centre: null });
  const y = correctPlace(place, { chapters: [land], pageTopOf: () => null, readingLine: 242 })!;
  const view = 1150.6 - Math.round(y);
  assert.ok(view >= STAGE_CLEAR.top - 0.5 && view <= 242 - LAND_PX + 0.5, `JST's top lands in view, across the line: ${view}`);
  assert.equal(markedAfter(land.beatTops, y, 242), 4);
});

// THE FLOOR IS WHERE THE READER HAD IT (final review): a flow list stays marked until its bottom slides under the top
// clear band, so Education's last row is routinely marked with its top already off screen while the reader reads
// Projects. A resize then must not pull that row down to the band (it moved Projects' heading 38–169 px).
test("a resize with Education's last row marked above the top clear band keeps the reader where they were", () => {
  // 1440 × 900 → 1440 × 860 (height only): the line 558 → 533. Education (flow) has UPenn at 2640, CMU at 2780 and its
  // list's bottom at 2930; the reader has CMU's top at −10 (its list's bottom at 140, just under the band's 96)
  const ed: ChapterBox = { ...edFlow, beatTops: [2640, 2780], listBottom: 2930 };
  const scrollY = 2780 + 10;
  const place = snapshotPlace({ scrollY, viewportH: 900, readingLine: 558, chapters: [exPinned, ed], shown: { experience: -1, education: 1 }, centre: null });
  assert.equal(place.kind === "chapter" ? `${place.id}:${place.beat}` : place.kind, "education:1");
  const y = correctPlace(place, { chapters: [exPinned, ed], pageTopOf: () => null, readingLine: 533 })!;
  assert.equal(Math.round(y), scrollY, "nothing moves: the row stays at −10, not at the band's 96");
  assert.equal(markedAfter(ed.beatTops, y, 533), 1, "CMU is still the row across the line");
});

test("a floored row keeps its list's bottom below the top clear band, so the list stays marked", () => {
  // a rotation (390 × 844 → 844 × 390): the reader has CMU's top at −30 with the list's bottom at 110; landscape
  // wraps CMU's lines into 100 px, so the same row top would leave the list's bottom at 70, under the band
  const port: ChapterBox = { id: "education", top: 1500, height: 700, mode: "flow", stageHeight: 844, beatTops: [1640, 1880], layout: EDUCATION_LAYOUT, listBottom: 2020 };
  const land: ChapterBox = { ...port, top: 1300, stageHeight: 390, beatTops: [1400, 1560], listBottom: 1660 };
  const place = snapshotPlace({ scrollY: 1880 + 30, viewportH: 844, readingLine: 523, chapters: [port], shown: { education: 1 }, centre: null });
  const y = correctPlace(place, { chapters: [land], pageTopOf: () => null, readingLine: 242 })!;
  const bottom = land.listBottom! - Math.round(y);
  assert.ok(bottom > STAGE_CLEAR.top, `the list's bottom lands at ${bottom}, below the band`);
  assert.ok(bottom <= STAGE_CLEAR.top + LAND_PX + 1, `and no lower than it needs: ${bottom}`);
  assert.equal(markedAfter(land.beatTops, y, 242), 1);
});
