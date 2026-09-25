import { test } from "node:test";
import assert from "node:assert/strict";

import { RIFFLE_JUMP, riffleStep } from "../app/lib/chapterList";

test("one step toward the target per call, in either direction; at the target it stays", () => {
  assert.equal(riffleStep(0, 1), 1);
  assert.equal(riffleStep(0, 3), 1);
  assert.equal(riffleStep(4, 2), 3);
  assert.equal(riffleStep(2, 2), 2);
});

test("docking: with nothing shown the first step lands on the target directly (entering from below marks the last row, not a riffle from the top)", () => {
  assert.equal(riffleStep(-1, 0), 0);
  assert.equal(riffleStep(-1, 4), 4);
  assert.equal(riffleStep(3, -1), -1, "a target of −1 clears");
});

test(`the jump: more than RIFFLE_JUMP (${RIFFLE_JUMP}) beats away goes to one short of the target, and the last row still steps`, () => {
  assert.equal(riffleStep(0, RIFFLE_JUMP), 1, "exactly RIFFLE_JUMP away still riffles");
  assert.equal(riffleStep(0, RIFFLE_JUMP + 1), RIFFLE_JUMP);
  assert.equal(riffleStep(0, 9), 8);
  assert.equal(riffleStep(9, 0), 1);
  const seq: number[] = [];
  let s = 0;
  while (s !== 9) { s = riffleStep(s, 9); seq.push(s); }
  assert.deepEqual(seq, [8, 9]);
});

test("inside a five-entry chapter nothing is ever skipped once docked: every move riffles every beat", () => {
  for (let from = 0; from < 5; from++) for (let to = 0; to < 5; to++) {
    const seq: number[] = [];
    let s = from;
    while (s !== to) { s = riffleStep(s, to); seq.push(s); }
    const want: number[] = [];
    for (let b = from; b !== to;) { b += Math.sign(to - from); want.push(b); }
    assert.deepEqual(seq, want, `${from} → ${to}`);
  }
});
