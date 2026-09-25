import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ITEM_BEAT_VH, LEAD_VH, PIN_SLACK_PX, STAGE_CLEAR, TAIL_VH,
  activeItemAt, bandFits, beatCount, beatOf, beatStart, beatToActive, chapterPin, chapterVh, headClamp, heldVh,
  pinAtBeat, pinSetFromFlag, railHeadAt, type ChapterLayout,
} from "../app/lib/chapterList";
import { EXPERIENCE_LAYOUT } from "../app/lib/content/experience";
import { EDUCATION_LAYOUT } from "../app/lib/content/education";

// the live layouts plus the shape Projects (PR 2) will hand the same engine
const LAYOUTS: Record<string, ChapterLayout> = { experience: EXPERIENCE_LAYOUT, education: EDUCATION_LAYOUT, twoSubs: [2, 2, 2, 2], mixed: [2, 1, 3] };

test("every beat holds at least 9 vh of scroll (Augnition's FACT_BEAT_VH), for every layout", () => {
  assert.ok(ITEM_BEAT_VH >= 9);
  for (const [name, layout] of Object.entries(LAYOUTS)) {
    const travel = heldVh(layout);
    const n = beatCount(layout);
    let prev = -1;
    // measure each beat's actual span in vh by scanning the pin
    const spans = new Array(n).fill(0);
    const steps = 20000;
    for (let i = 0; i <= steps; i++) {
      const b = activeItemAt(i / steps, layout).beat;
      spans[b] += travel / steps;
      if (b !== prev) prev = b;
    }
    spans.forEach((s, b) => assert.ok(s >= 9 - 0.01, `${name} beat ${b} holds ${s.toFixed(2)} vh`));
    assert.equal(chapterVh(layout), 100 + LEAD_VH + TAIL_VH + n * ITEM_BEAT_VH);
  }
});

test("activeItemAt is total, monotone and never −1 in pinned mode: pin 0 → the first row, pin 1 → the last, NaN/out of range clamp", () => {
  for (const [name, layout] of Object.entries(LAYOUTS)) {
    const n = beatCount(layout);
    let prev = 0;
    for (let i = -10; i <= 1010; i++) {
      const a = activeItemAt(i / 1000, layout);
      assert.ok(a.beat >= 0 && a.beat < n, `${name} ${i}`);
      assert.ok(a.beat >= prev, `${name} monotone at ${i}`);
      assert.deepEqual(beatToActive(a.beat, layout), a);
      prev = a.beat;
    }
    assert.equal(activeItemAt(0, layout).beat, 0);
    assert.equal(activeItemAt(1, layout).beat, n - 1);
    assert.equal(activeItemAt(Number.NaN, layout).beat, 0);
  }
  // item/sub for the two-sub shape
  assert.deepEqual(beatToActive(3, [2, 2, 2, 2]), { item: 1, sub: 1, beat: 3 });
  assert.equal(beatOf(1, 1, [2, 2, 2, 2]), 3);
  assert.deepEqual(beatToActive(2, EXPERIENCE_LAYOUT), { item: 2, sub: 0, beat: 2 }, "entry by entry: beat k is entry k");
});

test("pinAtBeat round-trips: the pin at the middle of beat k's slot is beat k", () => {
  for (const layout of Object.values(LAYOUTS)) {
    for (let b = 0; b < beatCount(layout); b++) assert.equal(activeItemAt(pinAtBeat(b, layout), layout).beat, b);
  }
});

test("chapterPin: 0 until the section's top meets the viewport top, 1 once its bottom meets the stage's bottom", () => {
  assert.equal(chapterPin(100, 1620, 900), 0);
  assert.equal(chapterPin(0, 1620, 900), 0);
  assert.equal(chapterPin(-360, 1620, 900), 0.5);
  assert.equal(chapterPin(-720, 1620, 900), 1);
  assert.equal(chapterPin(-2000, 1620, 900), 1);
  assert.equal(chapterPin(-5, 800, 900), 1, "no travel: past the top counts as done");
});

test("railHeadAt is continuous in pin and meets row k exactly as beat k's slot begins; it ends at the rail's length", () => {
  for (const layout of Object.values(LAYOUTS)) {
    const n = beatCount(layout);
    const rowYs = Array.from({ length: n }, (_, k) => 20 + k * 90);
    const L = rowYs[n - 1] + 60;
    let prev = railHeadAt(0, layout, rowYs, L);
    assert.equal(prev, 0);
    for (let i = 1; i <= 10000; i++) {
      const h = railHeadAt(i / 10000, layout, rowYs, L);
      assert.ok(h >= prev - 1e-9, "monotone");
      assert.ok(h - prev < 5, `continuous (jump ${h - prev} at ${i})`);
      prev = h;
    }
    assert.equal(railHeadAt(1, layout, rowYs, L), L);
    for (let k = 0; k < n; k++) assert.ok(Math.abs(railHeadAt(beatStart(k, layout), layout, rowYs, L) - rowYs[k]) < 1e-9);
  }
});

test("headClamp: the displayed head never passes the next row that has not committed; nothing shown holds it above the first row", () => {
  const rowYs = [20, 110, 200, 290];
  assert.equal(headClamp(150, rowYs, 0), 110);
  assert.equal(headClamp(100, rowYs, 0), 100);
  assert.equal(headClamp(250, rowYs, 2), 250);
  assert.equal(headClamp(400, rowYs, 3), 400, "past the last row the head runs to the rail's end");
  assert.equal(headClamp(60, rowYs, -1), 20);
});

test("bandFits has hysteresis: pin only with 16 px to spare, unpin only on overflow; the compact dial row comes off the band", () => {
  const stage = 900;
  const band = stage - STAGE_CLEAR.top - STAGE_CLEAR.bottom;
  assert.equal(band, 764);
  assert.equal(bandFits(band - PIN_SLACK_PX, stage, false), true);
  assert.equal(bandFits(band - PIN_SLACK_PX + 1, stage, false), false);
  assert.equal(bandFits(band - PIN_SLACK_PX + 1, stage, true), true, "already pinned: holds inside the slack");
  assert.equal(bandFits(band, stage, true), true);
  assert.equal(bandFits(band + 1, stage, true), false);
  assert.equal(bandFits(band - 90 - PIN_SLACK_PX, stage, false, 90), true);
  assert.equal(bandFits(band - 90, stage, false, 90), false);
});

test("the review flag names the pin set (?pin=exp,edu,proj, ?pin=none); no flag, no override", () => {
  assert.deepEqual(pinSetFromFlag("?pin=exp,edu"), { experience: true, education: true, projects: false });
  assert.deepEqual(pinSetFromFlag("?pin=none"), { experience: false, education: false, projects: false });
  assert.equal(pinSetFromFlag("?jacksDebug=1"), null);
});
