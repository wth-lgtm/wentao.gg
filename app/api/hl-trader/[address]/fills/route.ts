import { NextResponse } from "next/server";
import {
  info,
  payloadFresh,
  type CachedPayload,
} from "@/app/projects/hl-whale-tracker/lib/info";
import {
  ADDRESS_RE,
  FILL_LIMIT,
  pairNames,
  parseFills,
} from "@/app/projects/hl-whale-tracker/lib/trader";

// One trader's recent fills — what the Trades tab reads, and nothing else.
//
// Split out of ../route.ts because userFills is the slow call in the set: 1.16-1.38s
// for 658-745KB against clearinghouseState's 0.39-0.49s, and the Positions tab, which
// never reads a fill, was waiting for it because the two travelled in one JSON object.
//
// Everything else is deliberately identical to the sibling route, and shared with it
// rather than copied: the same lib/info helper, the same 40-hex gate before any outbound
// request, the same short edge window — which exists to stop repeated row clicks fanning
// out onto the upstream from a shared egress IP rather than to serve stale data.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Spot pair names.
//
// Spot fills identify their market by INDEX, not ticker: upstream sends coin "@107",
// which is unreadable on screen and appeared on 5.4% of sampled fills — 52% for one
// address. lib/trader.ts's pairNames maps it to "HYPE/USDC", and it lives there with
// tests because two different fields on this payload are not what they look like (the
// pair name is not the array position, and neither is a token's index) — this route had
// its own untested copy of that parse.
//
// The RAW payload is what gets cached here, not the derived map, so the sibling route's
// pricing and this route's labels can never be built from two different reads of
// spotMeta. The pair list is near-static, so this is one extra upstream call per cold
// lambda, not per visitor, and it is bounded by construction: one payload, replaced
// wholesale, keyed only on upstream-supplied names.
//
// A FAILED read gets a much shorter window than a good one, which lib/info's
// payloadFresh owns and tests: caching a null for the full hour meant one transient 429
// — which Hyperliquid returns on a second sequential call from a shared egress IP — cost
// an hour of "@107" on every spot row.
const SPOT_TTL_MS = 60 * 60 * 1000;
let spotCache: CachedPayload | null = null;

async function spotMeta(): Promise<unknown> {
  const now = Date.now();
  if (payloadFresh(spotCache, SPOT_TTL_MS, now)) return spotCache!.value;

  const value = await info({ type: "spotMeta" });
  spotCache = { value, at: now };
  return value;
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

  const [fills, meta] = await Promise.all([
    info({ type: "userFills", user }),
    spotMeta(),
  ]);

  // Nothing else in this body, so an absent tape is the whole answer being absent.
  if (fills === null) {
    return NextResponse.json({ error: "Trader fills unavailable" }, { status: 502 });
  }

  // Resolved here rather than shipping the whole 311-pair table to the browser. An
  // unresolved fill keeps upstream's own "@107", which is honest — hiding the row would
  // lose a real trade.
  const names = pairNames(meta);
  const parsed = parseFills(fills, FILL_LIMIT)?.map((f) => {
    const label = names.get(f.coin);
    return label ? { ...f, label } : f;
  });

  return NextResponse.json(
    {
      address: user,
      // Trimmed deliberately, but not indiscriminately: hash/tid/cloid stay behind
      // as internals the UI never renders. `oid` and `twapId` do ride along — they
      // identify an ORDER, not a wallet (the wallet is already the URL), and they are
      // what lets the tape say "one order" truthfully: the 7d #1 address's hundred
      // most recent fills carry 73 distinct oids, which the time heuristic that stood
      // in for them collapsed into ten rows.
      fills: parsed ?? null,
      fetchedAt: Date.now(),
    },
    {
      headers: {
        // An empty pair map is not a partial answer about this trader — the fills are
        // all here and "@107" is upstream's own label — so unlike the sibling route
        // there is no no-store branch to take.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    }
  );
}
