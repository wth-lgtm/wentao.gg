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
  /** USD value of `total` at the current spot mid, or null when the wallet cannot be
   * priced — see priceSpot. Never 0 for "we don't know": 2,331,863 UBONK is $5.90 and
   * 0.01 USDH is one cent, so a zero here would be a claim, not a gap. */
  usdValue: number | null;
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
  /**
   * Exchange ORDER id. Kept because it is the only field that says which fills were
   * one decision: a hundred fills from a board address are dozens of separate orders,
   * and the time heuristic that stood in for this collapsed them into ten rows
   * labelled "one order". The dated readings are THE OID SAMPLE in lib/fills.ts —
   * they move between probes, so this does not name a figure.
   */
  oid: number | null;
  /** Parent id of a TWAP: many child oids, one intent, so it groups ahead of oid. */
  twapId: number | null;
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

// The snapshot used to be one object from one route, so the Positions tab waited on
// userFills: timed against api.hyperliquid.xyz, clearinghouseState answers in 0.39-0.49 s
// and spotClearinghouseState in 0.38-0.41 s, while userFills takes 1.16-1.38 s for
// 658-745 KB that only the Trades tab reads. It is two routes and two slices now, so
// each panel waits for its own upstream and nothing else.

/** `/api/hl-trader/[address]` — what the Positions tab reads. */
export interface TraderPositions {
  address: string;
  /** null when the perp call failed: a live clearinghouseState always carries a
   * marginSummary, even for an address that has never traded. */
  margin: MarginSummary | null;
  // null is "upstream did not answer", [] is "upstream answered and held nothing".
  // The two calls are independent, so one can be absent while the other is real —
  // and the route only 502s when both fail. Flattening the absent one into []
  // is what let the panel print "currently flat" over a call that never came back.
  positions: PerpPosition[] | null;
  spot: SpotBalance[] | null;
  fetchedAt: number;
  /** How old the body already was when the handler sent it, on the SERVER clock. Read
   * beside the CDN `age` header through lib/servedAge, never subtracted from ours. */
  servedAgeMs: number;
}

/** `/api/hl-trader/[address]/fills` — what the Trades tab reads. */
export interface TraderFills {
  address: string;
  /** null is "upstream did not answer", [] is "upstream answered with an empty tape".
   * The panel's "a real state, not an error" copy is only ever correct for []. */
  fills: Fill[] | null;
  fetchedAt: number;
  /** As on TraderPositions: server-clock age at send time, for lib/servedAge. */
  servedAgeMs: number;
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

/**
 * null when upstream did not answer; [] when it answered with no non-zero balance.
 *
 * The filter drops only EXACT zeros, which is the honest gate: 1e-6 of a token is a
 * holding the account owns, and a threshold here would be this module deciding what is
 * too small to have. What made that look wrong was the PRINT side — formatSize rounded
 * such a balance to a bare "0" — and that is fixed where it belongs (lib/fills.ts states
 * the bound: "<0.0001"). The dust drawer is the other half: it folds sub-dollar rows away
 * by VALUE without dropping them, and the section's count stays the full total.
 */
export function parseSpot(raw: unknown): SpotBalance[] | null {
  if (raw == null) return null;
  const list = (raw as { balances?: unknown })?.balances;
  if (!Array.isArray(list)) return [];
  return list
    .map((b) => {
      const o = b as Record<string, unknown>;
      // usdValue is not in this payload at all — pricing needs spotMeta and allMids,
      // which are separate calls. It starts as the honest unknown and priceSpot fills
      // it in; a parser cannot price.
      return {
        coin: str(o.coin),
        total: num(o.total),
        hold: num(o.hold),
        usdValue: null,
      };
    })
    .filter((b) => b.coin && b.total !== null && b.total !== 0);
}

/**
 * Token names, keyed by the `index` FIELD rather than by array position.
 *
 * Measured against the live spotMeta on 2026-09-16: 43 of 501 tokens sit at a position
 * that differs from their own index (position 458 holds index 478) and the array is
 * shorter than the highest index it carries, so `tokens[i]` resolved 26 of the 328
 * universe entries to the wrong base name — @367 came back "SPCXX" when it is "WARS" —
 * or off the end of the array entirely. Both callers below go through this.
 */
function tokenNames(spotMeta: unknown): Map<number, string> {
  const out = new Map<number, string>();
  const tokens = (spotMeta as { tokens?: unknown })?.tokens;
  if (!Array.isArray(tokens)) return out;
  for (const t of tokens) {
    const index = (t as { index?: unknown })?.index;
    const name = (t as { name?: unknown })?.name;
    if (typeof index === "number" && typeof name === "string" && name) {
      out.set(index, name);
    }
  }
  return out;
}

/**
 * Readable names for the spot markets, keyed by the market id a fill carries.
 *
 * Spot fills identify their market by INDEX, not ticker: upstream sends coin "@107",
 * which is unreadable on screen and appeared on 5.4% of sampled fills — 52% for one
 * address. This maps it to "HYPE/USDC".
 *
 * The key is the universe entry's own `name` and never its array position:
 * universe[107].name is "@109" live, so a by-position map mislabels almost every spot
 * fill. A pair whose tokens cannot both be named is left OUT, so the fill falls back to
 * upstream's own "@107" — honest, where hiding the row would lose a real trade.
 *
 * Lives here rather than in the fills route because the route had its own copy of the
 * same parse, including the token-index trap above, with nothing testing it. See
 * tests/pairNames.test.ts.
 */
export function pairNames(spotMeta: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const universe = (spotMeta as { universe?: unknown })?.universe;
  if (!Array.isArray(universe)) return out;

  const names = tokenNames(spotMeta);
  if (names.size === 0) return out;

  for (const entry of universe) {
    const name = (entry as { name?: unknown })?.name;
    const pair = (entry as { tokens?: unknown })?.tokens;
    if (typeof name !== "string" || !Array.isArray(pair)) continue;
    const base = typeof pair[0] === "number" ? names.get(pair[0]) : undefined;
    const quote = typeof pair[1] === "number" ? names.get(pair[1]) : undefined;
    if (base && quote) out.set(name, `${base}/${quote}`);
  }
  return out;
}

/**
 * The spot venue's quote token index.
 *
 * Live (2026-09-16): 311 of 328 universe entries quote token 0, which is USDC. The
 * other 17 quote something else — their base needs a second hop to reach dollars, so
 * they stay unpriced rather than being priced against the wrong unit.
 */
const QUOTE_TOKEN = 0;

/**
 * Attach a USD value to each spot balance, from spotMeta + allMids.
 *
 * Without this the panel showed raw coin counts and nothing said that 556,416 HYPE is
 * $43.25M while 2,331,863 UBONK is $5.90 — an order that invited exactly the wrong
 * reading. Pure, and given the RAW upstream payloads rather than a pre-built map,
 * because all three ways to get this wrong are in the parsing:
 *
 *   1. A token's array POSITION in `tokens` is not its `index` — see tokenNames, which
 *      both this and pairNames go through for that reason.
 *   2. The mid is keyed by the UNIVERSE entry's name. 327 of the 328 live pairs are
 *      named "@N" and exactly one is "PURR/USDC"; allMids carries whichever form the
 *      universe used. Keying on the coin instead would hand a token that also has a
 *      perp its PERP mid (HYPE: 77.99 perp against 77.7305 spot on 2026-09-16).
 *   3. The quote token prices at exactly one unit of itself, because that is the unit
 *      the mids are quoted in — not a claim about USDC's peg.
 *
 * Verified end to end on the live 7d #1 wallet: 11 non-zero balances totalling
 * ~$207.51M, of which one row (USDH, $0.01) is under a dollar.
 */
export function priceSpot(
  balances: SpotBalance[] | null,
  spotMeta: unknown,
  allMids: unknown
): SpotBalance[] | null {
  if (balances === null) return null;

  const midByCoin = new Map<string, number>();
  const universe = (spotMeta as { universe?: unknown })?.universe;
  const tokens = (spotMeta as { tokens?: unknown })?.tokens;
  const mids = (allMids ?? null) as Record<string, unknown> | null;

  if (Array.isArray(universe) && Array.isArray(tokens) && mids && typeof mids === "object") {
    const nameByIndex = tokenNames(spotMeta);

    const quote = nameByIndex.get(QUOTE_TOKEN);
    if (quote) midByCoin.set(quote, 1);

    for (const entry of universe) {
      const pairName = (entry as { name?: unknown })?.name;
      const pair = (entry as { tokens?: unknown })?.tokens;
      if (typeof pairName !== "string" || !Array.isArray(pair)) continue;
      if (pair[1] !== QUOTE_TOKEN) continue;
      const base = typeof pair[0] === "number" ? nameByIndex.get(pair[0]) : undefined;
      if (!base || base === quote) continue;
      const mid = num(mids[pairName]);
      if (mid !== null) midByCoin.set(base, mid);
    }
  }

  // A new array of new objects: the caller's rows are upstream's parse and are read
  // again for the coin counts.
  return balances.map((b) => {
    const mid = midByCoin.get(b.coin);
    return {
      ...b,
      usdValue: b.total === null || mid === undefined ? null : b.total * mid,
    };
  });
}

/**
 * How many of the most recent fills the tape asks upstream for. Upstream itself
 * returns up to 2000, so this is a SAMPLE, and the panel states it as one: exported
 * rather than inlined because the visitor-facing cap statement has to be the same
 * number that was actually applied.
 */
export const FILL_LIMIT = 100;

/** null when upstream did not answer; [] when it answered with an empty tape. */
export function parseFills(raw: unknown, limit = FILL_LIMIT): Fill[] | null {
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
      oid: num(o.oid),
      twapId: num(o.twapId),
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
