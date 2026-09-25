import { test } from "node:test";
import assert from "node:assert/strict";

import { correctPlace, snapshotPlace, type ChapterBox } from "../app/lib/keepPlace";
import { pinAtBeat } from "../app/lib/chapterList";
import { EXPERIENCE_LAYOUT } from "../app/lib/content/experience";
import { EDUCATION_LAYOUT } from "../app/lib/content/education";

// 1440 × 900: the hero 900 tall; Experience pinned at 180 svh (1620 px), Education in flow (≈ 700 px); below
// them Projects. At 1440 × 700 Experience flows (≈ 760 px, rows 150 px apart).
const exPinned: ChapterBox = { id: "experience", top: 900, height: 1620, mode: "pinned", stageHeight: 900, beatTops: [1200, 1290, 1380, 1470, 1560], layout: EXPERIENCE_LAYOUT };
const edFlow: ChapterBox = { id: "education", top: 2520, height: 700, mode: "flow", stageHeight: 900, beatTops: [2700, 2900], layout: EDUCATION_LAYOUT };
const exFlow: ChapterBox = { id: "experience", top: 700, height: 760, mode: "flow", stageHeight: 700, beatTops: [860, 1010, 1160, 1310, 1460], layout: EXPERIENCE_LAYOUT };
const edFlowShort: ChapterBox = { ...edFlow, top: 1460, beatTops: [1640, 1840] };

test("inside a chapter that goes pinned → flow: its shown row lands on the reading line", () => {
  const scrollY = 900 + pinAtBeat(3, EXPERIENCE_LAYOUT) * (1620 - 900);
  const place = snapshotPlace({ scrollY, viewportH: 900, chapters: [exPinned, edFlow], shown: { experience: 3, education: -1 }, centre: { key: "x", pageTop: scrollY + 450 } });
  assert.equal(place.kind, "chapter");
  const y = correctPlace(place, { chapters: [exFlow, edFlowShort], pageTopOf: () => null, readingLine: 434 });
  assert.equal(y, 1310 - 434);
});

test("inside a chapter that goes flow → pinned: pinAtBeat(shown) in it", () => {
  const place = snapshotPlace({ scrollY: 1310 - 434, viewportH: 700, chapters: [exFlow, edFlowShort], shown: { experience: 3 }, centre: null });
  const y = correctPlace(place, { chapters: [exPinned, edFlow], pageTopOf: () => null, readingLine: 558 });
  assert.equal(y, 900 + pinAtBeat(3, EXPERIENCE_LAYOUT) * 720);
});

test("outside every chapter, below one that changed: the centre element keeps its viewport top (two chapters flipping in one trigger)", () => {
  // the reader is in Projects (below both); Experience pinned → flow AND Education flow → static in one trigger
  const place = snapshotPlace({ scrollY: 3400, viewportH: 900, chapters: [exPinned, edFlow], shown: { experience: -1, education: -1 }, centre: { key: "projects-row", pageTop: 3800 } });
  assert.equal(place.kind, "element");
  const edStatic: ChapterBox = { ...edFlowShort, mode: "static" };
  // in the new layout everything below Experience moved up by 1620 − 760 + (900 − 700) = 1060
  const y = correctPlace(place, { chapters: [exFlow, edStatic], pageTopOf: (k) => (k === "projects-row" ? 3800 - 1060 : null), readingLine: 434 });
  assert.equal(y, 3400 - 1060);
});

test("inside a chapter whose own mode did not change (Education, while Experience above it flips): its content keeps its viewport top", () => {
  const place = snapshotPlace({ scrollY: 2500, viewportH: 900, chapters: [exPinned, edFlow], shown: { experience: -1, education: 0 }, centre: { key: "edu-row-0", pageTop: 2700 } });
  assert.equal(place.kind, "chapter");
  const y = correctPlace(place, { chapters: [exFlow, edFlowShort], pageTopOf: (k) => (k === "edu-row-0" ? 1640 : null), readingLine: 434 });
  assert.equal(y, 2500 - (2700 - 1640));
});

test("above every chapter that changed: nothing moves", () => {
  const place = snapshotPlace({ scrollY: 0, viewportH: 900, chapters: [exPinned, edFlow], shown: {}, centre: { key: "hero-h1", pageTop: 359 } });
  const y = correctPlace(place, { chapters: [exFlow, edFlowShort], pageTopOf: () => 359, readingLine: 434 });
  assert.equal(y, 0, "the correction is the scroll the page already has");
});

test("a live Reduce Motion toggle mid-Education (flow → static, Experience pinned → static above it): Education's shown row stays on the reading line", () => {
  const scrollY = 2900 - 558;
  const place = snapshotPlace({ scrollY, viewportH: 900, chapters: [exPinned, edFlow], shown: { experience: -1, education: 1 }, centre: { key: "e", pageTop: scrollY + 450 } });
  const exStatic: ChapterBox = { ...exFlow, mode: "static", top: 900 };
  const edStatic: ChapterBox = { ...edFlow, mode: "static", top: 1660, beatTops: [1840, 2040] };
  const y = correctPlace(place, { chapters: [exStatic, edStatic], pageTopOf: () => null, readingLine: 558 });
  assert.equal(y, 2040 - 558);
});
