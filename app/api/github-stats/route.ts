import { NextResponse } from "next/server";

import {
  bucketByUtcDay,
  commitWindowStart,
  fetchCommitWindow,
  topLanguages,
  utcDayKey,
} from "@/app/lib/githubStats";

// Fetch GitHub stats server-side and cache them, so the browser never hits GitHub's
// anonymous 60-req/hr-per-IP limit directly. With revalidate, GitHub is queried at most
// ~once per 5 minutes from the server and shared across all visitors.

const REPO = "wth-lgtm/wentao.gg";
const API = "https://api.github.com";
const REVALIDATE = 300;

// The widest grid CommitHeatmap draws (it falls back to 8 weeks on mobile).
const WINDOW_WEEKS = 12;

// Page budget for the commit window. Each distinct URL revalidates at most 12x/hr, so the
// anonymous ceiling of 60/hr per IP buys 5 URLs: the head count, the language list, and 3
// pages of commits. A token raises the ceiling to 5000/hr, so allow two more pages then.
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
  return fetch(url, { headers: ghHeaders(), next: { revalidate: REVALIDATE } });
}

function gh(path: string) {
  return ghFetch(`${API}${path}`);
}

export async function GET() {
  try {
    // True total commit count: request 1 per page and read the last-page number from the
    // Link header (works past 100, unlike counting a single page).
    const headRes = await gh(`/repos/${REPO}/commits?per_page=1`);
    if (!headRes.ok) throw new Error(`commits ${headRes.status}`);
    let total = 1;
    const link = headRes.headers.get("link");
    if (link) {
      const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
      total = m ? parseInt(m[1], 10) : 1;
    } else {
      total = (await headRes.json()).length;
    }

    // Per-day counts for the activity grid: ask for the WINDOW, not the head of the log.
    // A single per_page=100 page only ever covered the 100 newest commits, so on
    // 2026-09-16 the `days` map summed to exactly 100 and 2026-07-22's 22 commits — a day
    // git puts inside the 12-week window — rendered as an empty cell. Any burst of >100
    // commits blanked the rest of the quarter the same way.
    //
    // `since` is truncated to 00:00:00Z (see commitWindowStart) so the URL stays identical
    // for a whole day and the fetch cache can actually hit; a to-the-second bound would
    // make every visitor a GitHub request. Note GitHub filters `since` on COMMITTER date
    // while we bucket AUTHOR date; committer >= author, so a rebased commit can land a day
    // or two before windowStart, which the client's own window already ignores.
    //
    // A page failing (403 at the ceiling above is the likeliest) or the cap being reached
    // keeps whatever pages are in hand and reports `truncated`, rather than throwing away a
    // commit total and language list that were fetched successfully. The client must then
    // say the window is incomplete instead of drawing unknown days as zeros.
    const windowStart = commitWindowStart(new Date(), WINDOW_WEEKS);
    const pageCap = process.env.GITHUB_TOKEN ? PAGE_CAP_TOKEN : PAGE_CAP_ANON;
    const { authored, truncated } = await fetchCommitWindow(
      ghFetch,
      `${API}/repos/${REPO}/commits?since=${windowStart.toISOString()}&per_page=100`,
      pageCap,
    );
    const days = bucketByUtcDay(authored);

    // Language breakdown.
    const langRes = await gh(`/repos/${REPO}/languages`);
    const languages: Record<string, number> = langRes.ok ? await langRes.json() : {};
    const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    const langArray = topLanguages(languages, 3);

    return NextResponse.json(
      {
        commits: total,
        linesOfCode: Math.round(totalBytes / 40),
        languages: langArray,
        days,
        // What the `days` map actually covers, so a consumer never has to assume.
        windowStart: utcDayKey(windowStart),
        truncated,
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return NextResponse.json({ error: true }, { status: 200 });
  }
}
