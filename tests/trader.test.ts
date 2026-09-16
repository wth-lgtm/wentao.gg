import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseFills,
  parseMargin,
  parsePositions,
  parseSpot,
} from "../app/projects/hl-whale-tracker/lib/trader";

// The absent/empty boundary, pinned.
//
// app/api/hl-trader/[address]/route.ts calls three independent upstreams through an
// info() that answers null for a non-2xx (Hyperliquid 429s a second sequential call
// from a shared egress IP), a thrown fetch, or its 10 s timeout. Every parser below
// used to flatten that null into [], which is byte-identical to the answer a genuinely
// flat address gives — and the panels then printed "currently flat" and "no fill
// history … a real state, not an error" over an upstream that never answered.
//
// So each parser has three distinct outcomes and all three are asserted here:
//   null payload      -> null   ("upstream did not answer")
//   answered, nothing -> []     ("upstream answered and held nothing")
//   answered, rows    -> rows
//
// The payload fragments are shaped after the live info responses for the 7d #1
// address: every numeric arrives as a STRING, side is carried only by the sign of
// szi, and cumFunding.sinceOpen is funding PAID (so it is negated on the way out).

test("parsePositions: null upstream is absent, an answered empty account is empty", () => {
  assert.equal(parsePositions(null), null);
  assert.equal(parsePositions(undefined), null);

  // A never-used address still answers with a full marginSummary and assetPositions: [].
  assert.deepEqual(parsePositions({ marginSummary: {}, assetPositions: [] }), []);
});

test("parsePositions: a populated account parses side, ROE and funding", () => {
  const parsed = parsePositions({
    assetPositions: [
      {
        position: {
          coin: "BTC",
          szi: "-163.77",
          entryPx: "72570.3",
          positionValue: "11884000.0",
          unrealizedPnl: "-1813000.0",
          returnOnEquity: "0.1531",
          liquidationPx: "144277.0",
          marginUsed: "594200.0",
          leverage: { type: "cross", value: "20" },
          maxLeverage: "40",
          cumFunding: { sinceOpen: "-11684.0" },
        },
      },
    ],
  });

  assert.ok(parsed !== null);
  assert.equal(parsed.length, 1);
  const [p] = parsed;
  assert.equal(p.coin, "BTC");
  assert.equal(p.szi, -163.77);
  assert.equal(p.side, "SHORT");
  assert.equal(p.entryPx, 72570.3);
  assert.equal(p.roe, 0.1531);
  assert.equal(p.leverage, 20);
  assert.equal(p.leverageType, "cross");
  // Upstream reports funding PAID; the trader's view is the negation, so a negative
  // sinceOpen is funding RECEIVED.
  assert.equal(p.fundingSinceOpen, 11684);
});

test("parsePositions: a missing figure inside a present row stays null, never 0", () => {
  const parsed = parsePositions({
    assetPositions: [{ position: { coin: "SUI", szi: "0.5", entryPx: "-" } }],
  });

  assert.ok(parsed !== null);
  assert.equal(parsed[0].entryPx, null);
  assert.equal(parsed[0].liquidationPx, null);
  assert.equal(parsed[0].side, "LONG");
});

test("parseSpot: null upstream is absent; an answered all-zero wallet is empty", () => {
  assert.equal(parseSpot(null), null);
  assert.equal(parseSpot(undefined), null);

  assert.deepEqual(parseSpot({ balances: [] }), []);
  // Zero balances are filtered out, and that filtering must still read as EMPTY —
  // upstream answered, it simply holds nothing worth a row.
  assert.deepEqual(parseSpot({ balances: [{ coin: "USDC", total: "0", hold: "0" }] }), []);
});

test("parseSpot: a populated wallet keeps its counts", () => {
  const parsed = parseSpot({
    balances: [
      { coin: "HYPE", total: "4321.5678", hold: "12.5" },
      { coin: "PURR", total: "0", hold: "0" },
    ],
  });

  assert.ok(parsed !== null);
  // usdValue starts null because it is not in this payload: pricing needs spotMeta and
  // allMids, which are separate calls. A parser cannot price — see priceSpot and
  // tests/priceSpot.test.ts.
  assert.deepEqual(parsed, [
    { coin: "HYPE", total: 4321.5678, hold: 12.5, usdValue: null },
  ]);
});

test("parseFills: null upstream is absent, an answered empty tape is empty", () => {
  assert.equal(parseFills(null), null);
  assert.equal(parseFills(undefined), null);

  assert.deepEqual(parseFills([]), []);
});

test("parseFills: a populated tape parses and respects the cap", () => {
  const raw = Array.from({ length: 5 }, (_, i) => ({
    coin: "ETH",
    px: "2296.09",
    sz: "1.5",
    dir: "Close Short",
    time: 1757980000000 + i,
    closedPnl: "168.0",
    fee: "-0.42",
    feeToken: "USDC",
  }));

  const all = parseFills(raw);
  assert.ok(all !== null);
  assert.equal(all.length, 5);
  assert.equal(all[0].px, 2296.09);
  assert.equal(all[0].dir, "Close Short");
  assert.equal(all[0].fee, -0.42);

  const capped = parseFills(raw, 2);
  assert.ok(capped !== null);
  assert.equal(capped.length, 2);
});

test("parseFills: a shape that is not a list is empty, not absent", () => {
  // A 200 whose body is not an array is a shape problem, not a failed call; the
  // absent signal is reserved for the null info() hands back.
  assert.deepEqual(parseFills({ fills: [] }), []);
});

test("parseMargin: null on a failed perp call, numbers on a real answer", () => {
  assert.equal(parseMargin(null), null);
  // No marginSummary at all — a live clearinghouseState always carries one, even for
  // an address that has never traded, so its absence is a failure signal.
  assert.equal(parseMargin({}), null);

  assert.deepEqual(
    parseMargin({
      marginSummary: {
        accountValue: "1234567.89",
        totalNtlPos: "577000000",
        totalMarginUsed: "28850000",
      },
      withdrawable: "98765.4",
      // A SIBLING of marginSummary, not a member of it — the live payload for the
      // 7d #1 address carries crossMaintenanceMarginUsed at the top level alongside
      // withdrawable, and reading it off marginSummary would silently yield null.
      crossMaintenanceMarginUsed: "16832367.54",
    }),
    {
      accountValue: 1234567.89,
      totalNtlPos: 577000000,
      totalMarginUsed: 28850000,
      withdrawable: 98765.4,
      crossMaintenanceMarginUsed: 16832367.54,
    }
  );
});

test("parseMargin: an absent maintenance figure is null, so the panel prints no percent", () => {
  // Maintenance margin is what the Positions header divides by account value to say
  // how close the account sits to liquidation. An isolated-margin-only account has no
  // cross figure, and a 0 there would read as "nothing at risk" — the one claim the
  // data does not support.
  const m = parseMargin({ marginSummary: { accountValue: "10" }, withdrawable: "1" });
  assert.ok(m !== null);
  assert.equal(m.crossMaintenanceMarginUsed, null);
});
