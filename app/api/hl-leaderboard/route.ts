import { NextResponse } from "next/server";
import {
  fetchLeaderboard,
  mapAllPeriods,
} from "@/app/projects/hl-whale-tracker/lib/hyperliquid";
import { SWR_S, TTL_S } from "@/app/projects/hl-whale-tracker/lib/config";

// Reduces Hyperliquid's leaderboard to the top 50 per period, server-side.
//
// The upstream body is ~33MB ungzipped and it was being downloaded INTO THE BROWSER, once
// per time-filter click, to render fifty rows. Now it never leaves the server: this returns
// roughly 50KB covering all four periods at once, so switching filters costs no network
// at all.
//
// Caching is set on OUR response for the CDN rather than with next:{revalidate} on the
// upstream fetch, because Vercel's Data Cache silently drops items over ~2MB — at 33MB the
// upstream call would never actually be cached. Caching our small response instead also
// caps the fan-out onto Hyperliquid from a shared egress IP.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 20_000;

export async function GET() {
  const { data, error } = await fetchLeaderboard(
    AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  );

  if (error || !data) {
    return NextResponse.json(
      { error: error ?? "Leaderboard unavailable" },
      { status: 502 }
    );
  }

  const mapped = mapAllPeriods(data);

  // Rows arrived but none of them parsed → the payload shape changed under us. Say so
  // instead of returning fifty rows of $0.00, which is what happened for who knows how long.
  if (!mapped || (mapped.rowsSeen > 0 && mapped.rowsParsed === 0)) {
    return NextResponse.json(
      { error: "Unexpected leaderboard response shape" },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      periods: mapped.periods,
      updatedAt: Date.now(),
      rowsSeen: mapped.rowsSeen,
      // The rail shows the real cache window rather than a hardcoded guess.
      ttlSeconds: TTL_S,
    },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${TTL_S}, stale-while-revalidate=${SWR_S}`,
      },
    }
  );
}
