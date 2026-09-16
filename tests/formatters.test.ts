import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatAge,
  formatCurrency,
  formatPercent,
} from "../app/projects/hl-whale-tracker/lib/formatters";

// The whale tracker's two number primitives, pinned against the live magnitudes that
// broke them. Every figure below was read off /api/hl-leaderboard: all-time volume
// tops out near 5.9e11 with 20 of 50 rows over $1B, the 30-day account-value leader
// sits at 1.48e10, and all-time ROI runs to 2,641,203.9%. Those are the inputs the
// board actually has to print, so they are the inputs the tests use.
//
// Run with `npm test` (node --import tsx --test) — tsx is the runner because the lib
// modules import each other without file extensions, which bare Node type-stripping
// will not resolve.

test("formatCurrency: compact scales into the unit the magnitude clears", () => {
  const compact1 = { compact: true, decimals: 1 } as const;

  // 7-day volume ceiling. Printed "$5539.4M" on the live board before the B tier.
  assert.equal(formatCurrency(5.54e9, compact1), "$5.5B");
  // All-time volume ceiling — the row that printed "$590000.0M".
  assert.equal(formatCurrency(5.9e11, compact1), "$590.0B");
  // Analytics "Capital" for the 30-day PnL leader: "$14793.3M" before the fix.
  assert.equal(formatCurrency(1.48e10, compact1), "$14.8B");
  assert.equal(formatCurrency(1.257e9, compact1), "$1.3B");
  assert.equal(formatCurrency(1.09e8, compact1), "$109.0M");
  // T is headroom: nothing live reaches 1e12, but the table should not fall off its
  // own top end the way it fell off M.
  assert.equal(formatCurrency(1.5e12, compact1), "$1.5T");
});

test("formatCurrency: rounding to a full 1000 steps up a unit", () => {
  const compact1 = { compact: true, decimals: 1 } as const;

  // 999.95M at one decimal rounds to 1000.0 — which is not a number of millions.
  assert.equal(formatCurrency(999.95e6, compact1), "$1.0B");
  assert.equal(formatCurrency(999.96e3, compact1), "$1.0M");
  // The bare tier steps into K by the same rule.
  assert.equal(formatCurrency(999.99, compact1), "$1.0K");
  // A magnitude that does not round up stays where it is.
  assert.equal(formatCurrency(999.4e6, compact1), "$999.4M");
});

test("formatCurrency: sign handling is unchanged by the new tiers", () => {
  assert.equal(
    formatCurrency(5.54e9, { compact: true, decimals: 1, showSign: true }),
    "+$5.5B"
  );
  assert.equal(
    formatCurrency(-5.54e9, { compact: true, decimals: 1, showSign: true }),
    "-$5.5B"
  );
  // Without showSign a negative still keeps its minus outside the $.
  assert.equal(formatCurrency(-1_234_567, { compact: true, decimals: 1 }), "-$1.2M");
  assert.equal(formatCurrency(-1_234_567, { compact: true }), "-$1.23M");
});

test("formatCurrency: zero is a real zero, and the non-compact path is untouched", () => {
  assert.equal(formatCurrency(0, { compact: true }), "$0.00");
  assert.equal(formatCurrency(0, { compact: true, showSign: true }), "$0.00");
  assert.equal(formatCurrency(0, { compact: true, decimals: 1 }), "$0.0");
  assert.equal(formatCurrency(1234.5), "$1,234.50");
  assert.equal(formatCurrency(-1234.5, { showSign: true }), "-$1,234.50");
});

test("formatPercent: default form is unchanged", () => {
  assert.equal(formatPercent(72.7), "72.7%");
  assert.equal(formatPercent(2_641_203.9), "2641203.9%");
  assert.equal(formatPercent(12.345, { decimals: 2 }), "12.35%");
  assert.equal(formatPercent(12.3, { showSign: true }), "+12.3%");
  assert.equal(formatPercent(-12.3), "-12.3%");
});

test("formatPercent: compact keeps one decimal below 1000%", () => {
  const compact = { compact: true } as const;

  assert.equal(formatPercent(758.7, compact), "758.7%");
  assert.equal(formatPercent(102.7, compact), "102.7%");
  assert.equal(formatPercent(0, compact), "0.0%");
});

test("formatPercent: compact drops the decimal from 1000% to 100,000%", () => {
  const compact = { compact: true } as const;

  // The live all-time rows the 96px column could not hold.
  assert.equal(formatPercent(43_625.6, compact), "43626%");
  assert.equal(formatPercent(31_675.5, compact), "31676%");
  assert.equal(formatPercent(6_843.9, compact), "6844%");
  // Tier edges round up rather than printing a 1000.0 in the decimal tier.
  assert.equal(formatPercent(999.96, compact), "1000%");
});

test("formatPercent: compact SI-scales from 100,000%", () => {
  const compact = { compact: true } as const;

  assert.equal(formatPercent(114_448, compact), "114k%");
  assert.equal(formatPercent(2_641_203.9, compact), "2.64M%");
  // Same step-up discipline as formatCurrency: 999,999% is 1.00M%, not 1000k%.
  assert.equal(formatPercent(999_999, compact), "1.00M%");
  assert.equal(formatPercent(99_999.6, compact), "100k%");
  assert.equal(formatPercent(1.5e9, compact), "1.50B%");
});

test("formatPercent: compact carries the sign", () => {
  assert.equal(formatPercent(2_641_203.9, { compact: true, showSign: true }), "+2.64M%");
  assert.equal(formatPercent(-43_625.6, { compact: true }), "-43626%");
  assert.equal(formatPercent(-43_625.6, { compact: true, showSign: true }), "-43626%");
});

test("formatPercent: compact never exceeds seven characters", () => {
  // Seven tabular characters is the measured maximum that fits the leaderboard's
  // locked 96px ROI column (64px of content at 16px Space Grotesk); "2641203.9%"
  // measured 94px and spilled 14px into the Volume cell.
  const live = [
    0, 0.05, 9.9, 72.7, 102.7, 308.6, 999.94, 999.96, 1010.5, 6843.9, 31675.5,
    43625.6, 99_999.6, 114_448, 2_641_203.9, 1.5e9, 1.5e12,
  ];
  for (const v of live) {
    for (const value of [v, -v]) {
      for (const showSign of [false, true]) {
        const out = formatPercent(value, { compact: true, showSign });
        assert.ok(
          out.length <= 7,
          `formatPercent(${value}, { compact: true, showSign: ${showSign} }) = ${out} is ${out.length} chars`
        );
      }
    }
  }
});

test("formatCurrency: a non-finite magnitude never acquires a unit", () => {
  const compact1 = { compact: true, decimals: 1 } as const;

  // scaleCompact's step-up loop used to walk a non-finite magnitude all the way down
  // to index 0 and hand back the largest suffix in the table, so a missing number read
  // as "$NaNT" — a trillion dollars. The compact path now prints what the uncompacted
  // Intl path prints, which is the only reading the data supports.
  assert.equal(formatCurrency(NaN, compact1), formatCurrency(NaN));
  assert.equal(formatCurrency(NaN, compact1), "$NaN");
  assert.equal(formatCurrency(Infinity, compact1), formatCurrency(Infinity));
  assert.equal(formatCurrency(Infinity, compact1), "$∞");
  assert.equal(formatCurrency(-Infinity, compact1), "-$∞");
  // Same rung-walk, same phantom suffix: "NaNB%".
  assert.equal(formatPercent(NaN, { compact: true }), "NaN%");
  assert.equal(formatPercent(Infinity, { compact: true }), "∞%");
});

test("formatCurrency: each tier prints at its exact threshold", () => {
  const compact1 = { compact: true, decimals: 1 } as const;

  // The thresholds are `>=`, so the boundary value itself belongs to the higher unit.
  assert.equal(formatCurrency(1e3, compact1), "$1.0K");
  assert.equal(formatCurrency(1e6, compact1), "$1.0M");
  assert.equal(formatCurrency(1e9, compact1), "$1.0B");
  assert.equal(formatCurrency(1e12, compact1), "$1.0T");
  // One cent below a threshold stays in the lower unit when rounding allows it.
  assert.equal(formatCurrency(999.4e3, compact1), "$999.4K");
  assert.equal(formatCurrency(999.4e9, compact1), "$999.4B");
});

test("formatCurrency: the top tier steps up too, and keeps its sign", () => {
  const compact1 = { compact: true, decimals: 1 } as const;

  // B→T was the one rung the tests never walked: 999.95B rounds to 1000.0B at one
  // decimal, which is not a number of billions.
  assert.equal(formatCurrency(999.95e9, compact1), "$1.0T");
  // A step-up on a negative keeps the minus outside the $, with and without showSign.
  assert.equal(formatCurrency(-999.95e6, compact1), "-$1.0B");
  assert.equal(formatCurrency(-999.95e9, { ...compact1, showSign: true }), "-$1.0T");
  assert.equal(formatPercent(-999_999, { compact: true }), "-1.00M%");
  assert.equal(formatPercent(-99_999.6, { compact: true, showSign: true }), "-100k%");
});

test("formatAge: MM:SS under an hour, H:MM:SS over it", () => {
  // The rail's age field ticks once a second and a tab stays open for hours. With no
  // hours term it printed "60:00" and then "125:07" — a minutes field that had stopped
  // being one.
  assert.equal(formatAge(0), "00:00");
  assert.equal(formatAge(7), "00:07");
  assert.equal(formatAge(59), "00:59");
  assert.equal(formatAge(60), "01:00");
  assert.equal(formatAge(599), "09:59");
  assert.equal(formatAge(3599), "59:59");
  assert.equal(formatAge(3600), "1:00:00");
  assert.equal(formatAge(3661), "1:01:01");
  assert.equal(formatAge(7507), "2:05:07");
  // The hours field is not padded: it has no fixed width to hold, and a tab open for
  // more than nine hours should read "12:00:00", not be truncated to fit.
  assert.equal(formatAge(43_200), "12:00:00");
});

test("formatAge: a fractional or negative input cannot produce a broken field", () => {
  // The caller clamps at zero and floors before calling, so neither reaches here today.
  // Pinned anyway, because "-1:-1" is the failure mode and the clamp living only at the
  // call site is what made this untestable in the first place.
  assert.equal(formatAge(59.9), "00:59");
  assert.equal(formatAge(-1), "00:00");
  assert.equal(formatAge(NaN), "00:00");
});
