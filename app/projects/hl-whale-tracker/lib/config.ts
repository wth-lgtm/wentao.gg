// Shared with app/api/hl-leaderboard/route.ts.
//
// Deliberately NOT exported from route.ts: Next's route type plugin rejects any
// export from a route file that isn't a recognised handler, so importing a
// constant out of one fails the build.
export const TTL_S = 300;

// Shown as attribution in the status rail. A display literal — never used to
// build a request; the outbound URL lives in lib/hyperliquid.ts.
export const UPSTREAM_HOST = "stats-data.hyperliquid.xyz";

// The `stale-while-revalidate` on the same response. Past TTL_S the snapshot is no
// longer current, but for SWR_S after that the CDN is still contracted to serve it
// while it revalidates — so TTL_S + SWR_S is the first moment nothing is guaranteeing
// the reading, which is the only moment the rail can honestly call it stale. It lives
// here for the same reason TTL_S does, and because it was duplicated as a literal in
// both the route and SoundingRail: two copies of a cache window is how a rail ends up
// promising five minutes over a twenty-minute body.
export const SWR_S = 900;
