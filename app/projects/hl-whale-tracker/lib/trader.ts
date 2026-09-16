// Per-trader data from Hyperliquid's public info API.
//
// Every numeric arrives from upstream as a STRING, and every one is parsed
// explicitly through `num()` below, which returns null rather than 0 for anything
// unparseable. That is the same discipline that fixed the leaderboard: the old
// `parseFloat(x) || 0` is exactly how a shape mismatch became 50 rows of
// confident $0.00.

/** A number, or null — never a silent 0. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface PerpPosition {
  coin: string;
  /** Signed size: negative is short. The sign is the only source of side. */
  szi: number | null;
  side: "LONG" | "SHORT" | "FLAT";
  entryPx: number | null;
  positionValue: number | null;
  unrealizedPnl: number | null;
  /** Return on equity, as a ratio (0.05 = 5%). */
  roe: number | null;
  liquidationPx: number | null;
  marginUsed: number | null;
  leverage: number | null;
  leverageType: string;
  maxLeverage: number | null;
  /** Funding since open from the TRADER's view: positive = received, negative = paid.
   * Upstream cumFunding is cumulative funding PAID (verified: hourly userFunding.usdc
   * receipts since the last size change sum to exactly -cumFunding.sinceChange), so
   * it is negated here. */
  fundingSinceOpen: number | null;
}

export interface SpotBalance {
  coin: string;
  total: number | null;
  /** Portion reserved against open orders. */
  hold: number | null;
}

export interface Fill {
  /** Raw market symbol: "BTC", the spot index "@107", or "xyz:GOOGL". */
  coin: string;
  /**
   * Readable pair name for spot fills, resolved server-side from `spotMeta`.
   * Absent for perps and equities, whose `coin` is already legible.
   */
  label?: string;
  px: number | null;
  sz: number | null;
  /** Upstream's own description, e.g. "Open Short" / "Close Long". */
  dir: string;
  time: number | null;
  closedPnl: number | null;
  fee: number | null;
  feeToken: string;
}

export interface MarginSummary {
  accountValue: number | null;
  totalNtlPos: number | null;
  totalMarginUsed: number | null;
  withdrawable: number | null;
  /** Equity the account must keep to avoid liquidation. Lives at the TOP level of
   * clearinghouseState, not inside marginSummary (live 7d #1: 16,832,367.54 against
   * 108.44M of equity, i.e. 15.5%), and it is the only figure in the payload that
   * says how close the account is to the edge. */
  crossMaintenanceMarginUsed: number | null;
}

export interface TraderSnapshot {
  address: string;
  /** null when the perp call failed: a live clearinghouseState always carries a
   * marginSummary, even for an address that has never traded. */
  margin: MarginSummary | null;
  // null is "upstream did not answer", [] is "upstream answered and held nothing".
  // The three calls are independent, so one can be absent while the others are real —
  // and the route only 502s when all three fail. Flattening the absent one into []
  // is what let the panels print "currently flat" and "no fill history … a real
  // state, not an error" over a call that never came back.
  positions: PerpPosition[] | null;
  spot: SpotBalance[] | null;
  fills: Fill[] | null;
  fetchedAt: number;
}

/** null when upstream did not answer; [] when it answered with no open positions. */
export function parsePositions(raw: unknown): PerpPosition[] | null {
  if (raw == null) return null;
  const list = (raw as { assetPositions?: unknown })?.assetPositions;
  if (!Array.isArray(list)) return [];
  const out: PerpPosition[] = [];
  for (const entry of list) {
    const p = (entry as { position?: Record<string, unknown> })?.position;
    if (!p || typeof p !== "object") continue;
    const coin = str(p.coin);
    if (!coin) continue;
    const szi = num(p.szi);
    const lev = p.leverage as { type?: unknown; value?: unknown } | undefined;
    const funding = p.cumFunding as { sinceOpen?: unknown } | undefined;
    const paid = num(funding?.sinceOpen);
    out.push({
      coin,
      szi,
      // Side comes from the SIGN of szi. Upstream has no side field on a position.
      side: szi === null || szi === 0 ? "FLAT" : szi > 0 ? "LONG" : "SHORT",
      entryPx: num(p.entryPx),
      positionValue: num(p.positionValue),
      unrealizedPnl: num(p.unrealizedPnl),
      roe: num(p.returnOnEquity),
      liquidationPx: num(p.liquidationPx),
      marginUsed: num(p.marginUsed),
      leverage: num(lev?.value),
      leverageType: str(lev?.type),
      maxLeverage: num(p.maxLeverage),
      fundingSinceOpen: paid === null ? null : -paid,
    });
  }
  return out;
}

/** null when upstream did not answer; [] when it answered with no non-zero balance. */
export function parseSpot(raw: unknown): SpotBalance[] | null {
  if (raw == null) return null;
  const list = (raw as { balances?: unknown })?.balances;
  if (!Array.isArray(list)) return [];
  return list
    .map((b) => {
      const o = b as Record<string, unknown>;
      return { coin: str(o.coin), total: num(o.total), hold: num(o.hold) };
    })
    .filter((b) => b.coin && b.total !== null && b.total !== 0);
}

/** null when upstream did not answer; [] when it answered with an empty tape. */
export function parseFills(raw: unknown, limit = 100): Fill[] | null {
  if (raw == null) return null;
  // A 200 whose body is not a list is a shape problem, not a failed call, so it keeps
  // the empty answer: the absent signal is reserved for the null info() returns.
  if (!Array.isArray(raw)) return [];
  const out: Fill[] = [];
  for (const f of raw) {
    const o = f as Record<string, unknown>;
    const coin = str(o.coin);
    if (!coin) continue;
    out.push({
      coin,
      px: num(o.px),
      sz: num(o.sz),
      dir: str(o.dir),
      time: num(o.time),
      closedPnl: num(o.closedPnl),
      fee: num(o.fee),
      feeToken: str(o.feeToken),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function parseMargin(raw: unknown): MarginSummary | null {
  const m = (raw as { marginSummary?: Record<string, unknown> })?.marginSummary;
  if (!m || typeof m !== "object") return null;
  return {
    accountValue: num(m.accountValue),
    totalNtlPos: num(m.totalNtlPos),
    totalMarginUsed: num(m.totalMarginUsed),
    withdrawable: num((raw as Record<string, unknown>).withdrawable),
    crossMaintenanceMarginUsed: num(
      (raw as Record<string, unknown>).crossMaintenanceMarginUsed
    ),
  };
}

/** The one gate on the only user-supplied value in this feature. */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
