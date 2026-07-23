import { NextResponse } from "next/server";

// Fetch GitHub stats server-side and cache them, so the browser never hits GitHub's
// anonymous 60-req/hr-per-IP limit directly. With revalidate, GitHub is queried at most
// ~once per 5 minutes from the server and shared across all visitors.

const REPO = "wth-lgtm/wentao.gg";
const API = "https://api.github.com";
const REVALIDATE = 300;

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

function gh(path: string) {
  return fetch(`${API}${path}`, { headers: ghHeaders(), next: { revalidate: REVALIDATE } });
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

    // Recent commits → per-day counts for the activity grid.
    const recentRes = await gh(`/repos/${REPO}/commits?per_page=100`);
    const recent: Array<{ commit?: { author?: { date?: string } } }> = recentRes.ok
      ? await recentRes.json()
      : [];
    const days: Record<string, number> = {};
    for (const c of recent) {
      const date = c?.commit?.author?.date?.split("T")[0];
      if (date) days[date] = (days[date] || 0) + 1;
    }

    // Language breakdown.
    const langRes = await gh(`/repos/${REPO}/languages`);
    const languages: Record<string, number> = langRes.ok ? await langRes.json() : {};
    const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    const langArray = Object.entries(languages)
      .map(([name, bytes]) => ({ name, percentage: Math.round((bytes / totalBytes) * 100) }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 3);

    return NextResponse.json(
      { commits: total, linesOfCode: Math.round(totalBytes / 40), languages: langArray, days },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return NextResponse.json({ error: true }, { status: 200 });
  }
}
