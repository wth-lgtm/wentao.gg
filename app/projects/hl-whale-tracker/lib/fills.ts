// Fill interpretation. Pure functions, no I/O — everything here is derived from a
// snapshot already in memory.
//
// Three things measured against live data drive this file, and each one contradicts
// the obvious implementation:
//
//  1. A "fill" is not an order. Sampling fourteen top-50 addresses, one whale's 100
//     most recent fills were THREE actual orders sliced into pieces — 58 consecutive
//     ETH shorts of 0.0157 each. Rendering raw fills there means printing one
//     near-identical row fifty-eight times. Compression measured 5x to 33x.
//  2. `dir` is a structured pair, not a label. The eight observed values decompose
//     cleanly into an action and a side, which lets the UI carry direction with
//     glyph + word instead of a string nobody can scan.
//  3. Fees arrive in DIFFERENT CURRENCIES — USDC, HYPE and UZEC across one sample.
//     A single summed fee number would add unlike units and state a false total.

import { Fill, num } from "./trader";

// How far apart two fills can be and still belong to the same order. Slices of one
// order land within milliseconds of each other; a minute is loose enough to absorb a
// slow book without merging two genuinely separate decisions.
const SAME_ORDER_WINDOW_MS = 60_000;

export type FillAction = "OPEN" | "CLOSE" | "FLIP" | "SPOT" | "OTHER";
export type FillSide = "LONG" | "SHORT" | "BUY" | "SELL" | "NONE";

/**
 * Which market a fill happened on. Discovered by reading live payloads rather than
 * documentation — the top fifty trade all three:
 *
 *   PERP    plain ticker, e.g. "BTC", "ETH", "WLD"
 *   SPOT    a pair INDEX, e.g. "@107", which is meaningless until resolved
 *   EQUITY  an "xyz:"-prefixed tokenised stock, e.g. "xyz:GOOGL", "xyz:NVDA"
 *
 * One sampled address traded nothing but equity perps, so collapsing these into one
 * undifferentiated "coin" column would hide that its whole book is US tech.
 */
export type Venue = "PERP" | "SPOT" | "EQUITY";

const EQUITY_PREFIX = "xyz:";

export function venueOf(coin: string): Venue {
  if (coin.startsWith("@")) return "SPOT";
  if (coin.startsWith(EQUITY_PREFIX)) return "EQUITY";
  return "PERP";
}

/**
 * Display name for a coin.
 *
 * `resolved` is the server's spot-pair lookup, which is the only way "@107" can
 * become "HYPE/USDC". When it is absent the raw symbol shows through — an
 * unresolved "@107" is honest, whereas hiding the row would lose a real trade.
 */
export function coinLabel(coin: string, resolved?: string): string {
  if (resolved) return resolved;
  if (coin.startsWith(EQUITY_PREFIX)) return coin.slice(EQUITY_PREFIX.length);
  return coin;
}

export interface DirFacets {
  action: FillAction;
  side: FillSide;
  /** Closing PnL only exists once a position is reduced or reversed. */
  realises: boolean;
}

// The eight values actually observed upstream, by frequency over 1,300 fills:
// Open Short 551, Close Short 382, Open Long 140, Close Long 89, Buy 69,
// Long > Short 34, Short > Long 34, Sell 1.
const DIR_TABLE: Record<string, DirFacets> = {
  "Open Long": { action: "OPEN", side: "LONG", realises: false },
  "Open Short": { action: "OPEN", side: "SHORT", realises: false },
  "Close Long": { action: "CLOSE", side: "LONG", realises: true },
  "Close Short": { action: "CLOSE", side: "SHORT", realises: true },
  // A flip closes one side and opens the other in a single fill, so it does realise.
  "Long > Short": { action: "FLIP", side: "SHORT", realises: true },
  "Short > Long": { action: "FLIP", side: "LONG", realises: true },
  Buy: { action: "SPOT", side: "BUY", realises: false },
  Sell: { action: "SPOT", side: "SELL", realises: false },
};

/**
 * Decompose upstream's `dir` string. Unknown values degrade to a neutral facet
 * rather than throwing: the vocabulary belongs to Hyperliquid and may grow, and a
 * new order type should render plainly, not blank the table.
 */
export function dirFacets(dir: string): DirFacets {
  return DIR_TABLE[dir] ?? { action: "OTHER", side: "NONE", realises: false };
}

export interface Order {
  /** Stable within one snapshot: the newest fill's time plus the coin and dir. */
  key: string;
  coin: string;
  label: string;
  venue: Venue;
  dir: string;
  facets: DirFacets;
  /** Count of raw fills collapsed into this order. Always shown when > 1. */
  fills: number;
  /** Summed size in coin units, or null if any slice failed to parse. */
  size: number | null;
  /** Summed size x price. */
  notional: number | null;
  /** Volume-weighted average price, or null when it cannot be computed. */
  vwap: number | null;
  /** Realised PnL, summed across slices — null when this order realises nothing. */
  closedPnl: number | null;
  /** Fees keyed by token, because they are not all the same currency. */
  fees: Record<string, number>;
  /** Newest and oldest fill timestamps in the group. */
  latest: number | null;
  earliest: number | null;
}

/** A fill carrying the server's resolved spot-pair name, when it found one. */
export type LabelledFill = Fill & { label?: string };

/**
 * Collapse consecutive fills that share a coin and direction into single orders.
 *
 * Only CONSECUTIVE runs merge. Grouping globally by coin+dir would fuse two
 * decisions made hours apart into one line and invent an order that never existed.
 * Upstream delivers newest-first and that order is preserved.
 */
export function groupFills(fills: LabelledFill[]): Order[] {
  const out: Order[] = [];

  for (const f of fills) {
    const prev = out[out.length - 1];
    const t = f.time;
    const contiguous =
      prev !== undefined &&
      prev.coin === f.coin &&
      prev.dir === f.dir &&
      // A null timestamp cannot be proven contiguous, so it starts a new group.
      t !== null &&
      prev.earliest !== null &&
      Math.abs(prev.earliest - t) <= SAME_ORDER_WINDOW_MS;

    if (!contiguous) {
      const facets = dirFacets(f.dir);
      out.push({
        key: `${t ?? out.length}-${f.coin}-${f.dir}`,
        coin: f.coin,
        label: coinLabel(f.coin, f.label),
        venue: venueOf(f.coin),
        dir: f.dir,
        facets,
        fills: 1,
        size: f.sz,
        notional: f.sz !== null && f.px !== null ? f.sz * f.px : null,
        vwap: null,
        closedPnl: facets.realises ? f.closedPnl : null,
        fees: feeEntry({}, f),
        latest: t,
        earliest: t,
      });
      continue;
    }

    prev.fills += 1;
    // A null anywhere in the run poisons the sum deliberately: a total computed from
    // an unknown slice is not a total. This is the `parseFloat(x) || 0` trap that
    // produced fifty confident $0.00 rows on the leaderboard.
    prev.size = prev.size !== null && f.sz !== null ? prev.size + f.sz : null;
    prev.notional =
      prev.notional !== null && f.sz !== null && f.px !== null
        ? prev.notional + f.sz * f.px
        : null;
    if (prev.facets.realises) {
      prev.closedPnl =
        prev.closedPnl !== null && f.closedPnl !== null
          ? prev.closedPnl + f.closedPnl
          : prev.closedPnl ?? f.closedPnl;
    }
    prev.fees = feeEntry(prev.fees, f);
    if (t !== null) prev.earliest = t;
  }

  // VWAP once per order, from the finished sums. Guarded against a zero or absent
  // denominator so it yields null instead of NaN or Infinity.
  for (const o of out) {
    o.vwap = o.notional !== null && o.size !== null && o.size !== 0 ? o.notional / o.size : null;
  }

  return out;
}

function feeEntry(into: Record<string, number>, f: LabelledFill): Record<string, number> {
  const fee = f.fee;
  if (fee === null || fee === 0) return into;
  const token = f.feeToken || "USDC";
  return { ...into, [token]: (into[token] ?? 0) + fee };
}

/**
 * Total fees keyed by token. Deliberately not a single number: adding a HYPE fee to
 * a USDC fee produces a figure in no currency at all.
 */
export function feeTotals(fills: LabelledFill[]): Record<string, number> {
  let acc: Record<string, number> = {};
  for (const f of fills) acc = feeEntry(acc, f);
  return acc;
}

/**
 * Realised PnL across the fills that actually realise something.
 *
 * `closedPnl` is 0 on every opening fill, where it means "not applicable" rather
 * than "broke even" — six of fourteen sampled addresses had zero realising fills in
 * their window. `count` lets the caller say so instead of printing a hollow $0.00.
 */
export function realisedTotal(fills: LabelledFill[]): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const f of fills) {
    if (!dirFacets(f.dir).realises || f.closedPnl === null) continue;
    total += f.closedPnl;
    count += 1;
  }
  return { total, count };
}

/** Oldest and newest timestamps present, for the window the fills actually cover. */
export function fillSpan(fills: LabelledFill[]): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  for (const f of fills) {
    const t = num(f.time);
    if (t === null) continue;
    if (t < from) from = t;
    if (t > to) to = t;
  }
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
}

/** Clock time in the viewer's own zone. Fills span minutes, so seconds matter. */
export function formatClock(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Compact elapsed label: 8s, 4m, 3h, 2d. */
export function formatElapsed(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/** Coin-unit size: large counts need no decimals, fractional ones need four. */
export function formatSize(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1_000 ? 0 : abs >= 1 ? 2 : 4;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * Price in the quote currency. Spans $0.34 (WLD) to $64,148 (BTC) in one sample, so
 * a fixed precision is wrong at one end or the other.
 */
export function formatPrice(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1_000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Fee amounts are small and multi-token, so the token travels with the number. */
export function formatFee(amount: number, token: string): string {
  const abs = Math.abs(amount);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: digits })} ${token}`;
}

/**
 * A negative fee is a maker REBATE — the exchange paid the trader for providing
 * liquidity. Four of thirteen sampled addresses were net-negative in USDC, so
 * labelling every one of these "fees" would invert the meaning of the number.
 */
export function isRebate(amount: number): boolean {
  return amount < 0;
}
