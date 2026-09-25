import { test } from "node:test";
import assert from "node:assert/strict";

import { correctPlace, snapshotPlace, type ChapterBox } from "../app/lib/keepPlace";
import { pinAtBeat } from "../app/lib/chapterList";
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

test("inside a chapter that goes pinned → flow: its shown row lands on the reading line", () => {
  const scrollY = 900 + pinAtBeat(3, EXPERIENCE_LAYOUT) * (1620 - 900);
  const place = snap(scrollY, 900, [exPinned, edFlow], { experience: 3, education: -1 });
  assert.equal(place.kind, "chapter");
  const y = correctPlace(place, { chapters: [exFlow, edFlowShort], pageTopOf: () => null, readingLine: 434 });
  assert.equal(y, 1310 - 434);
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

test("a live Reduce Motion toggle mid-Education (flow → static, Experience pinned → static above it): Education's shown row goes onto the reading line", () => {
  const scrollY = 2740 - 558 + 12;
  const place = snap(scrollY, 900, [exPinned, edFlow], { experience: -1, education: 1 });
  const exStatic: ChapterBox = { ...exFlow, mode: "static", top: 900 };
  const edStatic: ChapterBox = { ...edFlow, mode: "static", top: 1660, beatTops: [1780, 1880] };
  const y = correctPlace(place, { chapters: [exStatic, edStatic], pageTopOf: () => null, readingLine: 558 });
  assert.equal(y, 1880 - 558);
});
