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
}

export interface TraderSnapshot {
  address: string;
  margin: MarginSummary | null;
  positions: PerpPosition[];
  spot: SpotBalance[];
  fills: Fill[];
  /** True when upstream answered but held nothing — a real fact, not a failure. */
  fetchedAt: number;
}

export function parsePositions(raw: unknown): PerpPosition[] {
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
      fundingSinceOpen: num(funding?.sinceOpen),
    });
  }
  return out;
}

export function parseSpot(raw: unknown): SpotBalance[] {
  const list = (raw as { balances?: unknown })?.balances;
  if (!Array.isArray(list)) return [];
  return list
    .map((b) => {
      const o = b as Record<string, unknown>;
      return { coin: str(o.coin), total: num(o.total), hold: num(o.hold) };
    })
    .filter((b) => b.coin && b.total !== null && b.total !== 0);
}

export function parseFills(raw: unknown, limit = 100): Fill[] {
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
  };
}

/** The one gate on the only user-supplied value in this feature. */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
