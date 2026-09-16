import { NextResponse } from "next/server";
import {
  ADDRESS_RE,
  FILL_LIMIT,
  parseFills,
} from "@/app/projects/hl-whale-tracker/lib/trader";

// One trader's recent fills — what the Trades tab reads, and nothing else.
//
// Split out of ../route.ts because userFills is the slow call in the set: 1.16-1.38s
// for 658-745KB against clearinghouseState's 0.39-0.49s, and the Positions tab, which
// never reads a fill, was waiting for it because the two travelled in one JSON object.
//
// Everything else is deliberately identical to the sibling route: the same 40-hex gate
// before any outbound request (so this cannot be used as a generic proxy), the same
// hardcoded upstream host with the address only ever inside a JSON body, the same 10s
// timeout and the same short edge window, which exists to stop repeated row clicks
// fanning out onto the upstream from a shared egress IP rather than to serve stale data.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const TIMEOUT_MS = 10_000;

// Duplicated from ../route.ts rather than shared: Next's route type plugin rejects any
// export from a route file that is not a recognised handler, so the only way to share
// it is a third module for fourteen lines that neither route would import for any
// other reason.
async function info(body: Record<string, unknown>): Promise<unknown | null> {
  try {
    const res = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Spot pair names.
//
// Spot fills identify their market by INDEX, not ticker: upstream sends coin "@107",
// which is unreadable on screen and appeared on 5.4% of sampled fills — 52% for one
// address. `spotMeta` maps it to "HYPE/USDC".
//
// Two traps, both verified against live data, both of which silently mislabel rows
// rather than failing:
//
//   - The pair name is NOT the array position. universe[107].name === "@109", so
//     building this map by index mislabels almost every spot fill. It is built by
//     matching the `name` field.
//   - A TOKEN's array position is not its `index` either. 43 of the 501 live tokens
//     sit at a differing position (position 458 holds index 478) and the array is
//     shorter than its highest index, so reading tokens[i] resolved 26 of the 328
//     pairs to the wrong base name — @367 came back as "SPCXX/USDC" when it is
//     WARS/USDC — or off the end of the array, which dropped the pair from the map
//     entirely. Both are looked up by `index` now.
//
// Cached in module scope because the pair list is near-static and this is one extra
// upstream call per cold lambda, not per visitor. It is bounded by construction —
// one map of ~311 entries, replaced wholesale — and keyed only on upstream-supplied
// names, so nothing a visitor sends can grow it.
const SPOT_TTL_MS = 60 * 60 * 1000;
let spotCache: { map: Map<string, string>; at: number } | null = null;

async function spotNameMap(): Promise<Map<string, string>> {
  if (spotCache && Date.now() - spotCache.at < SPOT_TTL_MS) return spotCache.map;

  const map = new Map<string, string>();
  const meta = await info({ type: "spotMeta" });
  const universe = (meta as { universe?: unknown })?.universe;
  const tokens = (meta as { tokens?: unknown })?.tokens;

  if (Array.isArray(universe) && Array.isArray(tokens)) {
    const nameByIndex = new Map<number, string>();
    for (const t of tokens) {
      const index = (t as { index?: unknown })?.index;
      const name = (t as { name?: unknown })?.name;
      if (typeof index === "number" && typeof name === "string" && name) {
        nameByIndex.set(index, name);
      }
    }
    const tokenName = (i: unknown): string | null =>
      typeof i === "number" ? nameByIndex.get(i) ?? null : null;

    for (const entry of universe) {
      const name = (entry as { name?: unknown })?.name;
      const pair = (entry as { tokens?: unknown })?.tokens;
      if (typeof name !== "string" || !Array.isArray(pair)) continue;
      const base = tokenName(pair[0]);
      const quote = tokenName(pair[1]);
      if (base && quote) map.set(name, `${base}/${quote}`);
    }
  }

  // An empty map is cached too, so a bad upstream answer costs one call an hour
  // rather than one per request. Unresolved fills fall back to the raw "@107",
  // which is honest — hiding the row would lose a real trade.
  spotCache = { map, at: Date.now() };
  return map;
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

  const [fills, spotNames] = await Promise.all([
    info({ type: "userFills", user }),
    spotNameMap(),
  ]);

  // Nothing else in this body, so an absent tape is the whole answer being absent.
  if (fills === null) {
    return NextResponse.json({ error: "Trader fills unavailable" }, { status: 502 });
  }

  // Resolved here rather than shipping the whole 311-pair table to the browser.
  const parsed = parseFills(fills, FILL_LIMIT)?.map((f) => {
    const label = spotNames.get(f.coin);
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
        // The pair map being empty is not a partial answer about this trader — the
        // fills are all here and an unresolved "@107" is upstream's own label — so
        // unlike the sibling route there is no no-store branch to take.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    }
  );
}
