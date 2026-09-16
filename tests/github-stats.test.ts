import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bucketByUtcDay,
  buildDayWindow,
  commitWindowStart,
  currentStreak,
  parseNextLink,
  topLanguages,
  utcDayKey,
  type CommitDay,
} from "../app/lib/githubStats";

const DAY_MS = 86_400_000;

// A run of days ending "today", newest last — the shape buildDayWindow hands the card.
function run(counts: number[]): CommitDay[] {
  const end = Date.UTC(2026, 8, 16);
  return counts.map((count, i) => ({
    date: new Date(end - (counts.length - 1 - i) * DAY_MS).toISOString().slice(0, 10),
    count,
  }));
}

test("utcDayKey keys on the UTC calendar day", () => {
  assert.equal(utcDayKey(new Date("2026-09-16T04:40:00Z")), "2026-09-16");
  assert.equal(utcDayKey(new Date("2026-09-16T00:00:00Z")), "2026-09-16");
  assert.equal(utcDayKey(new Date("2026-09-15T23:59:59Z")), "2026-09-15");
});

test("commitWindowStart truncates to 00:00Z so the upstream URL is stable all day", () => {
  const justAfterMidnight = commitWindowStart(new Date("2026-09-16T00:04:00Z"), 12);
  const justBeforeMidnight = commitWindowStart(new Date("2026-09-16T23:59:59Z"), 12);
  // 84 grid days + 1 day of slack back from 2026-09-16.
  assert.equal(justAfterMidnight.toISOString(), "2026-06-23T00:00:00.000Z");
  assert.equal(justBeforeMidnight.toISOString(), justAfterMidnight.toISOString());
});

test("commitWindowStart reaches back past the oldest cell the grid draws", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const cells = buildDayWindow(now, 12, new Map());
  assert.equal(cells.length, 84);
  assert.ok(utcDayKey(commitWindowStart(now, 12)) < cells[0].date);
});

test("bucketByUtcDay keys on the UTC day, not the author's offset", () => {
  const days = bucketByUtcDay([
    "2026-09-15T21:23:28-07:00", // 04:23Z the NEXT day — the grid's column is UTC
    "2026-09-16T04:40:00Z",
    "2026-07-22T00:00:00Z",
    "2026-07-22T23:59:59Z",
    undefined,
    "",
    "not a date",
  ]);
  assert.deepEqual(days, { "2026-09-16": 2, "2026-07-22": 2 });
});

test("bucketByUtcDay of nothing is an empty map, not a zero", () => {
  assert.deepEqual(bucketByUtcDay([]), {});
});

test("buildDayWindow keeps the busy day the 100-commit head used to drop", () => {
  // 2026-07-22 held 22 commits inside the 12-week window and was absent from the live
  // payload because the newest 100 commits started on 07-23.
  const counts = new Map([
    ["2026-07-22", 22],
    ["2026-07-23", 42],
    ["2026-09-16", 2],
  ]);
  const cells = buildDayWindow(new Date("2026-09-16T04:40:00Z"), 12, counts);
  assert.equal(cells.length, 84);
  assert.equal(cells[0].date, "2026-06-25");
  assert.equal(cells[cells.length - 1].date, "2026-09-16");
  assert.deepEqual(
    cells.find((d) => d.date === "2026-07-22"),
    { date: "2026-07-22", count: 22 },
  );
  assert.equal(
    cells.reduce((n, d) => n + d.count, 0),
    66,
  );
  assert.equal(cells.filter((d) => d.count === 0).length, 81);
});

test("buildDayWindow ignores counts outside the window it draws", () => {
  const counts = new Map([["2026-01-01", 99]]);
  const cells = buildDayWindow(new Date("2026-09-16T04:40:00Z"), 12, counts);
  assert.equal(
    cells.reduce((n, d) => n + d.count, 0),
    0,
  );
});

test("buildDayWindow walks UTC days, so a DST change cannot duplicate or skip a column", () => {
  // 2026-11-01 is the US DST fallback; local-date arithmetic drifts across it.
  const cells = buildDayWindow(new Date("2026-11-05T08:00:00Z"), 12, new Map());
  assert.equal(new Set(cells.map((d) => d.date)).size, 84);
  for (let i = 1; i < cells.length; i++) {
    const step =
      Date.parse(`${cells[i].date}T00:00:00Z`) - Date.parse(`${cells[i - 1].date}T00:00:00Z`);
    assert.equal(step, DAY_MS);
  }
});

test("buildDayWindow honours the mobile 8-week grid", () => {
  assert.equal(buildDayWindow(new Date("2026-09-16T04:40:00Z"), 8, new Map()).length, 56);
});

test("currentStreak counts consecutive days ending today", () => {
  assert.equal(currentStreak(run([0, 0, 1, 4, 2])), 3);
  assert.equal(currentStreak(run([1, 1, 1])), 3);
  assert.equal(currentStreak(run([5])), 1);
});

test("currentStreak survives an empty today by counting the run ending yesterday", () => {
  // GitHub's convention: a streak is not broken until the day AFTER the last commit ends,
  // so at 08:00Z before the day's first push an active streak must not read 0.
  assert.equal(currentStreak(run([0, 1, 1, 1, 0])), 3);
  assert.equal(currentStreak(run([1, 0])), 1);
});

test("currentStreak is 0 when neither today nor yesterday has a commit", () => {
  assert.equal(currentStreak(run([1, 1, 0, 0])), 0);
  assert.equal(currentStreak(run([0])), 0);
  assert.equal(currentStreak([]), 0);
});

test("parseNextLink returns the rel=next page while one exists", () => {
  const link =
    '<https://api.github.com/repositories/1/commits?since=2026-06-23T00%3A00%3A00.000Z&per_page=100&page=2>; rel="next", ' +
    '<https://api.github.com/repositories/1/commits?since=2026-06-23T00%3A00%3A00.000Z&per_page=100&page=2>; rel="last"';
  assert.equal(
    parseNextLink(link),
    "https://api.github.com/repositories/1/commits?since=2026-06-23T00%3A00%3A00.000Z&per_page=100&page=2",
  );
});

test("parseNextLink returns null on the last page and on a missing header", () => {
  const lastPage =
    '<https://api.github.com/repositories/1/commits?page=1>; rel="prev", ' +
    '<https://api.github.com/repositories/1/commits?page=1>; rel="first"';
  assert.equal(parseNextLink(lastPage), null);
  assert.equal(parseNextLink(null), null);
  assert.equal(parseNextLink(undefined), null);
  assert.equal(parseNextLink(""), null);
});

test("topLanguages drops a share that rounds to 0% instead of spending a chip on it", () => {
  // Live /languages: TypeScript 402049 / CSS 40361 / JavaScript 559 bytes. JS is 0.13%,
  // which Math.round printed as the "JavaScript 0%" chip.
  assert.deepEqual(topLanguages({ TypeScript: 402049, CSS: 40361, JavaScript: 559 }, 3), [
    { name: "TypeScript", percentage: 91 },
    { name: "CSS", percentage: 9 },
  ]);
});

test("topLanguages drops every sub-1% share, not just an exact zero", () => {
  assert.deepEqual(topLanguages({ TypeScript: 99600, Shell: 400 }, 3), [
    { name: "TypeScript", percentage: 100 },
  ]);
});

test("topLanguages keeps a share that rounds to exactly 1%", () => {
  assert.deepEqual(topLanguages({ TypeScript: 99000, Shell: 1000 }, 3), [
    { name: "TypeScript", percentage: 99 },
    { name: "Shell", percentage: 1 },
  ]);
});

test("topLanguages returns the largest shares first, capped at the limit", () => {
  assert.deepEqual(topLanguages({ CSS: 20000, TypeScript: 60000, Rust: 15000, Go: 5000 }, 3), [
    { name: "TypeScript", percentage: 60 },
    { name: "CSS", percentage: 20 },
    { name: "Rust", percentage: 15 },
  ]);
});

test("topLanguages of an empty repo is empty, never a 0% chip", () => {
  assert.deepEqual(topLanguages({}, 3), []);
  assert.deepEqual(topLanguages({ TypeScript: 0 }, 3), []);
});
