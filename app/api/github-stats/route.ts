import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

// The `@/` alias, consistently. This route reached for it while CommitHeatmap.tsx reads
// the same module as "../lib/githubStats" — two spellings of one import is how a moved
// file breaks one call site and not the other. The alias is the right one to keep here:
// a route four directories deep would otherwise say "../../../lib/githubStats".
import {
  bucketByUtcDay,
  commitWindowStart,
  fetchCommitWindow,
  topLanguages,
  totalCommits,
  utcDayKey,
} from "@/app/lib/githubStats";

// Fetch GitHub stats server-side and cache them, so the browser never hits GitHub's
// anonymous 60-req/hr-per-IP limit directly. GitHub is queried at most ~once per 5 minutes
// from the server and the result is shared across all visitors.
//
// The 5-minute cache holds the WHOLE payload as ONE entry, so every field comes from one
// instant. With a per-URL fetch cache each upstream URL had its own 300 s lifetime, so a
// push that moved the commit-page boundary could leave a fresh page 1 beside a stale page 2:
// measured on 2026-09-15, one render reported 2026-07-23 as 38 commits while git — and the
// next render — said 42. Every upstream read is therefore `no-store` and they are spent
// together: 5 requests per regeneration (head count + up to 3 commit pages + languages),
// at most ~12 times an hour — the same 60/hr anonymous budget as before, now buying one
// coherent snapshot instead of five drifting ones. A single cache key also keeps the
// upstream URLs stable, which is what the per-fetch revalidate was there to protect.
//
// Both layers are load-bearing. `no-store` reads at the top level of the handler make Next
// classify the route as dynamic, which ignores `export const revalidate` entirely: measured
// against `next start`, that spent 4 GitHub requests on EVERY request (used 35 -> 39 -> 43),
// i.e. the 60/hr budget gone after 15 visitors. Reading them inside unstable_cache keeps the
// handler prerenderable, and `next build` then reports this route as static with
// `Revalidate 5m`.
export const revalidate = 300;

const REPO = "wth-lgtm/wentao.gg";
const API = "https://api.github.com";

// The widest grid CommitHeatmap draws (it falls back to 8 weeks on mobile).
const WINDOW_WEEKS = 12;

// Page budget for the commit window. A regeneration happens at most 12x/hr, so the
// anonymous ceiling of 60/hr per IP buys 5 requests: the head count, the language list, and
// 3 pages of commits. A token raises the ceiling to 5000/hr, so allow two more pages then.
const PAGE_CAP_ANON = 3;
const PAGE_CAP_TOKEN = 5;

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "wentao.gg",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional: set GITHUB_TOKEN in the environment for a 5000/hr limit (not required).
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function ghFetch(url: string) {
  // No per-URL caching — the one snapshot entry above is what holds the payload together.
  // Every request from here carries the bearer token when one is configured, which is
  // why fetchCommitWindow is handed API as its allowed origin: the URLs it follows come
  // out of GitHub's Link header, and a credential must not go wherever a response header
  // points.
  return fetch(url, { headers: ghHeaders(), cache: "no-store" });
}

function gh(path: string) {
  return ghFetch(`${API}${path}`);
}

const loadStats = unstable_cache(
  async () => {
    // True total commit count: request 1 per page and read the last-page number from the
    // Link header (works past 100, unlike counting a single page). totalCommits owns the
    // two readings and the case that used to fall between them — `.length` on a body that
    // is not a list was `undefined`, and an undefined field is DROPPED by JSON.stringify,
    // so the card received a snapshot with no `commits` key and rendered whatever that
    // coerced to. A count we cannot read is the same failure as a head page we cannot
    // fetch, so it takes the same exit.
    const headRes = await gh(`/repos/${REPO}/commits?per_page=1`);
    if (!headRes.ok) throw new Error(`commits ${headRes.status}`);
    const total = totalCommits(headRes.headers.get("link"), await headRes.json());
    if (total === null) throw new Error("commits: no readable count on the head page");

    // Per-day counts for the activity grid: ask for the WINDOW, not the head of the log.
    // A single per_page=100 page only ever covered the 100 newest commits, so on
    // 2026-09-16 the `days` map summed to exactly 100 and 2026-07-22's 22 commits — a day
    // git puts inside the 12-week window — rendered as an empty cell. Any burst of >100
    // commits blanked the rest of the quarter the same way.
    //
    // `since` is truncated to 00:00:00Z (see commitWindowStart) so every regeneration
    // inside one UTC day asks for the same range and two snapshots cannot disagree about
    // where the grid starts. It is NOT about a fetch cache: the reads here are all
    // `no-store` inside one unstable_cache entry, so the URL is not a cache key and the
    // budget is spent per regeneration whatever the bound says — the version of this
    // comment that claimed otherwise outlived the cache it described.
    // Note GitHub filters `since` on COMMITTER date
    // while we bucket AUTHOR date; committer >= author, so a rebased commit can land a day
    // or two before windowStart, which the client's own window already ignores.
    //
    // A page failing (403 at the ceiling above is the likeliest) or the cap being reached
    // keeps whatever pages are in hand and reports `truncated`, rather than throwing away a
    // commit total and language list that were fetched successfully. The client must then
    // say the window is incomplete instead of drawing unknown days as zeros.
    // One instant for the window AND the snapshot day, so the two can never disagree.
    const generatedAt = new Date();
    const windowStart = commitWindowStart(generatedAt, WINDOW_WEEKS);
    const pageCap = process.env.GITHUB_TOKEN ? PAGE_CAP_TOKEN : PAGE_CAP_ANON;
    const { authored, truncated } = await fetchCommitWindow(
      ghFetch,
      `${API}/repos/${REPO}/commits?since=${windowStart.toISOString()}&per_page=100`,
      pageCap,
      API,
    );
    const days = bucketByUtcDay(authored);

    // Language breakdown.
    const langRes = await gh(`/repos/${REPO}/languages`);
    const languages: Record<string, number> = langRes.ok ? await langRes.json() : {};
    const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    const langArray = topLanguages(languages, 3);

    return {
      commits: total,
      linesOfCode: Math.round(totalBytes / 40),
      languages: langArray,
      days,
      // What the `days` map actually covers, so a consumer never has to assume.
      windowStart: utcDayKey(windowStart),
      // The UTC day this snapshot was taken. The entry is served for up to 15 minutes past a
      // 5-minute regeneration and the CDN can hold it across a UTC midnight, so a viewer
      // whose today is later than this must not draw today's column as a zero — the card
      // ends its grid on this day and says so. Emitted rather than inferred from
      // `windowStart`: a client inverting the window with its own copy of WINDOW_WEEKS would
      // mislabel every visitor the day this constant changed.
      snapshotDay: utcDayKey(generatedAt),
      truncated,
    };
  },
  ["github-stats"],
  { revalidate: 300, tags: ["github-stats"] },
);

export async function GET() {
  try {
    return NextResponse.json(await loadStats(), {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    // A throw leaves no unstable_cache ENTRY, so the next regeneration re-asks GitHub.
    // That is all it ever meant: this response is still a 200 on a route declaring
    // `revalidate = 300`, so without a header of its own the failure was cacheable and
    // the ISR/CDN layer could hand `{ error: true }` to every visitor for five minutes —
    // exactly the remembered failure the old comment claimed could not happen. `no-store`
    // is what makes the sentence true.
    return NextResponse.json(
      { error: true },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
