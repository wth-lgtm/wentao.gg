import { test } from "node:test";
import assert from "node:assert/strict";

import { createPointerRig } from "../app/lib/pointerRig";

test("a pointer rig records the move, flags presence and wakes whoever is bound", () => {
  const rig = createPointerRig();
  let woke = 0;
  rig.move(0.25, -0.1); // nobody bound yet: no throw
  rig.bind(() => woke++);
  rig.move(0.25, -0.1);
  assert.deepEqual([rig.x, rig.y, rig.over, woke], [0.25, -0.1, true, 1]);
  rig.leave();
  assert.deepEqual([rig.over, woke], [false, 2]);
  rig.bind(null);
  rig.move(0, 0);
  assert.equal(woke, 2);
});

test("the rig keeps the pointer's client pixels and its speed in px per move — the wake ribbon's brush radius", () => {
  const rig = createPointerRig();
  rig.move(0, 0, 100, 100);
  assert.deepEqual([rig.cx, rig.cy, rig.speed], [100, 100, 0]); // the first move has no previous point
  rig.move(0.1, 0, 130, 140);
  assert.deepEqual([rig.cx, rig.cy, rig.speed], [130, 140, 50]);
  rig.leave();
  rig.move(0.1, 0, 530, 140);
  assert.equal(rig.speed, 0, "re-entry does not read as a 400 px flick");
  rig.move(0.1, 0, 533, 144);
  assert.equal(rig.speed, 5);
});
