import { test } from "node:test";
import assert from "node:assert/strict";

import { FLOW_DIP_PX, flowLine, flowReach, flowScrollFor, readingLineActive } from "../app/lib/chapterList";

// THE TRAVELLING READING LINE (final review, DESIGN §4.2.11's anchor rule): a flow list's line bends to its first
// row near its section's top, so a section-top landing (INDEX, a hash, the hero cue) marks entry 01, and the rows
// light in turn from there. Row offsets are as measured on the review build (px below the section's top).
const marked = (o: readonly number[], u: number, o0: number, line: number, prev = -1) =>
  readingLineActive(o.map((t) => t - u), flowLine(u, o0, line), prev);

test("at the section-top landing the line stands FLOW_DIP_PX below the first row: entry 01 is the one marked", () => {
  // 430 × 932: every Experience row is above the 62 % line (578) at the section top, and Mashey (04) used to light
  const o = [206, 286, 366, 446, 526];
  assert.equal(readingLineActive(o, 578, -1), 4, "the page's line alone marks the last of the five");
  assert.equal(flowLine(0, o[0], 578), o[0] + FLOW_DIP_PX);
  for (const u of [-1, -0.5, 0, 0.5, 1]) assert.equal(marked(o, u, o[0], 578), 0, `a landing rounded ${u} px`);
  // Education at 1440 × 900 (its panel beside its dial): both schools above 558, UPenn marked on arrival
  assert.equal(marked([330, 433], 0, 330, 558), 0);
  // and every other matrix phone
  for (const [o0, rows, line] of [[206, [206, 326, 445, 564, 664], 414], [206, [206, 306, 405, 524, 624], 523], [206, [206, 306, 386, 485, 585], 567], [206, [206, 346], 496]] as const) {
    assert.equal(marked(rows, 0, o0, line), 0);
  }
});

test("away from the section's top the line is the page's line", () => {
  const o0 = 206, line = 523, d = line - (o0 + FLOW_DIP_PX);
  for (const u of [-5000, -d, d, d + 1, 4000]) assert.equal(flowLine(u, o0, line), line);
  assert.ok(flowLine(-d + 1, o0, line) < line && flowLine(d - 1, o0, line) < line);
});

test("where the first row sits below the line at its section's top (a landscape phone), the line dips DOWN to it", () => {
  const o0 = 260, line = 242;
  assert.equal(flowLine(0, o0, line), o0 + FLOW_DIP_PX);
  assert.equal(marked([260, 340, 420], 0, o0, line), 0);
  assert.equal(flowLine(-10, o0, line), o0 + FLOW_DIP_PX - 10);
  assert.equal(flowLine(10, o0, line), o0 + FLOW_DIP_PX - 10);
  assert.equal(flowLine(o0 + FLOW_DIP_PX - line, o0, line), line);
});

test("the reach is continuous and never decreases, so no row is skipped and none lights twice, whatever the bend", () => {
  for (const [o0, line] of [[206, 578], [121, 434], [330, 558], [260, 242], [234, 267], [100, 700]]) {
    let prev = -Infinity;
    for (let u = -900; u <= 900; u += 0.25) {
      const r = flowReach(u, o0, line);
      assert.ok(r >= prev - 1e-9, `reach falls at u ${u} (o0 ${o0}, line ${line})`);
      assert.ok(prev === -Infinity || r - prev <= 2 * 0.25 + 1e-9, `reach jumps at u ${u}`);
      prev = r;
    }
  }
});

test("scrolling down from the landing lights every row in turn; coming down the page, 01 lights on the 62 % line and holds while its section docks", () => {
  const o = [206, 286, 366, 446, 526], line = 578;
  const seq: number[] = [];
  let prev = -1;
  for (let u = -700; u <= 700; u += 5) {
    prev = marked(o, u, o[0], line, prev);
    if (seq[seq.length - 1] !== prev) seq.push(prev);
  }
  assert.deepEqual(seq, [-1, 0, 1, 2, 3, 4]);
  // 01 first lights exactly where its top crosses the page's line
  assert.equal(marked(o, o[0] - line - 1, o[0], line), -1);
  assert.equal(marked(o, o[0] - line, o[0], line), 0);
  // and holds through the section's docking (Meta, Cherre, Mashey and JST all cross the 62 % line meanwhile)
  for (let u = o[0] - line; u <= 0; u += 7) assert.equal(marked(o, u, o[0], line), 0, `u ${u}`);
});

test("flowScrollFor inverts the reach: the least scroll that reaches t, and the greatest that stays at or under it", () => {
  for (const [o0, line] of [[206, 578], [330, 558], [260, 242], [100, 700], [500, 508]]) {
    for (let t = o0 - 900; t <= o0 + 1400; t += 3.7) {
      const first = flowScrollFor(t, o0, line, "first"), last = flowScrollFor(t, o0, line, "last");
      assert.ok(flowReach(first, o0, line) >= t - 1e-6, `first(${t}) reaches it (o0 ${o0}, line ${line})`);
      assert.ok(flowReach(first - 0.01, o0, line) < t + 1e-6, `first(${t}) is the least`);
      assert.ok(flowReach(last, o0, line) <= t + 1e-6, `last(${t}) stays at or under it`);
      assert.ok(flowReach(last + 0.01, o0, line) > t - 1e-6, `last(${t}) is the greatest`);
      assert.ok(first <= last + 1e-9);
    }
  }
  // no bend at all (the first row exactly FLOW_DIP_PX above the line at the section top): the page's line
  assert.equal(flowScrollFor(700, 550, 558, "first"), 700 - 558);
});
