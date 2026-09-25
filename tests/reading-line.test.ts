import { test } from "node:test";
import assert from "node:assert/strict";

import { HYSTERESIS_PX, READING_LINE, createReadingLine, readingLineActive, readingLineFor } from "../app/lib/chapterList";

test("the active row is the last one whose top has crossed the line; −1 above the first row", () => {
  const line = 500;
  assert.equal(readingLineActive([600, 700, 800], line, -1), -1);
  assert.equal(readingLineActive([500, 600, 700], line, -1), 0, "a row ON the line has crossed it");
  assert.equal(readingLineActive([300, 420, 520], line, -1), 1);
  assert.equal(readingLineActive([100, 200, 300], line, 0), 2, "forward is immediate, and a fast scroll can move several rows");
});

test(`hysteresis: going back, the held row keeps the mark until its top is more than ${HYSTERESIS_PX} px below the line`, () => {
  const line = 500;
  // row 1 just crossed; the page nudges back up a little: row 1 stays
  assert.equal(readingLineActive([380, 510, 620], line, 1), 1);
  assert.equal(readingLineActive([380, 500 + HYSTERESIS_PX, 620], line, 1), 1);
  assert.equal(readingLineActive([380, 500 + HYSTERESIS_PX + 1, 620], line, 1), 0);
  // a big jump back lands straight on the row the line is in
  assert.equal(readingLineActive([700, 800, 900], line, 2), -1);
  // resting exactly at the boundary never flickers: alternate ±3 px around the line
  let prev = -1;
  const seen = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const off = i % 2 ? 3 : -3;
    prev = readingLineActive([300, 500 + off, 700], line, prev);
    if (i > 0) seen.add(prev);
  }
  assert.deepEqual([...seen], [1]);
});

test("the line is 62 % of the cached client height, and a HEIGHT-ONLY change (iOS toolbars) leaves it where it was", () => {
  assert.equal(READING_LINE, 0.62);
  assert.equal(readingLineFor(844), 523);
  const rl = createReadingLine();
  assert.equal(rl.at(390, 844), 523);
  assert.equal(rl.at(390, 764), 523, "the toolbar collapsed: same line");
  assert.equal(rl.at(390, 900), 523);
  assert.equal(rl.at(844, 390), 242, "an orientation change is a width change: re-measured");
});
