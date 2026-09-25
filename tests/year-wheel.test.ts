import { test } from "node:test";
import assert from "node:assert/strict";

import { yearOf, yearRange, yearsFor } from "../app/lib/yearWheel";
import { EXPERIENCE } from "../app/lib/content/experience";
import { EDUCATION } from "../app/lib/content/education";

test("a period's year is its first four-digit year", () => {
  assert.equal(yearOf("May 2024 - Mar 2026"), 2024);
  assert.equal(yearOf("Mar 2026 - Present"), 2026);
  assert.equal(yearOf("Dec 2017"), 2017);
  assert.equal(yearOf("Present"), null);
});

test("the wheels' years come from the data: Experience 2026 → 2020, Education 2020 → 2017", () => {
  assert.deepEqual(yearsFor(EXPERIENCE.map((r) => r.period)), [2026, 2024, 2022, 2021, 2020]);
  assert.deepEqual(yearsFor(EDUCATION.map((s) => s.degrees[0].period)), [2020, 2017]);
});

test("the static readout shows the full range", () => {
  assert.equal(yearRange([2026, 2024, 2022, 2021, 2020]), "2026–2020");
  assert.equal(yearRange([2020, 2017]), "2020–2017");
  assert.equal(yearRange([2020]), "2020");
  assert.equal(yearRange([]), "");
});
