import { test } from "node:test";
import assert from "node:assert/strict";

import { SCALE_MIN, SCALE_SPAN, SEED, castingFor, jacksForWeeks, unknownOverride } from "../app/lib/connectorJacks";
import { buildDayWindow } from "../app/lib/githubStats";

const ANCHOR = new Date("2026-09-16T12:00:00Z");
const window12 = (counts: Iterable<[string, number]>) => buildDayWindow(ANCHOR, 12, new Map(counts));
// day index k of the 84-day window → its UTC date
const dayAt = (k: number) => window12([])[k].date;

test("one jack per week, oldest first, commits summed over the week's seven UTC days", () => {
  const days = window12([["2026-07-22", 22], ["2026-07-23", 42], ["2026-09-16", 2]]);
  const jacks = jacksForWeeks(days, 12, false, SEED);
  assert.equal(jacks.length, 12);
  assert.equal(jacks[0].week, days[0].date);
  assert.equal(jacks[11].week, days[77].date);
  assert.equal(jacks.reduce((n, j) => n + j.commits, 0), 66);
  // 07-22 is day 27 (week 3), 07-23 is day 28 (week 4), 09-16 is day 83 (week 11)
  assert.deepEqual(jacks.map((j) => j.commits), [0, 0, 0, 22, 42, 0, 0, 0, 0, 0, 0, 2]);
  assert.ok(jacks.every((j) => j.known));
});

test("sizing is relative to the busiest known week: floor 0.86, ceiling 1.2, linear between", () => {
  const days = window12([["2026-07-22", 22], ["2026-07-23", 42], ["2026-09-16", 2]]);
  const jacks = jacksForWeeks(days, 12, false, SEED);
  assert.equal(SCALE_MIN, 0.86);
  assert.equal(SCALE_SPAN, 0.34);
  assert.ok(Math.abs(jacks[4].scale - 1.2) < 1e-9, `busiest ${jacks[4].scale}`);
  assert.ok(Math.abs(jacks[3].scale - (0.86 + 0.34 * 22 / 42)) < 1e-9);
  assert.ok(Math.abs(jacks[11].scale - (0.86 + 0.34 * 2 / 42)) < 1e-9);
  assert.ok(jacks.filter((j) => j.commits === 0).every((j) => j.scale === SCALE_MIN));
});

test("an all-zero window is twelve floor-sized jacks, not a division by zero", () => {
  const jacks = jacksForWeeks(window12([]), 12, false, SEED);
  assert.equal(jacks.length, 12);
  assert.ok(jacks.every((j) => j.scale === SCALE_MIN && j.commits === 0 && j.known));
});

test("an all-equal window sizes every week to the ceiling — the encoding is relative, so equal commits are equal sizes", () => {
  const days = window12(Array.from({ length: 12 }, (_, w) => [dayAt(7 * w + 3), 5] as [string, number]));
  const jacks = jacksForWeeks(days, 12, false, SEED);
  assert.ok(jacks.every((j) => j.commits === 5 && Math.abs(j.scale - 1.2) < 1e-9));
});

test("truncation: a week that begins before the oldest dated commit is UNKNOWN, not quiet", () => {
  // commits only in the newest five weeks; the oldest one lands on week 7's FIRST day
  const counts: [string, number][] = [[dayAt(49), 3], [dayAt(60), 8], [dayAt(70), 1], [dayAt(77), 4], [dayAt(83), 2]];
  const jacks = jacksForWeeks(window12(counts), 12, true, SEED);
  assert.equal(jacks.filter((j) => !j.known).length, 7);
  assert.deepEqual(jacks.map((j) => j.known), [false, false, false, false, false, false, false, true, true, true, true, true]);
  // unknown weeks sit at the floor and claim no commits; known weeks size among themselves
  assert.ok(jacks.slice(0, 7).every((j) => j.scale === SCALE_MIN && j.commits === 0));
  assert.ok(Math.abs(jacks[8].scale - 1.2) < 1e-9, "8 commits is the ceiling over the known weeks");
  // the same counts without the route's cut are twelve known weeks
  assert.equal(jacksForWeeks(window12(counts), 12, false, SEED).filter((j) => !j.known).length, 0);
});

test("truncation boundary: the week CONTAINING the oldest dated commit is partial, so it is unknown too", () => {
  const counts: [string, number][] = [[dayAt(50), 3], [dayAt(83), 2]]; // week 7's second day
  const jacks = jacksForWeeks(window12(counts), 12, true, SEED);
  assert.equal(jacks.filter((j) => !j.known).length, 8);
  assert.equal(jacks[7].known, false);
  assert.equal(jacks[8].known, true);
});

test("a cut-off window with no dated commit at all is twelve unknown weeks", () => {
  const jacks = jacksForWeeks(window12([]), 12, true, SEED);
  assert.ok(jacks.every((j) => !j.known && j.scale === SCALE_MIN));
});

test("casting is fixed by index and never data: 4 accent / 4 white / 4 black, 8 matte : 4 glossy", () => {
  const cast = castingFor(12, SEED);
  const count = (f: (c: { family: string; finish: string }) => boolean) => cast.filter(f).length;
  assert.equal(count((c) => c.family === "accent"), 4);
  assert.equal(count((c) => c.family === "white"), 4);
  assert.equal(count((c) => c.family === "black"), 4);
  assert.equal(count((c) => c.finish === "glossy"), 4);
  assert.equal(count((c) => c.family === "accent" && c.finish === "glossy"), 1);
  assert.equal(count((c) => c.family === "white" && c.finish === "glossy"), 1);
  assert.equal(count((c) => c.family === "black" && c.finish === "glossy"), 2);
  // shuffled, not in declaration order
  assert.notDeepEqual(cast.map((c) => c.family), [...Array(4).fill("accent"), ...Array(4).fill("white"), ...Array(4).fill("black")]);
  // two different windows cast identically
  const a = jacksForWeeks(window12([["2026-09-16", 40]]), 12, false, SEED);
  const b = jacksForWeeks(window12([["2026-07-22", 3], ["2026-08-30", 9]]), 12, true, SEED);
  assert.deepEqual(a.map((j) => [j.family, j.finish]), b.map((j) => [j.family, j.finish]));
  assert.deepEqual(a.map((j) => [j.family, j.finish]), cast.map((c) => [c.family, c.finish]));
});

test("deterministic: the same inputs give the same jacks, a different seed a different casting order", () => {
  const days = window12([["2026-07-22", 22], ["2026-09-16", 2]]);
  assert.deepEqual(jacksForWeeks(days, 12, false, SEED), jacksForWeeks(days, 12, false, SEED));
  const other = jacksForWeeks(days, 12, false, SEED + 1);
  assert.notDeepEqual(other.map((j) => j.family), jacksForWeeks(days, 12, false, SEED).map((j) => j.family));
});

test("the ghost override: N oldest weeks as ghosts only with ?jacksDebug present AND jacksUnknown a positive integer", () => {
  assert.equal(unknownOverride("?jacksDebug=1&jacksUnknown=3"), 3);
  assert.equal(unknownOverride("?jacksUnknown=3&jacksDebug"), 3);
  assert.equal(unknownOverride("?jacksUnknown=3"), 0, "never without the debug flag");
  assert.equal(unknownOverride("?jacksDebug=1"), 0);
  assert.equal(unknownOverride("?jacksDebug=1&jacksUnknown=0"), 0);
  assert.equal(unknownOverride("?jacksDebug=1&jacksUnknown=-2"), 0);
  assert.equal(unknownOverride("?jacksDebug=1&jacksUnknown=2.5"), 0);
  assert.equal(unknownOverride("?jacksDebug=1&jacksUnknown=all"), 0);
  assert.equal(unknownOverride(""), 0);
});
