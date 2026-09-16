import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import {
  ALL_PERIODS,
  fetchLeaderboard,
  mapAllPeriods,
} from "@/app/projects/hl-whale-tracker/lib/hyperliquid";
import { SWR_S, TTL_S } from "@/app/projects/hl-whale-tracker/lib/config";

// Reduces Hyperliquid's leaderboard to the top 50 per period, server-side.
//
// The upstream body is ~37MB ungzipped and it was being downloaded INTO THE BROWSER, once
// per time-filter click, to render fifty rows. Now it never leaves the server: this returns
// roughly 36KB covering all four periods at once, so switching filters costs no network
// at all.
//
// TWO cache layers, and each one is holding a different thing up.
//
// The CDN header at the bottom caps the fan-out onto Hyperliquid from a shared egress IP
// and answers most visitors in ~45ms. What it does NOT do is bound the upstream pull:
// Vercel's edge cache is regional (measured x-vercel-id sfo1::iad1) and evicts low-traffic
// keys, so on a personal site most first visits in a region paid the full 37MB download —
// 3.0s at 12.3MB/s, plus a JSON.parse that needs several hundred MB of lambda heap — and
// then ran rowToMetrics four times over 45,089 rows. The upstream itself only changes every
// ~10 minutes (Last-Modified vs Age on its own response), so nearly all of that was spent
// re-deriving a body that had not moved.
//
// So the REDUCED result goes in Next's Data Cache: a CDN miss becomes a ~36KB Data Cache
// read instead of the 37MB pull, verified locally as 3.22s cold then 0.0045s. How far
// that sharing reaches is NOT verified from here — the intent is a cache shared more
// widely than the per-region edge, but whether two Vercel regions hit one entry can only
// be measured after deploy (hit the route from two regions, or after an eviction, and
// check `updatedAt` is the same stamp and the second region's function duration is tens
// of milliseconds). Worst case it is per-instance and this is still one pull per lambda
// per TTL_S instead of one per CDN miss.
//
// Caching the upstream FETCH instead cannot work: Vercel's Data Cache
// silently drops items over ~2MB, so at 37MB the entry would never be written, which is
// why lib/hyperliquid.ts keeps `cache: "no-store"` on the upstream call. The 36KB output
// is three orders of magnitude inside that limit. `"use cache"` is not available here
// because next.config.ts does not enable cacheComponents.
//
// Neither layer can be bypassed by a client asking for one. Vercel consumes s-maxage at
// the edge and ignores a request `Cache-Control: no-cache` (verified: a no-cache GET
// still came back `x-vercel-cache: HIT, age: 54` with an identical body), and
// unstable_cache is keyed on the callback's arguments, which a request cannot reach. The
// refresh button therefore reports what actually happened — see useLeaderboard's
// `unchanged` reading — rather than implying work a click cannot cause.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Above UPSTREAM_TIMEOUT_MS so the 20s abort is what fires on a slow upstream, rather
// than the platform killing the function mid-parse.
export const maxDuration = 25;

const UPSTREAM_TIMEOUT_MS = 20_000;

/**
 * The 37MB pull and the reduction, behind one Data Cache entry.
 *
 * Three things have to happen INSIDE this callback and none of them is cosmetic:
 *
 *   - It THROWS on failure. unstable_cache writes whatever the callback RESOLVES with,
 *     null included, so returning fetchLeaderboard's `{data: null, error}` shape would
 *     pin a 502 for the whole TTL in every region. Only a rejection skips the write, so
 *     a bad upstream costs one retry rather than five minutes of a dark board.
 *   - The AbortSignal is created here. It needs a fresh timer per invocation, and a
 *     signal passed in as an argument would be JSON-stringified into the cache key.
 *   - `updatedAt` is stamped here. It is what the rail's AGE field ages (SoundingRail's
 *     SnapshotAge), and stamping it in the handler would report ~0s for a body up to
 *     TTL_S old — the instrument asserting a freshness it does not have. The handler
 *     below DOES stamp a second figure at send time, `servedAgeMs`, but as a duration
 *     derived from this one: how long the cached body has already sat here.
 */
const getReduced = unstable_cache(
  async () => {
    const { data, error } = await fetchLeaderboard(
      AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    );
    if (error || !data) throw new Error(error ?? "Leaderboard unavailable");

    const mapped = mapAllPeriods(data);
    if (!mapped) throw new Error("Unexpected leaderboard response shape");

    // Rows arrived but NOTHING came back from any of them — not one complete row and
    // not one row we understood well enough to call incomplete. That is a payload whose
    // shape changed under us, and it fails loudly instead of returning fifty rows of
    // $0.00, which is what happened for who knows how long.
    //
    // The guard used to fire on rowsParsed alone, which also caught the much likelier
    // case where upstream renames ONE field: every row then lands as `partial` and a
    // board that could have said "45,086 rows arrived, all of them incomplete" went
    // dark instead. rowsPartial travels in the payload now (see lib/hyperliquid.ts,
    // which published it for exactly this) and the rail reports it, so a partial
    // payload is served WITH its explanation rather than suppressed.
    const noneUnderstood =
      mapped.rowsParsed === 0 &&
      ALL_PERIODS.every((p) => (mapped.rowsPartial[p] ?? 0) === 0);
    if (mapped.rowsSeen > 0 && noneUnderstood) {
      throw new Error("Unexpected leaderboard response shape");
    }

    return {
      periods: mapped.periods,
      updatedAt: Date.now(),
      rowsSeen: mapped.rowsSeen,
      rowsPartial: mapped.rowsPartial,
    };
  },
  ["hl-leaderboard"],
  { revalidate: TTL_S, tags: ["hl-leaderboard"] }
);

export async function GET() {
  let reduced: Awaited<ReturnType<typeof getReduced>>;
  try {
    reduced = await getReduced();
  } catch (e) {
    // A throw leaves nothing cached, so the next request retries rather than being
    // served a remembered failure.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Leaderboard unavailable" },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      ...reduced,
      // The rail shows the real cache window rather than a hardcoded guess.
      ttlSeconds: TTL_S,
      // How old the body already is as it leaves — both stamps are THIS server's clock,
      // so the subtraction is within one clock and the client never has to compare its
      // own Date.now() against `updatedAt`. It exists because the CDN `age` header is the
      // client's other source and it is absent on a MISS, while a MISS here is answered
      // out of the Data Cache with a body up to TTL_S old: without this the rail read AGE
      // 00:00 over a five-minute-old snapshot and the STALE cue and the wake schedule
      // inherited the under-count. The client takes the larger of the two (lib/servedAge).
      servedAgeMs: Math.max(0, Date.now() - reduced.updatedAt),
    },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${TTL_S}, stale-while-revalidate=${SWR_S}`,
      },
    }
  );
}
