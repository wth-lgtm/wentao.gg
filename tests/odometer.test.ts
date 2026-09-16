import { test } from "node:test";
import assert from "node:assert/strict";

import { odometerCells } from "../app/projects/hl-whale-tracker/components/Odometer";

// Column identity across a change of LENGTH.
//
// The strips were keyed by string index, so "+$9.79M" -> "+$10.06M" re-keyed every
// column after the first: the column that had been the decimal point became a digit
// column at the same key and React reused the node, so a '.' span turned into a digit
// strip and the digit strips rolled to whatever character had moved into their index.
// The "a figure that falls rolls DOWN" claim only ever held for same-length updates.
//
// Keying from the RIGHT is how a physical odometer is built: units, tens, hundreds keep
// their identity and a carry adds a drum on the LEFT. The assertions below are about
// that invariant rather than about any one pair of strings.

const keysOf = (s: string) => odometerCells(s).map((c) => c.key);
const cellAt = (s: string, key: number) => odometerCells(s).find((c) => c.key === key);

test("odometerCells: a cell per character, keyed by distance from the right", () => {
  assert.deepEqual(keysOf("$9.79M"), [-6, -5, -4, -3, -2, -1]);
  // The units drum is always the same key whatever the figure's length.
  assert.deepEqual(keysOf("7"), [-1]);
  assert.deepEqual(keysOf(""), []);
});

test("odometerCells: only 0-9 rolls; everything else is a static character", () => {
  const cells = odometerCells("+$1.5K");
  assert.deepEqual(
    cells.map((c) => [c.ch, c.digit]),
    [
      ["+", false],
      ["$", false],
      ["1", true],
      [".", false],
      ["5", true],
      ["K", false],
    ]
  );
});

test("odometerCells: a carry adds a column on the left and keeps every place value", () => {
  const before = odometerCells("$9.79M");
  const after = odometerCells("$10.06M");

  // The suffix, the fraction, the units drum and the decimal point all keep their
  // identity — every place value, which is the point.
  for (const key of [-1, -2, -3, -4, -5]) {
    const b = cellAt("$9.79M", key);
    const a = cellAt("$10.06M", key);
    assert.ok(b && a, `key ${key} exists in both`);
    assert.equal(a.digit, b.digit, `key ${key} keeps its kind`);
  }
  assert.equal(cellAt("$9.79M", -4)?.ch, ".");
  assert.equal(cellAt("$10.06M", -4)?.ch, ".");

  // The one column that DOES change kind, asserted rather than skipped: the prefix
  // slot. "$" sits at -6 in the shorter figure and the tens digit occupies it in the
  // longer one, so that node goes from a static char span to a digit strip. It is
  // unavoidable and harmless — a prefix is not a place value, so there is no drum
  // identity to lose, and the "$" it is replaced by simply moves one column left. The
  // comparison that matters is the count: one here against three under string-index
  // keying (measured in the browser, where "." became a digit strip, a digit strip
  // became "." and "M" became a digit).
  assert.equal(cellAt("$9.79M", -6)?.ch, "$");
  assert.equal(cellAt("$9.79M", -6)?.digit, false);
  assert.equal(cellAt("$10.06M", -6)?.ch, "1");
  assert.equal(cellAt("$10.06M", -6)?.digit, true);
  assert.equal(cellAt("$10.06M", -7)?.ch, "$");

  const kindFlips = [-1, -2, -3, -4, -5, -6].filter(
    (key) => cellAt("$9.79M", key)!.digit !== cellAt("$10.06M", key)!.digit
  );
  assert.deepEqual(kindFlips, [-6]);

  // The only key the longer figure introduces is further left than every old one.
  const added = after.map((c) => c.key).filter((k) => !before.some((c) => c.key === k));
  assert.deepEqual(added, [-7]);
  assert.ok(added.every((k) => k < Math.min(...before.map((c) => c.key))));
});

test("odometerCells: a shrinking figure drops the leftmost column, not the units", () => {
  const before = odometerCells("$10.06M");
  const after = odometerCells("$9.79M");
  const dropped = before.map((c) => c.key).filter((k) => !after.some((c) => c.key === k));
  assert.deepEqual(dropped, [-7]);
  assert.equal(cellAt("$9.79M", -1)?.ch, "M");
});

test("odometerCells: keys are unique, so React can key on them", () => {
  for (const s of ["$9.79M", "-$1,234.50", "+0.00%", "0"]) {
    const keys = keysOf(s);
    assert.equal(new Set(keys).size, keys.length, s);
  }
});
