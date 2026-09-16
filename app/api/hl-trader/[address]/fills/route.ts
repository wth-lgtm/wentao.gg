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

// The DERIVED map, memoised beside the raw payload rather than instead of it.
//
// pairNames walks a 311-entry universe and a 501-entry token table to build 311 strings,
// and it was doing that on every request for a payload that changes at most once an hour.
// Keyed on the payload's OBJECT IDENTITY, which is exactly the right invalidation here:
// spotMeta() above returns the same object for the life of the cache entry and a fresh
// read is a fresh object, so this cannot go stale without the raw cache going stale
// first — and the raw payload stays the cache of record, so this route's labels and the
// sibling route's pricing are still built from one read of spotMeta.
let nameCache: { from: unknown; names: Map<string, string> } | null = null;

function spotNames(meta: unknown): Map<string, string> {
  if (nameCache !== null && nameCache.from === meta) return nameCache.names;
  const names = pairNames(meta);
  nameCache = { from: meta, names };
  return names;
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
  //
  // When spotMeta fails outright (`meta === null` after lib/info's timeout or a 429)
  // pairNames returns an EMPTY map, so every spot fill falls back to its index — and on
  // screen "@107" then read as the market's name rather than as a lookup that did not
  // happen, which is the one shape of dishonesty this app spends most of its care on.
  // The body now says so: `pairNamesPartial` is the second signal, and TradesPanel
  // renders one footnote for it when a spot row on the tape is unlabelled. The tape's
  // own contract is untouched — `fills: null` still means upstream did not answer, and
  // the fills here are all present and correct. The short SPOT_TTL_MS on a failed read
  // (see above) is what keeps the footnote from lasting an hour.
  const names = spotNames(meta);
  const pairNamesPartial = names.size === 0;
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
      // what lets the tape say "one order" truthfully — the time heuristic that stood
      // in for them collapsed dozens of orders into ten rows (dated readings: THE OID
      // SAMPLE in lib/fills.ts). `liquidatedUser` rides along too, as the one field
      // that says WHOSE liquidation a fill was (lib/fills liquidationPath); it is an
      // address that is either this URL's or a counterparty's, never a new wallet.
      fills: parsed ?? null,
      pairNamesPartial,
      fetchedAt: Date.now(),
      // Zero by construction, as in the sibling route: built in the handler that sends
      // it, so only the edge's `age` header can age it. Same shape for every reading
      // the client dates (lib/servedAge).
      servedAgeMs: 0,
    },
    {
      headers: {
        // A body whose pair names are missing is not pinned at the edge, the sibling
        // route's treatment for its partial body. The fills are all here and "@107" is
        // upstream's own label, so the tape is honest either way — but the public
        // header held such a body for s-maxage plus the SWR tail, 150 s, and the
        // footnote outlived spotMeta's recovery by that much while a fresh read would
        // have named every pair. no-store costs one upstream userFills per visitor for
        // the length of the failed-spotMeta window, which lib/info already keeps short.
        "Cache-Control": pairNamesPartial
          ? "no-store"
          : "public, s-maxage=30, stale-while-revalidate=120",
      },
    }
  );
}
