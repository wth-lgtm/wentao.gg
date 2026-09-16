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
