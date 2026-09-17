import { test } from "node:test";
import assert from "node:assert/strict";

import { levelFor } from "../app/lib/commitLevel";

test("levelFor is the grid's five-step ramp", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 10, 11, 45].map(levelFor), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});
