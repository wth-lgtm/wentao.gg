// Pinned to a DST-OBSERVING zone, and the pin is load-bearing rather than decorative.
// Every function under test keys on the UTC calendar day; under the runner's default TZ
// — UTC in CI — a test named "a DST change cannot duplicate or skip a column" cannot
// fail for the reason it names, because there is no DST and no local/UTC divergence to
// get wrong. America/Los_Angeles gives both. Assigning process.env.TZ at runtime
// re-notifies ICU, and node:test runs each file in its own process, so the pin is local
// to this file.
process.env.TZ = "America/Los_Angeles";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bucketByUtcDay,
  buildDayWindow,
  commitWindowStart,
  currentStreak,
  fetchCommitWindow,
  parseNextLink,
  topLanguages,
  totalCommits,
  utcDayKey,
  type CommitDay,
  type PagedResponse,
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
  // The 12-week window ending 2026-11-05 contains 2026-11-01, the US DST fallback, and
  // the viewer here is pinned to the zone that observes it (see the top of the file).
  const cells = buildDayWindow(new Date("2026-11-05T08:00:00Z"), 12, new Map());
  assert.equal(new Set(cells.map((d) => d.date)).size, 84);
  for (let i = 1; i < cells.length; i++) {
    const step =
      Date.parse(`${cells[i].date}T00:00:00Z`) - Date.parse(`${cells[i - 1].date}T00:00:00Z`);
    assert.equal(step, DAY_MS);
  }
});

test("buildDayWindow ends on the UTC day even when the local day is the one before", () => {
  // 02:00Z on the 5th is 18:00 on the 4th in the pinned zone, so this assertion is the
  // one the TZ pin buys: under TZ=UTC the two days are the same and it proves nothing.
  const now = new Date("2026-11-05T02:00:00Z");
  assert.equal(now.toLocaleDateString("en-CA"), "2026-11-04");
  const cells = buildDayWindow(now, 12, new Map());
  assert.equal(cells[cells.length - 1].date, "2026-11-05");
  // commitWindowStart keys on the same UTC day, so the two ends agree.
  assert.equal(utcDayKey(commitWindowStart(now, 12)), "2026-08-12");
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

// A stand-in for GitHub's paged /commits: each entry is one URL's answer.
interface FakePage {
  ok?: boolean;
  status?: number;
  dates?: string[];
  body?: unknown;
  next?: string;
}

function fakeGitHub(pages: Record<string, FakePage>) {
  const calls: string[] = [];
  const impl = async (url: string): Promise<PagedResponse> => {
    calls.push(url);
    const page = pages[url];
    if (!page) throw new Error(`unexpected fetch: ${url}`);
    const ok = page.ok !== false;
    return {
      ok,
      status: page.status ?? (ok ? 200 : 403),
      json: async () =>
        page.body !== undefined
          ? page.body
          : (page.dates ?? []).map((date) => ({ commit: { author: { date } } })),
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "link" && page.next ? `<${page.next}>; rel="next"` : null,
      },
    };
  };
  return { impl, calls };
}

// The origin the pager is allowed to follow a `next` page to, and the only origin the
// route's own fetch will attach a token to.
const API = "https://api.github.com";

const P1 = "https://api.github.com/commits?since=2026-06-23T00:00:00.000Z&per_page=100";
const P2 = `${P1}&page=2`;
const P3 = `${P1}&page=3`;

test("fetchCommitWindow follows rel=next to the end of the window", async () => {
  const gh = fakeGitHub({
    [P1]: { dates: ["2026-09-16T04:40:00Z"], next: P2 },
    [P2]: { dates: ["2026-07-22T10:00:00Z", "2026-07-22T11:00:00Z"] },
  });
  const win = await fetchCommitWindow(gh.impl, P1, 3, API);
  assert.equal(win.truncated, false);
  assert.deepEqual(win.authored, [
    "2026-09-16T04:40:00Z",
    "2026-07-22T10:00:00Z",
    "2026-07-22T11:00:00Z",
  ]);
  assert.deepEqual(gh.calls, [P1, P2]);
});

test("fetchCommitWindow stops at the page cap and says the window is cut off", async () => {
  const gh = fakeGitHub({
    [P1]: { dates: ["2026-09-16T04:40:00Z"], next: P2 },
    [P2]: { dates: ["2026-09-15T04:40:00Z"], next: P3 },
    [P3]: { dates: ["2026-07-22T10:00:00Z"] },
  });
  const win = await fetchCommitWindow(gh.impl, P1, 2, API);
  assert.equal(win.truncated, true);
  assert.equal(win.authored.length, 2);
  assert.deepEqual(gh.calls, [P1, P2], "must not fetch past the cap");
});

test("fetchCommitWindow keeps the rest of the payload when the FIRST page fails", async () => {
  // 403 at the anonymous ceiling is the likeliest failure and usually has not stopped the
  // head-count and language fetches, so it must not throw the whole card away.
  const gh = fakeGitHub({ [P1]: { ok: false, status: 403 } });
  const win = await fetchCommitWindow(gh.impl, P1, 3, API);
  assert.deepEqual(win, { authored: [], truncated: true });
});

test("fetchCommitWindow keeps the pages it has when a LATER page fails", async () => {
  const gh = fakeGitHub({
    [P1]: { dates: ["2026-09-16T04:40:00Z"], next: P2 },
    [P2]: { ok: false, status: 502 },
  });
  const win = await fetchCommitWindow(gh.impl, P1, 3, API);
  assert.deepEqual(win, { authored: ["2026-09-16T04:40:00Z"], truncated: true });
});

test("fetchCommitWindow treats a body that is not a commit list as a cut-off window", async () => {
  const gh = fakeGitHub({ [P1]: { body: { message: "API rate limit exceeded" } } });
  const win = await fetchCommitWindow(gh.impl, P1, 3, API);
  assert.deepEqual(win, { authored: [], truncated: true });
});

test("fetchCommitWindow reports a complete window when one page holds it all", async () => {
  const gh = fakeGitHub({ [P1]: { dates: ["2026-09-16T04:40:00Z"] } });
  const win = await fetchCommitWindow(gh.impl, P1, 3, API);
  assert.deepEqual(win, { authored: ["2026-09-16T04:40:00Z"], truncated: false });
});

test("fetchCommitWindow of an empty window is empty and NOT truncated", async () => {
  const gh = fakeGitHub({ [P1]: { dates: [] } });
  assert.deepEqual(await fetchCommitWindow(gh.impl, P1, 3, API), { authored: [], truncated: false });
});

test("parseNextLink reads rel as a token list, not as a substring", () => {
  const page2 = "https://api.github.com/repositories/1/commits?page=2";
  // `rel` is a whitespace-separated token list (RFC 8288). Matching the substring
  // "next" accepted a rel that merely STARTS with it, and a parameter that merely ends
  // with "rel" — neither is a next page, and following one spends a GitHub request and
  // a page of the cap on a URL nobody asked for.
  assert.equal(parseNextLink(`<${page2}>; rel="nextpage"`), null);
  assert.equal(parseNextLink(`<${page2}>; data-rel="next"`), null);
  // A genuine multi-token rel still resolves — the last page of a two-page walk can be
  // both.
  assert.equal(parseNextLink(`<${page2}>; rel="next last"`), page2);
  assert.equal(parseNextLink(`<${page2}>; rel="last next"`), page2);
  // Both spellings the grammar allows, and rel values are case-insensitive.
  assert.equal(parseNextLink(`<${page2}>; rel=next`), page2);
  assert.equal(parseNextLink(`<${page2}>; rel="NEXT"`), page2);
});

test("fetchCommitWindow will not follow a next page off the API origin", async () => {
  // The Link header is an upstream INPUT that decides where the next request goes, and
  // the route attaches a bearer token to every request it makes — so an off-origin
  // `next` is a credential leak, not just a wasted fetch. The walk stops and says the
  // window is cut off, which is what the card already knows how to render.
  const seen: string[] = [];
  const page = (link: string | null, body: unknown): PagedResponse => ({
    ok: true,
    status: 200,
    json: async () => body,
    headers: { get: () => link },
  });
  const commit = (date: string) => ({ commit: { author: { date } } });
  const result = await fetchCommitWindow(
    async (url) => {
      seen.push(url);
      return page('<https://evil.example/repositories/1/commits?page=2>; rel="next"', [
        commit("2026-09-16T04:00:00Z"),
      ]);
    },
    "https://api.github.com/repositories/1/commits?page=1",
    5,
    "https://api.github.com"
  );
  assert.deepEqual(seen, ["https://api.github.com/repositories/1/commits?page=1"]);
  assert.equal(result.truncated, true);
  // The page that DID arrive is kept: the commit total and languages come from separate
  // requests and a refused page must not discard them.
  assert.deepEqual(result.authored, ["2026-09-16T04:00:00Z"]);
});

test("fetchCommitWindow skips a commit with no author date rather than pushing a blank", async () => {
  // `?? ""` pushed a sentinel that bucketByUtcDay then silently dropped — two places
  // deciding the same thing, and an array of dates carrying a value that is not one.
  const result = await fetchCommitWindow(
    async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { commit: { author: { date: "2026-09-16T04:00:00Z" } } },
        { commit: { author: {} } },
        {},
      ],
      headers: { get: () => null },
    }),
    "https://api.github.com/repositories/1/commits?page=1",
    5,
    "https://api.github.com"
  );
  assert.deepEqual(result.authored, ["2026-09-16T04:00:00Z"]);
  assert.equal(result.truncated, false);
});

test("totalCommits prefers the Link header's last page and never invents a count", () => {
  const last =
    '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="prev", ' +
    '<https://api.github.com/repositories/1/commits?per_page=1&page=1467>; rel="last"';
  assert.equal(totalCommits(last, []), 1467);
  // No Link header means one page, so the body IS the count.
  assert.equal(totalCommits(null, [{}]), 1);
  assert.equal(totalCommits(null, []), 0);
  // A non-array body is GitHub telling us something — a rate-limit message, most likely.
  // `.length` on it was `undefined`, which JSON.stringify DROPS, so the card received a
  // payload with no `commits` key at all.
  assert.equal(totalCommits(null, { message: "API rate limit exceeded" }), null);
  assert.equal(totalCommits(null, null), null);
  // A Link header with no rel="last" is the one-page case too.
  assert.equal(totalCommits('<https://api.github.com/x?page=1>; rel="first"', [{}, {}]), 2);
});
