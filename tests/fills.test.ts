// The tape's interpretation layer, pinned.
//
// Every assertion below was written against a live probe of Hyperliquid's userFills
// (read-only, 2026-09-16) rather than the documentation, because three of the
// behaviours this file protects only show up in real payloads:
//
//   * The 7d #1 address's hundred most recent fills carry 73 distinct `oid`s. The old
//     time heuristic collapsed them into ten rows and told the visitor each row was
//     "one order" — a false statement for seven of the ten.
//   * `dir` is not the eight values the table was built from: `Settlement` and
//     `Spot Dust Conversion` are live, and settlement fills carry real closedPnl that
//     the OTHER fallback dropped from the total.
//   * The elapsed label rounded UP, so a 5 h 31 m span was printed as "6h of
//     activity" next to two second-resolution clocks.
//
// The clock, the day key and the zone label are viewer-local BY DESIGN (Hyperliquid's
// own UI is local), so the viewer is pinned here to UTC and the expected strings are
// UTC strings. Assigning process.env.TZ at runtime re-notifies ICU, verified in this
// Node version, and node:test runs each file in its own process so the pin is local
// to this file.
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dayKey,
  dirFacets,
  fillSpan,
  formatDate,
  formatDayLabel,
  formatElapsed,
  formatFee,
  formatZone,
  groupFills,
  realisedTotal,
  venueOf,
  type LabelledFill,
} from "../app/projects/hl-whale-tracker/lib/fills";
import { FILL_LIMIT, parseFills } from "../app/projects/hl-whale-tracker/lib/trader";

/** 2026-09-15T22:45:46.000Z — the start of the live span the spec was written on. */
const T0 = Date.UTC(2026, 8, 15, 22, 45, 46);

const fill = (over: Partial<LabelledFill> = {}): LabelledFill => ({
  coin: "ETH",
  px: 2000,
  sz: 1,
  dir: "Close Short",
  time: T0,
  closedPnl: 10,
  fee: 0.5,
  feeToken: "USDC",
  oid: null,
  twapId: null,
  ...over,
});

test("groupFills: consecutive fills of one order id collapse, a new id starts a row", () => {
  const orders = groupFills([
    fill({ oid: 1, time: T0 + 2000, sz: 2 }),
    fill({ oid: 1, time: T0 + 1000, sz: 3 }),
    fill({ oid: 1, time: T0, sz: 5 }),
    fill({ oid: 2, time: T0 - 1000, sz: 4 }),
  ]);

  assert.equal(orders.length, 2);
  assert.equal(orders[0].fills, 3);
  assert.equal(orders[0].orderId, 1);
  assert.equal(orders[0].byId, true);
  assert.equal(orders[0].size, 10);
  assert.equal(orders[0].notional, 20_000);
  assert.equal(orders[0].closedPnl, 30);
  assert.equal(orders[0].latest, T0 + 2000);
  assert.equal(orders[0].earliest, T0);
  assert.equal(orders[1].fills, 1);
  assert.equal(orders[1].orderId, 2);
});

test("groupFills: a TWAP's many order ids collapse to the one intent", () => {
  const orders = groupFills([
    fill({ oid: 11, twapId: 7, time: T0 + 2000 }),
    fill({ oid: 12, twapId: 7, time: T0 + 1000 }),
    fill({ oid: 13, twapId: 7, time: T0 }),
    fill({ oid: 14, twapId: 8, time: T0 - 1000 }),
  ]);

  assert.equal(orders.length, 2);
  assert.equal(orders[0].fills, 3);
  // The TWAP id wins over the child oids: many oids, one decision.
  assert.equal(orders[0].orderId, 7);
  assert.equal(orders[1].orderId, 8);
});

test("groupFills: a matching id that is not adjacent is never merged", () => {
  // Same oid either side of a different market. Merging on id alone would invent an
  // order that interleaved two books.
  const interleaved = groupFills([
    fill({ oid: 1, coin: "ETH", time: T0 + 2000 }),
    fill({ oid: 2, coin: "BTC", time: T0 + 1000 }),
    fill({ oid: 1, coin: "ETH", time: T0 }),
  ]);
  assert.equal(interleaved.length, 3);
  assert.deepEqual(
    interleaved.map((o) => o.orderId),
    [1, 2, 1]
  );

  // Same market, id 1 → 2 → 1, which upstream has never produced but must not fuse.
  const sameMarket = groupFills([
    fill({ oid: 1, time: T0 + 2000 }),
    fill({ oid: 2, time: T0 + 1000 }),
    fill({ oid: 1, time: T0 }),
  ]);
  assert.equal(sameMarket.length, 3);
});

test("groupFills: with no id, the time fallback is bounded by the group's newest fill", () => {
  // Twenty fills 50 s apart. The old test was against the PRECEDING fill, so the
  // window slid and all twenty became one 950 s "order" inside a rule the panel
  // described as "within a minute".
  const chained = groupFills(
    Array.from({ length: 20 }, (_, i) => fill({ time: T0 - i * 50_000 }))
  );
  assert.equal(chained.length, 10);
  for (const o of chained) {
    assert.ok(o.latest !== null && o.earliest !== null);
    assert.ok(o.latest - o.earliest <= 60_000);
    assert.equal(o.byId, false);
    assert.equal(o.orderId, null);
  }

  // The boundary itself: 60.000 s is inside the window, 60.001 s is a new order.
  assert.equal(groupFills([fill({ time: T0 }), fill({ time: T0 - 60_000 })]).length, 1);
  assert.equal(groupFills([fill({ time: T0 }), fill({ time: T0 - 60_001 })]).length, 2);

  // A null timestamp cannot be proven contiguous.
  assert.equal(groupFills([fill({ time: T0 }), fill({ time: null })]).length, 2);
});

test("groupFills: an identified fill and an unidentified one are not one order", () => {
  const orders = groupFills([fill({ oid: 1, time: T0 }), fill({ oid: null, time: T0 + 1 })]);
  assert.equal(orders.length, 2);
});

test("groupFills: a flip is its own row and realises", () => {
  const orders = groupFills([
    fill({ oid: 1, dir: "Close Long", closedPnl: 100, time: T0 + 1000 }),
    fill({ oid: 1, dir: "Long > Short", closedPnl: 250, time: T0 }),
  ]);

  // One oid, but a change of direction is a change of decision.
  assert.equal(orders.length, 2);
  assert.equal(orders[1].facets.action, "FLIP");
  assert.equal(orders[1].facets.side, "SHORT");
  assert.equal(orders[1].closedPnl, 250);
});

test("groupFills: same-millisecond fills across markets get unique row keys", () => {
  // Fills settled in one block share a `time` (43 adjacent same-ms pairs in the live
  // hundred), and a basket close across markets then produced two identical keys.
  const orders = groupFills([
    fill({ coin: "ETH", dir: "Close Long" }),
    fill({ coin: "BTC", dir: "Close Long" }),
    fill({ coin: "ETH", dir: "Close Long" }),
  ]);
  assert.equal(orders.length, 3);
  assert.equal(new Set(orders.map((o) => o.key)).size, 3);
});

test("dirFacets: the live dirs that used to fall through to OTHER", () => {
  assert.deepEqual(dirFacets("Liquidated Isolated Long"), {
    action: "CLOSE",
    side: "LONG",
    realises: true,
    word: "LIQ",
  });
  assert.deepEqual(dirFacets("Liquidated Isolated Short"), {
    action: "CLOSE",
    side: "SHORT",
    realises: true,
    word: "LIQ",
  });
  // The cross-margin sibling is not in the table; the shape is matched instead.
  assert.deepEqual(dirFacets("Liquidated Cross Long"), {
    action: "CLOSE",
    side: "LONG",
    realises: true,
    word: "LIQ",
  });
  assert.deepEqual(dirFacets("Auto-Deleveraging"), {
    action: "CLOSE",
    side: "NONE",
    realises: true,
    word: "ADL",
  });
  assert.deepEqual(dirFacets("Settlement"), {
    action: "SETTLE",
    side: "NONE",
    realises: true,
  });
  assert.deepEqual(dirFacets("Spot Dust Conversion"), {
    action: "SPOT",
    side: "NONE",
    realises: false,
    word: "DUST",
  });

  // The originals are untouched.
  assert.deepEqual(dirFacets("Open Short"), {
    action: "OPEN",
    side: "SHORT",
    realises: false,
  });
  assert.deepEqual(dirFacets("Buy"), { action: "SPOT", side: "BUY", realises: false });
});

test("dirFacets: an unknown dir realises from the data, not from a guess", () => {
  const unknown = dirFacets("Some Future Order Type", -1234.5);
  assert.equal(unknown.action, "OTHER");
  assert.equal(unknown.realises, true);

  // 0 on an unknown dir means "not applicable" exactly as it does on an open.
  assert.equal(dirFacets("Some Future Order Type", 0).realises, false);
  assert.equal(dirFacets("Some Future Order Type", null).realises, false);
  assert.equal(dirFacets("Some Future Order Type").realises, false);
});

test("realisedTotal: a settlement is money realised, and it is counted", () => {
  // Shaped after 0xbdfa4f44…: ten Settlement fills, each with real closedPnl, sat
  // under DIR "OTHER" and were dropped from a total printed with full confidence.
  const fills = [
    fill({ dir: "Close Short", closedPnl: -23_400 }),
    fill({ dir: "Settlement", closedPnl: -7_000 }),
    fill({ dir: "Settlement", closedPnl: -7_018.65 }),
    fill({ dir: "Open Long", closedPnl: 0 }),
    fill({ dir: "Some Future Order Type", closedPnl: 100 }),
    fill({ dir: "Some Future Order Type", closedPnl: 0 }),
    fill({ dir: "Buy", closedPnl: 0.53 }),
  ];

  const { total, count } = realisedTotal(fills);
  assert.equal(count, 4);
  assert.equal(Math.round(total * 100) / 100, -37_318.65);
});

test("groupFills: a group whose first slice did not realise still sums a later one", () => {
  // An OTHER group derives `realises` per fill, so the first slice reporting 0 must
  // not gate the rest of the group out of the total.
  const orders = groupFills([
    fill({ oid: 1, dir: "Some Future Order Type", closedPnl: 0 }),
    fill({ oid: 1, dir: "Some Future Order Type", closedPnl: 5 }),
  ]);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].facets.realises, true);
  assert.equal(orders[0].closedPnl, 5);
});

test("formatElapsed: the span is floored and two-unit, never rounded up", () => {
  const span = (ms: number) => formatElapsed(0, ms);
  // 5h31m used to print "6h" beside a to-the-second clock pair.
  assert.equal(span(5 * 3_600_000 + 31 * 60_000), "5h 31m");
  assert.equal(span(89_000), "1m 29s");
  assert.equal(span(59_000), "59s");
  assert.equal(span(60_000), "1m");
  assert.equal(span(2 * 3_600_000), "2h");
  assert.equal(span(36 * 3_600_000), "1d 12h");
  assert.equal(span(2 * 86_400_000), "2d");
  // A negative interval is not a negative duration.
  assert.equal(span(-5000), "0s");
});

test("fillSpan: the window is the fills that carry a time", () => {
  assert.equal(
    fillSpan([fill({ time: null }), fill({ time: null })] as LabelledFill[]),
    null
  );
  assert.deepEqual(
    fillSpan([fill({ time: T0 + 5000 }), fill({ time: null }), fill({ time: T0 })]),
    { from: T0, to: T0 + 5000 }
  );
});

test("venueOf: the one canonically named spot pair is spot, not perp", () => {
  // universe[0] is the only pair upstream writes as a name rather than an index, so
  // a PURR/USDC fill arrived with a slash and was badged as a perp.
  assert.equal(venueOf("PURR/USDC"), "SPOT");
  assert.equal(venueOf("@107"), "SPOT");
  assert.equal(venueOf("xyz:GOOGL"), "EQUITY");
  assert.equal(venueOf("BTC"), "PERP");
});

test("formatFee: one precision for the whole column", () => {
  assert.equal(formatFee(0.29924, "USDC"), "0.299 USDC");
  assert.equal(formatFee(1.714113, "USDC"), "1.714 USDC");
  assert.equal(formatFee(21.0000001, "USDC"), "21.000 USDC");
  assert.equal(formatFee(6.58, "USDC"), "6.580 USDC");
  assert.equal(formatFee(1234.5, "USDC"), "1,234.500 USDC");
  assert.equal(formatFee(-0.42, "USDC"), "-0.420 USDC");
  // Below the column's resolution, but not zero — and a rebate keeps its sign.
  assert.equal(formatFee(0.0001, "HYPE"), "<0.001 HYPE");
  assert.equal(formatFee(-0.0001, "HYPE"), "-<0.001 HYPE");
  assert.equal(formatFee(0, "USDC"), "0.000 USDC");
});

test("the tape's clock can name its own day and zone", () => {
  const nextDay = Date.UTC(2026, 8, 16, 3, 59, 24);

  assert.equal(dayKey(null), null);
  assert.equal(dayKey(T0), dayKey(T0 + 1000));
  assert.notEqual(dayKey(T0), dayKey(nextDay));

  assert.equal(formatDate(T0), "15 Sep");
  assert.equal(formatDate(nextDay), "16 Sep");
  assert.equal(formatDayLabel(T0), "Tue 15 Sep");
  assert.equal(formatZone(T0), "UTC");
});

test("parseFills keeps the order ids the tape groups on, capped at FILL_LIMIT", () => {
  assert.equal(FILL_LIMIT, 100);

  const raw = Array.from({ length: 120 }, (_, i) => ({
    coin: "ETH",
    px: "2296.09",
    sz: "1.5",
    dir: "Close Short",
    time: 1789543651476 + i,
    closedPnl: "168.0",
    fee: "-0.42",
    feeToken: "USDC",
    oid: 546515669211 + i,
    twapId: null,
  }));

  const parsed = parseFills(raw);
  assert.ok(parsed !== null);
  assert.equal(parsed.length, FILL_LIMIT);
  assert.equal(parsed[0].oid, 546515669211);
  assert.equal(parsed[0].twapId, null);

  // A TWAP child carries a parent id; both are numbers or null, never 0 by accident.
  const twap = parseFills([{ coin: "ETH", dir: "Open Long", oid: 5, twapId: 9 }]);
  assert.equal(twap?.[0].twapId, 9);
  assert.equal(parseFills([{ coin: "ETH", dir: "Open Long", oid: "nope" }])?.[0].oid, null);
});
