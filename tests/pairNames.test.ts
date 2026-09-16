import { test } from "node:test";
import assert from "node:assert/strict";

import { pairNames } from "../app/projects/hl-whale-tracker/lib/trader";

// The spot fill label map, which the fills route had its own copy of.
//
// Spot fills identify their market by INDEX: upstream sends coin "@107", which is
// unreadable on screen and appeared on 5.4% of sampled fills — 52% for one address.
// Two traps turn this map into silent mislabelling, and both are measured against the
// live spotMeta of 2026-09-16:
//
//   - The pair name is not the array position. universe[107].name === "@109", so a
//     by-position map mislabels almost every spot fill. It is keyed on `name`.
//   - A TOKEN's array position is not its `index` either. 43 of the 501 live tokens sit
//     at a differing position (position 458 holds index 478) and the array is SHORTER
//     than its highest index (501 entries, max index 500... with gaps), so reading
//     tokens[i] resolved 26 of the 328 pairs to the wrong base name — @367 came back
//     "SPCXX/USDC" when it is WARS/USDC — or off the end of the array, which dropped
//     the pair from the map entirely.

// The live shape, cut down: `tokens` is not in index order and is shorter than its
// highest index, which is exactly the condition that breaks a by-position lookup.
const META = {
  tokens: [
    { name: "USDC", index: 0 },
    { name: "HYPE", index: 150 },
    { name: "WARS", index: 479 },
    { name: "SPCX", index: 480 },
  ],
  universe: [
    { name: "@107", tokens: [150, 0] },
    { name: "@367", tokens: [479, 0] },
    // Not quoted in USDC. Still a real market, so it still gets a label.
    { name: "@600", tokens: [480, 150] },
    // Base token absent from `tokens` — unlabellable, and dropped rather than guessed.
    { name: "@999", tokens: [1, 0] },
  ],
};

test("pairNames: the pair is keyed by its own name and both sides come from `index`", () => {
  const map = pairNames(META);
  assert.equal(map.get("@107"), "HYPE/USDC");
  // By ARRAY POSITION, index 479 would read tokens[479] — off the end — and the pair
  // would be missing. This is the 26-of-328 case.
  assert.equal(map.get("@367"), "WARS/USDC");
  // Position 3 holds index 480; a by-position lookup would call this "@600" something
  // else entirely.
  assert.equal(map.get("@600"), "SPCX/HYPE");
});

test("pairNames: a pair it cannot name is absent, so the fill keeps upstream's own label", () => {
  const map = pairNames(META);
  assert.equal(map.has("@999"), false);
  assert.equal(map.size, 3);
});

test("pairNames: an unreadable payload is an empty map, never a throw", () => {
  for (const meta of [null, undefined, {}, { universe: "x", tokens: [] }, { universe: [], tokens: "x" }]) {
    assert.equal(pairNames(meta).size, 0, JSON.stringify(meta));
  }
  // Entries that are not entries are skipped one by one rather than failing the map.
  assert.equal(
    pairNames({ tokens: META.tokens, universe: [null, { name: 5, tokens: [150, 0] }, { name: "@107" }, ...META.universe] })
      .get("@107"),
    "HYPE/USDC"
  );
});
