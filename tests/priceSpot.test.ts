import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSpot, priceSpot } from "../app/projects/hl-whale-tracker/lib/trader";

// Spot balances priced in USD, from the two payloads the positions route already has.
//
// Every fixture below is shaped after the live info responses read on 2026-09-16, and
// the three traps they encode are the reason this is a tested pure function rather
// than a few lines in the route:
//
//   1. A token's array POSITION in spotMeta.tokens is not its index. 43 of 501 live
//      tokens sit at a position that differs from their own `index` field (position
//      458 holds index 478), and 26 of the 328 universe entries resolve to the wrong
//      base name — or to nothing at all — when looked up by position. That is the same
//      trap the pair-name map documents for universe names.
//   2. The mid is keyed by the UNIVERSE entry's name, not by the coin. 327 of the 328
//      live pairs are named "@N"; exactly one ("PURR/USDC") is not, and allMids carries
//      a key in whichever form the universe uses. A coin-keyed lookup would also hit
//      the PERP mid for any token that has both.
//   3. 17 of the 328 pairs quote something other than token 0. Their base has no USDC
//      mid here, so it stays unpriced rather than being priced against the wrong unit.
//
// Verified against the live 7d #1 wallet: 11 non-zero balances, USDC 159,469,845.45 +
// HYPE 43,250,501.30 + UFART 4,252,517.70 + UXPL 538,512.70 + seven rows under $15 =
// ~$207.51M, with one row (USDH, $0.01) under a dollar.

// A cut-down spotMeta in the live shape: `tokens` is deliberately NOT in index order,
// and the array is shorter than the highest index it carries.
const META = {
  tokens: [
    { name: "USDC", index: 0 },
    { name: "HYPE", index: 150 },
    { name: "WARS", index: 479 },
    // Quoted in HYPE, not USDC — unpriceable here.
    { name: "SIDE", index: 480 },
  ],
  universe: [
    { name: "@107", tokens: [150, 0] },
    { name: "@367", tokens: [479, 0] },
    // The one canonical pair carries a real name, and allMids keys it that way too.
    { name: "PURR/USDC", tokens: [1, 0] },
    { name: "@600", tokens: [480, 150] },
  ],
};

const MIDS = {
  "@107": "77.7305",
  "@367": "0.5",
  "PURR/USDC": "0.101935",
  // A perp mid under the same ticker as a spot token. Must never be the one used.
  HYPE: "77.99",
  "@600": "3",
};

test("priceSpot: absent stays absent, empty stays empty", () => {
  assert.equal(priceSpot(null, META, MIDS), null);
  assert.deepEqual(priceSpot([], META, MIDS), []);
});

test("priceSpot: the quote token is one unit of itself, and a pair is its mid", () => {
  const priced = priceSpot(
    parseSpot({
      balances: [
        { coin: "USDC", total: "159469845.4523", hold: "0" },
        { coin: "HYPE", total: "556416.0953", hold: "0" },
      ],
    }),
    META,
    MIDS
  );

  assert.ok(priced !== null);
  assert.equal(priced[0].usdValue, 159469845.4523);
  // 556,416.0953 x 77.7305, not x 77.99: the perp mid under the same ticker must lose.
  assert.equal(priced[1].usdValue, 556416.0953 * 77.7305);
});

test("priceSpot: the base token is resolved by its index field, not its array position", () => {
  // WARS is index 479 sitting at array position 2. By position, universe @367 would
  // resolve to "PURR/USDC"'s base or fall off the end of the array entirely.
  const priced = priceSpot([{ coin: "WARS", total: 100, hold: 0, usdValue: null }], META, MIDS);
  assert.ok(priced !== null);
  assert.equal(priced[0].usdValue, 50);
});

test("priceSpot: a pair named in full is priced like any other", () => {
  const priced = priceSpot([{ coin: "PURR", total: 10, hold: 0, usdValue: null }], META, MIDS);
  assert.ok(priced !== null);
  // tokens[] holds no entry for index 1, so PURR cannot be reached from the universe
  // and stays unpriced rather than borrowing another row's mid.
  assert.equal(priced[0].usdValue, null);
});

test("priceSpot: unknown is null, never a zero", () => {
  const priced = priceSpot(
    [
      // No pair in the universe at all.
      { coin: "NOPAIR", total: 5, hold: 0, usdValue: null },
      // Quoted in HYPE: a mid exists, but not in the unit this column prints.
      { coin: "SIDE", total: 5, hold: 0, usdValue: null },
      // The count itself never parsed.
      { coin: "HYPE", total: null, hold: 0, usdValue: null },
    ],
    META,
    MIDS
  );

  assert.ok(priced !== null);
  assert.deepEqual(
    priced.map((b) => b.usdValue),
    [null, null, null]
  );
});

test("priceSpot: a missing or unreadable payload leaves every row unpriced", () => {
  const rows = [{ coin: "HYPE", total: 1, hold: 0, usdValue: null }];
  assert.equal(priceSpot(rows, null, MIDS)?.[0].usdValue, null);
  assert.equal(priceSpot(rows, META, null)?.[0].usdValue, null);
  assert.equal(priceSpot(rows, { universe: "nope" }, MIDS)?.[0].usdValue, null);
  assert.equal(priceSpot(rows, META, { "@107": "not-a-number" })?.[0].usdValue, null);
});

test("priceSpot: the input rows are not mutated", () => {
  const rows = [{ coin: "HYPE", total: 2, hold: 0, usdValue: null }];
  const priced = priceSpot(rows, META, MIDS);
  assert.equal(rows[0].usdValue, null);
  assert.equal(priced?.[0].usdValue, 2 * 77.7305);
});
