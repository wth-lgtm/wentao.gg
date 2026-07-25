import { NextResponse } from "next/server";
import {
  ADDRESS_RE,
  parseFills,
  parseMargin,
  parsePositions,
  parseSpot,
} from "@/app/projects/hl-whale-tracker/lib/trader";

// Per-trader snapshot for the Positions and Trades tabs.
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const TIMEOUT_MS = 10_000;
const FILL_LIMIT = 100;

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
// The trap, verified against live data: the name is NOT the array position.
// universe[107].name === "@109". Building this map by index silently mislabels
// almost every spot fill, so it is built by matching the `name` field.
//
// Cached in module scope because the pair list is near-static and this is one extra
// upstream call per cold lambda, not per visitor. It is bounded by construction —
// one map of ~316 entries, replaced wholesale — and keyed only on upstream-supplied
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
    const tokenName = (i: unknown): string | null => {
      if (typeof i !== "number") return null;
      const name = (tokens[i] as { name?: unknown })?.name;
      return typeof name === "string" && name ? name : null;
    };
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

  // Independent requests: one failing must not fail the others, because a trader
  // with no spot balances is a normal case, not an error.
  const [perp, spot, fills, spotNames] = await Promise.all([
    info({ type: "clearinghouseState", user }),
    info({ type: "spotClearinghouseState", user }),
    info({ type: "userFills", user }),
    spotNameMap(),
  ]);

  if (perp === null && spot === null && fills === null) {
    return NextResponse.json({ error: "Trader data unavailable" }, { status: 502 });
  }

  // Resolve here rather than shipping the whole 316-pair table to the browser.
  const parsedFills = parseFills(fills, FILL_LIMIT).map((f) => {
    const label = spotNames.get(f.coin);
    return label ? { ...f, label } : f;
  });

  return NextResponse.json(
    {
      address: user,
      margin: parseMargin(perp),
      positions: parsePositions(perp),
      spot: parseSpot(spot),
      // Trimmed deliberately: hash/oid/tid/cloid are wallet-identifying internals
      // the UI never renders, so they are not echoed back to the browser.
      fills: parsedFills,
      fetchedAt: Date.now(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    }
  );
}
