import { test } from "node:test";
import assert from "node:assert/strict";

import { tierOf } from "../app/projects/hl-whale-tracker/lib/tier";

// tierOf feeds `data-tier` on .hl-plate, and globals.css only defines tiers 1-4
// (globals.css: .hl-plate[data-tier="1".."4"]). Anything that escapes that set renders
// an unstyled plate — no weight, and the tier-4 --legend colour lost — so the tests
// below are about the CLOSED range, not just the happy path. The previous definition
// (`rank <= 3 ? String(rank) : "4"`) was a one-liner duplicated per layout, and it
// leaked "0", "-1" and "2.5" straight into the attribute.

test("tierOf: the top three ranks each get their own weight tier", () => {
  assert.equal(tierOf(1), "1");
  assert.equal(tierOf(2), "2");
  assert.equal(tierOf(3), "3");
});

test("tierOf: everything below the podium is one flat tier", () => {
  assert.equal(tierOf(4), "4");
  assert.equal(tierOf(5), "4");
  assert.equal(tierOf(50), "4");
  // The board caps at 50 rows today; a longer upstream page must not fall off.
  assert.equal(tierOf(1000), "4");
});

test("tierOf: a rank outside the board's numbering falls back to a styled tier", () => {
  // Ranks are `index + 1`, so these cannot occur through the leaderboard — but an
  // unstyled plate is a silent visual regression, so the out-of-range answer is the
  // one tier that is always defined rather than a stringified input.
  assert.equal(tierOf(0), "4");
  assert.equal(tierOf(-1), "4");
  assert.equal(tierOf(2.5), "4");
  assert.equal(tierOf(Number.NaN), "4");
});

test("tierOf: the result is always one of the four tiers globals.css defines", () => {
  const defined = new Set(["1", "2", "3", "4"]);
  for (const rank of [-2, -1, 0, 1, 2, 3, 4, 7, 49, 50, 1.5, 3.999, Infinity]) {
    assert.ok(defined.has(tierOf(rank)), `tierOf(${rank}) = ${tierOf(rank)}`);
  }
});
