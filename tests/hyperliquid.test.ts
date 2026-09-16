import { test } from "node:test";
import assert from "node:assert/strict";

import { mapAllPeriods } from "../app/projects/hl-whale-tracker/lib/hyperliquid";
import { LeaderboardApiResponse } from "../app/projects/hl-whale-tracker/lib/types";

// rowToMetrics' partial-null coercion, pinned.
//
// The module's own header says a silent 0 is the failure mode it exists to prevent,
// but the guard only fired when ALL of pnl/roi/vlm failed: past it, `volume ?? 0`,
// `(roi ?? 0) * 100` and `num(row.accountValue) ?? 0` invented zeros. A row with a
// missing vlm therefore joined the analytics "NONE" zero-volume cohort — which
// whale-analytics verified is a real cohort of spot-only holders — a missing roi
// sorted to the bottom of the ROI column as 0%, and a missing accountValue printed
// $0 capital in Analytics.
//
// A partial row is now DROPPED and counted (rowsPartial) rather than zero-filled,
// because TraderMetrics' fields are read by nine call sites across five files that
// all do bare arithmetic on them; see the comment on rowToMetrics.
//
// rowToMetrics is module-private, so these go through mapAllPeriods, which is what
// app/api/hl-leaderboard/route.ts actually calls.

const WINDOWS = ["day", "week", "month", "allTime"] as const;

/** A row in the live named-tuple shape: ["week", {pnl,roi,vlm}] with string numbers. */
function row(
  address: string,
  accountValue: string | null,
  perf: Partial<Record<(typeof WINDOWS)[number], Record<string, string>>>
) {
  return {
    ethAddress: address,
    ...(accountValue === null ? {} : { accountValue }),
    windowPerformances: WINDOWS.map((w) => [
      w,
      perf[w] ?? { pnl: "1", roi: "0.1", vlm: "1000" },
    ]),
  };
}

const payload = (rows: unknown[]) =>
  ({ leaderboardRows: rows } as unknown as LeaderboardApiResponse);

test("mapAllPeriods: a row with no vlm is dropped, never volume 0", () => {
  const mapped = mapAllPeriods(
    payload([
      row("0x1111111111111111111111111111111111111111", "5000", {
        // The critic's exact probe: a week window that parses pnl and roi but has no vlm.
        week: { pnl: "1", roi: "0.1" } as Record<string, string>,
      }),
      row("0x2222222222222222222222222222222222222222", "5000", {}),
    ])
  );

  assert.ok(mapped);
  const week = mapped.periods["7d"];
  assert.equal(week.length, 1);
  assert.equal(week[0].address, "0x2222222222222222222222222222222222222222");
  // The dropped row must not be anywhere in the window under any volume.
  assert.equal(
    week.some((t) => t.address === "0x1111111111111111111111111111111111111111"),
    false
  );
  // pnl/roi/vlm are WINDOW-scoped, so the count has to be per window or a row that
  // is incomplete in one board only goes unreported. This row is complete in the
  // other three.
  assert.deepEqual(mapped.rowsPartial, { "1d": 0, "7d": 1, "30d": 0, allTime: 0 });
});

test("mapAllPeriods: a genuine zero keeps its row, so the NONE cohort stays honest", () => {
  const mapped = mapAllPeriods(
    payload([
      row("0x3333333333333333333333333333333333333333", "14800000000", {
        month: { pnl: "0", roi: "0", vlm: "0" },
      }),
    ])
  );

  assert.ok(mapped);
  const month = mapped.periods["30d"];
  assert.equal(month.length, 1);
  assert.equal(month[0].volume, 0);
  assert.equal(month[0].winRate, 0);
  assert.equal(month[0].pnl, 0);
  // 41 of 50 rows on the live 30-day board are zero-volume spot holders, so a real 0
  // is a real row: it is the *missing* figure that must never look like one.
  assert.equal(month[0].accountValue, 14800000000);
});

test("mapAllPeriods: a missing roi or accountValue drops the row too", () => {
  const mapped = mapAllPeriods(
    payload([
      row("0x4444444444444444444444444444444444444444", "5000", {
        day: { pnl: "500", vlm: "1000" } as Record<string, string>,
      }),
      // accountValue absent at the row level: Analytics' "Capital" column reads it.
      row("0x5555555555555555555555555555555555555555", null, {}),
      row("0x6666666666666666666666666666666666666666", "5000", {}),
    ])
  );

  assert.ok(mapped);
  assert.deepEqual(
    mapped.periods["1d"].map((t) => t.address),
    ["0x6666666666666666666666666666666666666666"]
  );
  // The 1d window loses both rows; the other three lose only the accountValue one,
  // because accountValue is row-level and not window-scoped.
  assert.deepEqual(mapped.rowsPartial, { "1d": 2, "7d": 1, "30d": 1, allTime: 1 });
  // Dropped in every window, because accountValue is not window-scoped.
  for (const p of ["1d", "7d", "30d", "allTime"] as const) {
    assert.equal(
      mapped.periods[p].some(
        (t) => t.address === "0x5555555555555555555555555555555555555555"
      ),
      false
    );
  }
});

test("mapAllPeriods: partial rows are counted, not silently lost", () => {
  const mapped = mapAllPeriods(
    payload([
      row("0x7777777777777777777777777777777777777777", "5000", {
        allTime: { pnl: "9", roi: "0.9" } as Record<string, string>,
      }),
      row("0x8888888888888888888888888888888888888888", null, {}),
      row("0x9999999999999999999999999999999999999999", "5000", {}),
    ])
  );

  assert.ok(mapped);
  assert.equal(mapped.rowsSeen, 3);
  // rowsParsed stays the all-time figure, which is the pass the route's "rows arrived
  // but none parsed" guard reads; rowsPartial is reported per window.
  assert.equal(mapped.rowsParsed, 1);
  assert.deepEqual(mapped.rowsPartial, { "1d": 1, "7d": 1, "30d": 1, allTime: 2 });
});

test("mapAllPeriods: an unreadable window is still dropped and is not a partial", () => {
  const mapped = mapAllPeriods(
    payload([
      // No numbers at all: the pre-existing all-null guard, kept.
      row("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "5000", {
        allTime: { pnl: "-", roi: "-", vlm: "-" },
      }),
      // No windowPerformances array at all.
      { ethAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", accountValue: "1" },
    ])
  );

  assert.ok(mapped);
  assert.equal(mapped.periods.allTime.length, 0);
  assert.equal(mapped.rowsParsed, 0);
  // Unreadable is not partial: nothing here is a figure upstream merely omitted.
  assert.deepEqual(mapped.rowsPartial, { "1d": 0, "7d": 0, "30d": 0, allTime: 0 });
});

test("mapAllPeriods: ROI is still scaled from a decimal and rows sort by PnL", () => {
  const mapped = mapAllPeriods(
    payload([
      row("0xcccccccccccccccccccccccccccccccccccccccc", "100", {
        week: { pnl: "10", roi: "0.25", vlm: "1" },
      }),
      row("0xdddddddddddddddddddddddddddddddddddddddd", "100", {
        week: { pnl: "99", roi: "2.5", vlm: "1" },
      }),
    ]),
    1
  );

  assert.ok(mapped);
  assert.equal(mapped.periods["7d"].length, 1);
  assert.equal(mapped.periods["7d"][0].pnl, 99);
  assert.equal(mapped.periods["7d"][0].winRate, 250);
});
