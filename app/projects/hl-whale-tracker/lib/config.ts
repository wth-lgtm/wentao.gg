// Shared with app/api/hl-leaderboard/route.ts.
//
// Deliberately NOT exported from route.ts: Next's route type plugin rejects any
// export from a route file that isn't a recognised handler, so importing a
// constant out of one fails the build.
export const TTL_S = 300;

// Shown as attribution in the status rail. A display literal — never used to
// build a request; the outbound URL lives in lib/hyperliquid.ts.
export const UPSTREAM_HOST = "stats-data.hyperliquid.xyz";
