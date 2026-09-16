import { NextResponse } from "next/server";
import {
  info,
  payloadFresh,
  type CachedPayload,
} from "@/app/projects/hl-whale-tracker/lib/info";
import {
  ADDRESS_RE,
  parseMargin,
  parsePositions,
  parseSpot,
  priceSpot,
} from "@/app/projects/hl-whale-tracker/lib/trader";

// Margin, perp positions and priced spot balances for one trader — what the Positions
// tab reads, and nothing else.
//
// The address is the only user-controlled value in this feature, so it is gated on
// an exact 40-hex pattern BEFORE any outbound request happens — which also means
// this route cannot be used as a generic proxy. The upstream URL is a hardcoded
// constant and the address only ever reaches it inside a JSON body, so the host
// can never be influenced by request input.
//
// Positions move, so the cache window is short. It exists to stop repeated row
// clicks fanning out onto the upstream from a shared egress IP, not to serve
// stale data.
//
// WHY THE FILLS LEFT. This used to answer with userFills too, and the Positions tab
// therefore waited on it: timed against api.hyperliquid.xyz, clearinghouseState comes
// back in 0.39-0.49s and spotClearinghouseState in 0.38-0.41s, while userFills takes
// 1.16-1.38s for 658-745KB that only the Trades tab reads. One JSON object meant one
// wait, so a row click held the Positions skeleton for the slowest call in the set.
// Fills now have their own route (./fills) and the client fires both in parallel, so
// each panel waits for its own upstream. Firing fills LAZILY on Trades-tab open was
// the other option and is worse: the Trades tab is instant today once the snapshot
// lands, and lazy loading would put a fresh ~1s skeleton in front of it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What it takes to put a dollar figure on a spot balance.
//
// Neither payload is about this trader, so both are cached in module scope and cost
// one upstream call per cold lambda rather than one per visitor. They are bounded by
// construction — two payloads, replaced wholesale, keyed only on upstream-supplied
// names, so nothing a visitor sends can grow them.
//
// The GOOD windows differ because the data does: the pair list is near-static (1h), the
// mids are a live market (30s). What that does NOT buy is a mid as fresh as the reading
// it prices, which an earlier version of this comment claimed. A mid can be 30s old when
// the body is generated, and the body is then served from the edge for another 30s —
// 120s more inside stale-while-revalidate — so a value on screen can trail the market by
// roughly a minute, and by up to two and a half in the SWR tail. That is why the panel
// says "valued at the current spot mid … an estimate, not a settled balance" and prints
// the roll-up with a "≈".
//
// A FAILED read gets a much shorter window than a good one, which lib/info's
// payloadFresh owns and tests. Caching a null spotMeta for the full hour meant one
// transient 429 — which Hyperliquid returns on a second sequential call from a shared
// egress IP — cost an HOUR of dash-only USD values, and because missing pricing also
// sets `no-store` below, an hour with no edge cache either: exactly the wrong response
// to being rate-limited. Unpriced balances render the em dash meanwhile, which is
// honest; the coin counts are still exactly what upstream said.
//
// Cost, stated because it is the one thing the split above gave back: on a COLD
// lambda these two calls (spotMeta 0.58-0.81s, allMids 0.65s) are now the route's
// critical path instead of userFills', so a first-ever click is ~0.8s rather than the
// ~0.5s the two state calls alone would allow. Warm — which every click after the
// first on that instance is — they are free and the route answers in ~0.5s. An
// unpriced spot list was not worth protecting 0.3s of a cold start for: the whole
// point is that 2,331,863 UBONK is $5.90 and 556,416 HYPE is $43.25M.
const META_TTL_MS = 60 * 60 * 1000;
const MIDS_TTL_MS = 30 * 1000;

let metaCache: CachedPayload | null = null;
let midsCache: CachedPayload | null = null;

async function spotPricing(): Promise<{ spotMeta: unknown; allMids: unknown }> {
  const now = Date.now();
  // payloadFresh is what applies the short window to a null — see lib/info and
  // tests/info.test.ts.
  const metaFresh = payloadFresh(metaCache, META_TTL_MS, now);
  const midsFresh = payloadFresh(midsCache, MIDS_TTL_MS, now);

  const [spotMeta, allMids] = await Promise.all([
    metaFresh ? metaCache!.value : info({ type: "spotMeta" }),
    midsFresh ? midsCache!.value : info({ type: "allMids" }),
  ]);

  if (!metaFresh) metaCache = { value: spotMeta, at: now };
  if (!midsFresh) midsCache = { value: allMids, at: now };
  return { spotMeta, allMids };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!ADDRESS_RE.test(address)) {
    // Rejected before any network call is made.
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  const user = address.toLowerCase();

  // Independent requests: one failing must not fail the others, because a trader
  // with no spot balances is a normal case, not an error.
  const [perp, spotState, pricing] = await Promise.all([
    info({ type: "clearinghouseState", user }),
    info({ type: "spotClearinghouseState", user }),
    spotPricing(),
  ]);

  if (perp === null && spotState === null) {
    return NextResponse.json({ error: "Trader data unavailable" }, { status: 502 });
  }

  // One upstream failing is a partial answer, and it goes out as nulls rather than
  // empty arrays so the panel can say "unavailable" instead of "flat". A partial
  // body must also not be pinned at the edge: the public header below served that
  // answer to every visitor of the address for up to 150 s, turning one 429 — which
  // Hyperliquid returns on a second sequential call from a shared egress IP — into
  // two and a half minutes of a confident, wrong empty state. Missing PRICING counts
  // too: a spot list whose every value is an em dash is a degraded body, and pinning
  // it would outlive the 30 s window the mids cache is meant to hold it for.
  const partial =
    perp === null ||
    spotState === null ||
    pricing.spotMeta === null ||
    pricing.allMids === null;

  return NextResponse.json(
    {
      address: user,
      margin: parseMargin(perp),
      positions: parsePositions(perp),
      // Priced here rather than in the browser: the pair map is a 136KB table of 328
      // entries and the mids another 1,079 keys, for eleven rows on screen.
      spot: priceSpot(parseSpot(spotState), pricing.spotMeta, pricing.allMids),
      fetchedAt: Date.now(),
      // Zero by construction: this body is built in the handler that sends it, so it has
      // no server-side age of its own — the edge's `age` header carries the only hold.
      // The field is here so the client reads one shape for both trader routes and the
      // leaderboard (lib/servedAge), and so the panel's "As of" never again subtracts
      // this server's `fetchedAt` from the visitor's clock — a visitor running behind
      // saw 00:00 over a two-minute-old edge HIT.
      servedAgeMs: 0,
    },
    {
      headers: {
        "Cache-Control": partial
          ? "no-store"
          : "public, s-maxage=30, stale-while-revalidate=120",
      },
    }
  );
}
