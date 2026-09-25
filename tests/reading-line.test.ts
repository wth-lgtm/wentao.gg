import { test } from "node:test";
import assert from "node:assert/strict";

import { HYSTERESIS_PX, READING_LINE, TOOLBAR_PX, createReadingLine, readingLineActive, readingLineFor } from "../app/lib/chapterList";

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

test("the line is 62 % of the client height and follows the window on a fine pointer: a height-only resize moves it", () => {
  assert.equal(READING_LINE, 0.62);
  assert.equal(readingLineFor(844), 523);
  const rl = createReadingLine();
  assert.equal(rl.at(1440, 900, false), 558);
  assert.equal(rl.at(1440, 700, false), 434, "a dragged window edge / DevTools docked below: the line moves with the window");
  assert.equal(rl.at(1440, 560, false), 347);
  assert.equal(rl.at(1440, 790, false), 490, "even a small height change on a fine pointer");
});

test(`on a coarse pointer a HEIGHT-ONLY change under ${TOOLBAR_PX} px (iOS toolbars) leaves the line where it was; a width change or a larger one re-measures`, () => {
  const rl = createReadingLine();
  assert.equal(rl.at(390, 844, true), 523);
  assert.equal(rl.at(390, 764, true), 523, "the toolbar collapsed: same line");
  assert.equal(rl.at(390, 900, true), 523, "56 px from the last accepted height: still the toolbars");
  assert.equal(rl.at(844, 390, true), 242, "an orientation change is a width change: re-measured");
  assert.equal(rl.at(844, 260, true), 161, "130 px: a new window, not a toolbar");
});
