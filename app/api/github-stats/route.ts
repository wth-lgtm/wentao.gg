import { NextResponse } from "next/server";

import {
  bucketByUtcDay,
  commitWindowStart,
  parseNextLink,
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
    const windowStart = commitWindowStart(new Date(), WINDOW_WEEKS);
    const pageCap = process.env.GITHUB_TOKEN ? PAGE_CAP_TOKEN : PAGE_CAP_ANON;
    const authored: string[] = [];
    let truncated = false;
    let next: string | null =
      `${API}/repos/${REPO}/commits?since=${windowStart.toISOString()}&per_page=100`;
    for (let page = 0; next !== null; page++) {
      if (page >= pageCap) {
        truncated = true;
        break;
      }
      const pageRes: Response = await ghFetch(next);
      if (!pageRes.ok) {
        // The first page failing leaves no day data at all, and an all-dark 84-cell grid
        // beside a confident commit total is the lie this route exists to avoid — fail the
        // whole payload so the card shows its unavailable state. A later page failing is
        // partial data, which is honest as long as we say so.
        if (page === 0) throw new Error(`commits window ${pageRes.status}`);
        truncated = true;
        break;
      }
      const batch: Array<{ commit?: { author?: { date?: string } } }> = await pageRes.json();
      for (const c of batch) authored.push(c?.commit?.author?.date ?? "");
      next = parseNextLink(pageRes.headers.get("link"));
    }
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
