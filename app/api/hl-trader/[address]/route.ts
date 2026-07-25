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
  const [perp, spot, fills] = await Promise.all([
    info({ type: "clearinghouseState", user }),
    info({ type: "spotClearinghouseState", user }),
    info({ type: "userFills", user }),
  ]);

  if (perp === null && spot === null && fills === null) {
    return NextResponse.json({ error: "Trader data unavailable" }, { status: 502 });
  }

  return NextResponse.json(
    {
      address: user,
      margin: parseMargin(perp),
      positions: parsePositions(perp),
      spot: parseSpot(spot),
      // Trimmed deliberately: hash/oid/tid/cloid are wallet-identifying internals
      // the UI never renders, so they are not echoed back to the browser.
      fills: parseFills(fills, FILL_LIMIT),
      fetchedAt: Date.now(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    }
  );
}
