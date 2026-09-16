// One POST to Hyperliquid's public info API, shared by the two trader routes.
//
// SERVER-ONLY, and now enforced rather than asserted — see the guard below. It had
// only ever been a comment, which is the kind of boundary that holds right up until
// someone needs one constant out of the file.
//
// It is a separate module from lib/trader.ts deliberately: that file is in
// the client bundle (TradesPanel imports FILL_LIMIT, lib/urlState imports ADDRESS_RE),
// and an outbound fetch helper carrying the upstream URL does not belong there. It is
// not in either route file either, because Next's route type plugin rejects any export
// from a route that is not a recognised handler — so the only place two routes can share
// it is a module like this one. It was copied into both before that.
//
// The URL is a hardcoded constant and every caller passes the address inside the JSON
// BODY, so no request input can influence the host. That, plus the 40-hex gate each
// route applies before calling, is what stops these routes being a generic proxy.

// The enforcement the SERVER-ONLY note above had been missing.
//
// `import "server-only"` is the canonical spelling and is what this should become the
// moment the package is a real dependency. It is not one: nothing in the tree ships it
// and Next resolves the bare specifier through a bundler ALIAS, so the import makes
// this module unloadable under `node --import tsx` and takes tests/info.test.ts down
// with it (verified: MODULE_NOT_FOUND on `server-only` from this file). Adding the
// package is a dependency change this pass is not allowed to make, so the boundary is
// enforced in a form both the bundler and the test runner can swallow. It costs one
// comparison at module evaluation and never fires on a server.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/info is server-only: it carries the upstream URL and the outbound fetch, and must not be imported into a client bundle"
  );
}

const INFO_URL = "https://api.hyperliquid.xyz/info";

/** Long enough for the 745KB userFills payload, short enough to fail inside the
 * platform's own function limit. */
export const INFO_TIMEOUT_MS = 10_000;

/**
 * null for a non-2xx, a thrown fetch, or the timeout — never a throw and never an empty
 * object. That distinction is the whole contract the parsers in lib/trader.ts are built
 * on: null is "upstream did not answer", and it is what stops a 429 (which Hyperliquid
 * returns on a second sequential call from a shared egress IP) rendering as "this whale
 * holds nothing".
 */
export async function info(body: Record<string, unknown>): Promise<unknown | null> {
  try {
    const res = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** A payload held in module scope, with the clock reading when it was fetched. */
export interface CachedPayload {
  /** null is the failure `info()` returns — see above. */
  value: unknown;
  at: number;
}

/**
 * How long a FAILED read is allowed to stand.
 *
 * Both trader routes cache spotMeta (1h) and allMids (30s) so they cost one upstream
 * call per cold lambda rather than one per visitor. Caching a null for those windows
 * meant one transient 429 cost an HOUR of "@107" on every spot fill and an hour of em
 * dashes in the USD column — and because the positions route folds missing pricing into
 * `partial`, which sets `Cache-Control: no-store`, an hour with no edge cache either.
 * Being rate-limited is exactly when the fan-out cap matters, so the failure is held
 * long enough to collapse a burst of clicks onto one call and no longer.
 */
export const FAILED_PAYLOAD_TTL_MS = 15_000;

/**
 * Whether a cached payload may still be used, given the window a GOOD answer earns.
 *
 * `now` is passed in rather than read here so the decision is pure and testable — see
 * tests/info.test.ts. A failure never stands longer than a success would, which is why
 * the short window is a floor rather than a flat replacement.
 */
export function payloadFresh(
  entry: CachedPayload | null,
  goodTtlMs: number,
  now: number
): boolean {
  if (entry === null) return false;
  const ttl =
    entry.value === null ? Math.min(goodTtlMs, FAILED_PAYLOAD_TTL_MS) : goodTtlMs;
  return now - entry.at < ttl;
}
