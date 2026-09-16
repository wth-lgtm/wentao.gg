// Fill interpretation. Pure functions, no I/O — everything here is derived from a
// snapshot already in memory.
//
// Three things measured against live data drive this file, and each one contradicts
// the obvious implementation:
//
//  1. A "fill" is not an order. Sampling fourteen top-50 addresses, one whale's 100
//     most recent fills were THREE actual orders sliced into pieces — 58 consecutive
//     ETH shorts of 0.0157 each. Rendering raw fills there means printing one
//     near-identical row fifty-eight times. Compression measured 5x to 33x. WHICH
//     fills were one order is a fact upstream ships as `oid`, not something to infer
//     (see THE OID SAMPLE below for the reading that settled it).
//  2. `dir` is a structured pair, not a label. The observed values decompose cleanly
//     into an action and a side, which lets the UI carry direction with glyph + word
//     instead of a string nobody can scan. The vocabulary is Hyperliquid's and it
//     GROWS — settlement and dust-conversion fills were live and unmapped — so an
//     unmapped dir now reads its realised PnL off the data instead of assuming there
//     is none.
//  3. Fees arrive in DIFFERENT CURRENCIES — USDC, HYPE and UZEC across one sample.
//     A single summed fee number would add unlike units and state a false total.

import { Fill, num } from "./trader";

// ── THE OID SAMPLE ────────────────────────────────────────────────────────────
/*
 * The ONE place the oid reading is written down, because it was asserted in four
 * files and the four had already drifted apart.
 *
 * Re-probed on the dates below against the live 7d #1 address's 100 most recent
 * `userFills`, and the count MOVES — it is a property of how that address happened to
 * be trading that hour, not a constant:
 *
 *   2026-09-15   73 distinct oids   (the reading the spec was written on)
 *   2026-09-15   76 oids / 75 orders   (a same-day re-run, hours later)
 *   2026-09-16   57 oids / 57 orders   (0x5b5d5120…f298c060, this file's re-probe)
 *
 * So the durable fact is the ORDER OF MAGNITUDE and never the exact figure: a hundred
 * fills from an address like this are dozens of separate orders, and the time
 * heuristic this replaced collapsed them into ten rows while telling the visitor each
 * row was "one order". Any file that needs the number cites this constant rather than
 * restating it, which is what stops the next re-probe leaving three stale copies.
 * Referred to elsewhere as "THE OID SAMPLE"; a constant would only be an export
 * nothing imports.
 */

// How far apart two fills can be and still belong to the same order, for the fills
// that arrive with no order id — see groupFills, where this is the fallback and not
// the rule. Slices of one order land within milliseconds of each other; a minute is
// loose enough to absorb a slow book without merging two genuinely separate decisions.
const SAME_ORDER_WINDOW_MS = 60_000;

export type FillAction = "OPEN" | "CLOSE" | "FLIP" | "SPOT" | "SETTLE" | "OTHER";
export type FillSide = "LONG" | "SHORT" | "BUY" | "SELL" | "NONE";

/**
 * Which market a fill happened on. Discovered by reading live payloads rather than
 * documentation — the top fifty trade all three:
 *
 *   PERP    plain ticker, e.g. "BTC", "ETH", "WLD"
 *   SPOT    a pair INDEX, e.g. "@107", which is meaningless until resolved, or the
 *           one canonically NAMED pair, "PURR/USDC"
 *   EQUITY  an "xyz:"-prefixed tokenised stock, e.g. "xyz:GOOGL", "xyz:NVDA"
 *
 * One sampled address traded nothing but equity perps, so collapsing these into one
 * undifferentiated "coin" column would hide that its whole book is US tech.
 */
export type Venue = "PERP" | "SPOT" | "EQUITY";

const EQUITY_PREFIX = "xyz:";

export function venueOf(coin: string): Venue {
  // A slash is as much a spot marker as the "@": universe[0] is the one pair upstream
  // writes as a name rather than an index, and spot fills report the universe name,
  // so a PURR/USDC fill arrived with a slash and was badged a perp.
  if (coin.startsWith("@") || coin.includes("/")) return "SPOT";
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
  /**
   * Column word for the rows where the action alone would mislabel them. Deliberately
   * short: .hl-dir is 10px nowrap tracked mono, so printing the raw dir ("SPOT DUST
   * CONVERSION") would widen the column for every other row.
   */
  word?: string;
}

// The values actually observed upstream, by frequency over 1,300 fills:
// Open Short 551, Close Short 382, Open Long 140, Close Long 89, Buy 69,
// Long > Short 34, Short > Long 34, Sell 1.
//
// Those eight were taken for the whole vocabulary, and everything else fell through
// to OTHER with realises:false — which silently deleted money. A sweep of 105,931 raw
// fills across 70 board addresses found five more, four of which realise: Settlement
// 25, Spot Dust Conversion 25, Liquidated Isolated Short 2, Liquidated Isolated Long
// 2, Auto-Deleveraging 1. One address on the board (0xbdfa4f44…) held ten Settlement
// fills summing to -$14,018.65, so its Realised stat read -$23.4K over "4 closes"
// where the truth was -$37.4K over 14.
// Frozen, and frozen per ROW rather than only at the top level: dirFacets returns the
// row itself (one object per dir, shared by every caller), so an unfrozen row let any
// consumer rewrite what "Close Long" realises for the rest of the process — including
// realisedTotal's own reads a few lines below. Object.freeze rather than a defensive
// clone because this is read on every fill of every row and a copy per read is 100
// allocations per tape for a mutation nobody wants to make.
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
  // A forced close is still a close, and it realises. The dir does NOT say whose
  // liquidation it was — 951 of 956 fills carrying a `liquidation` object have a
  // plain Close/Open dir — so these facets claim only what the string itself says.
  //
  // Badging those 951 is therefore NOT a display-layer change, contrary to what an
  // earlier write-up of this decision claimed: parseFills (trader.ts) builds its Fill
  // field by field and never copies `liquidation`, and the route trims the payload on
  // the way out, so the object does not reach the client at all. The field would have
  // to be added to Fill, to parseFills and to the route's response before a badge
  // could read it.
  "Liquidated Isolated Long": { action: "CLOSE", side: "LONG", realises: true, word: "LIQ" },
  "Liquidated Isolated Short": { action: "CLOSE", side: "SHORT", realises: true, word: "LIQ" },
  // Auto-deleveraging closes a position the exchange chose, and the string carries no
  // side. ADL is the exchange's own word for it.
  "Auto-Deleveraging": { action: "CLOSE", side: "NONE", realises: true, word: "ADL" },
  // Settlement is neither an open nor a close: a market resolved and the position was
  // booked out. Every one observed carried a non-zero closedPnl.
  Settlement: { action: "SETTLE", side: "NONE", realises: true },
  // A dust sweep is a spot trade, and spot fills carry a token-denominated closedPnl
  // that is not realised perp PnL, so it stays out of the total like Buy and Sell.
  "Spot Dust Conversion": { action: "SPOT", side: "NONE", realises: false, word: "DUST" },
};
for (const facets of Object.values(DIR_TABLE)) Object.freeze(facets);

// The cross-margin siblings of the two isolated liquidation dirs, matched by SHAPE
// because their exact wording has not been observed and the cost of missing one is a
// realised loss dropped from the total.
const LIQUIDATED_RE = /^Liquidated\b.*\b(Long|Short)$/;

/**
 * Decompose upstream's `dir` string. Unknown values degrade to a neutral facet rather
 * than throwing: the vocabulary belongs to Hyperliquid and does grow, and a new order
 * type should render plainly, not blank the table.
 *
 * `closedPnl` is what stops that graceful degradation from deleting money. An unmapped
 * dir used to be ASSUMED not to realise, which dropped its PnL from the row and from
 * the total — a wrong figure shown with full confidence. Whether a fill realised is a
 * fact the fill carries: a non-zero closedPnl on an unmapped dir means money moved. A
 * 0 keeps the meaning it has on an open — "not applicable", not "broke even".
 */
export function dirFacets(dir: string, closedPnl: number | null = null): DirFacets {
  const known = DIR_TABLE[dir];
  if (known) return known;

  const liquidated = LIQUIDATED_RE.exec(dir);
  if (liquidated) {
    return {
      action: "CLOSE",
      side: liquidated[1] === "Long" ? "LONG" : "SHORT",
      realises: true,
      word: "LIQ",
    };
  }

  return {
    action: "OTHER",
    side: "NONE",
    realises: closedPnl !== null && closedPnl !== 0,
  };
}

export interface Order {
  /**
   * Unique within one snapshot. The group INDEX is what makes it unique: fills
   * settled in one block share a `time` (43 adjacent same-millisecond pairs in the
   * live hundred), so a basket close across markets produced two identical
   * time+coin+dir keys and React reused the wrong row.
   *
   * Unique, but deliberately NOT stable across snapshots, and the tape lives with
   * that. The index is positional, so one new fill at the head shifts every key below
   * it and React remounts the whole tbody on a refetch. The alternative — dropping
   * the index — is the identical-key collision above, which shows the WRONG row's
   * figures; a remount only replays the arrival stagger. Nothing on a tape row holds
   * state that a remount would lose (no inputs, no open drawer, no odometer), which is
   * why this is the cheap side of the trade.
   */
  key: string;
  coin: string;
  label: string;
  venue: Venue;
  dir: string;
  facets: DirFacets;
  /** Upstream's id for this order: `twapId` when it was a TWAP, else `oid`. */
  orderId: number | null;
  /**
   * True when this row is an order upstream named, false when the time fallback drew
   * it. The panel only promises "one order" for the rows that can keep the promise.
   */
  byId: boolean;
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
 * Collapse consecutive fills that belong to one order into single rows.
 *
 * The key is the ORDER ID upstream ships — `twapId` first, so a TWAP's many child
 * oids read as the single intent they were, then `oid`. This replaced a time
 * heuristic, and the difference is not academic: on the 7d #1 address the heuristic
 * drew 10 rows over 43 real orders (2026-09-15; the count is a property of the hour,
 * see THE OID SAMPLE above) and told the visitor each row was "one order"
 * (one ×24 row was 5 oids, one ×11 row was 10 separate ETH orders in 27 s); another
 * board address rendered all 100 fills — 51 orders over 9.4 minutes — as a single
 * "×100" line with one clock time.
 *
 * Only CONSECUTIVE runs merge, even when the id matches. Grouping globally would
 * fuse two decisions made hours apart into one line and invent an order that never
 * existed; across 500 sampled fills no oid ever reappeared after a different one, so
 * this costs nothing real. Upstream delivers newest-first and that order is preserved.
 *
 * The 60 s window survives only as the FALLBACK for fills that carry no id, and it is
 * now measured from the group's NEWEST fill rather than the preceding one. Against the
 * preceding fill the window slid: twenty fills 50 s apart merged into one order
 * spanning 950 s, under a rule the panel described as "within a minute".
 */
export function groupFills(fills: LabelledFill[]): Order[] {
  const out: Order[] = [];

  for (const f of fills) {
    const prev = out[out.length - 1];
    const t = f.time;
    const id = f.twapId ?? f.oid;
    const contiguous =
      prev !== undefined &&
      prev.coin === f.coin &&
      prev.dir === f.dir &&
      (prev.orderId !== null || id !== null
        ? // An id on either side settles it. An identified fill is never absorbed into
          // an unidentified group, which would claim an order upstream did not report.
          prev.orderId === id
        : // A null timestamp cannot be proven contiguous, so it starts a new group.
          t !== null &&
          prev.latest !== null &&
          Math.abs(prev.latest - t) <= SAME_ORDER_WINDOW_MS);

    if (!contiguous) {
      const facets = dirFacets(f.dir, f.closedPnl);
      out.push({
        key: `${out.length}-${id ?? t ?? "na"}-${f.coin}-${f.dir}`,
        orderId: id,
        byId: id !== null,
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
    // Only an UNMAPPED dir can disagree with its own group about realising: mapped
    // facets come from the dir, which the group shares. When a later slice of such a
    // group realises, the group has to start summing or the rest of its PnL is lost.
    if (!prev.facets.realises && dirFacets(f.dir, f.closedPnl).realises) {
      prev.facets = { ...prev.facets, realises: true };
    }
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
 *
 * The fill's own closedPnl is passed to dirFacets so that a dir this file has never
 * seen still contributes the money it moved. Settlement fills alone were -$14,018.65
 * missing from one board address's total.
 */
export function realisedTotal(fills: LabelledFill[]): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const f of fills) {
    if (!dirFacets(f.dir, f.closedPnl).realises || f.closedPnl === null) continue;
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

/**
 * Clock time in the viewer's own zone. Fills span minutes, so seconds matter.
 *
 * Viewer-local rather than UTC because Hyperliquid's own UI is local and this is the
 * only wall clock on the page. That makes it the caller's job to say WHICH clock and
 * WHICH day, which is what `formatZone`, `formatDate` and `dayKey` below are for: the
 * live 7d #1 tape ran 22:45Z → 03:59Z, so a UTC viewer read a header whose end was
 * earlier than its start and a column that stepped from 00:xx to 23:xx unannounced.
 */
export function formatClock(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Compact elapsed label: 8s, 1m 29s, 5h 31m, 1d 12h.
 *
 * FLOORED, and two units below a day. Rounding at every tier overstated the span it
 * was printed beside: a 5 h 31 m tape read "6H OF ACTIVITY" next to two
 * second-resolution clocks, and 36 h read "2d". The second unit is dropped when it is
 * zero, so an exact span stays exact ("2h", not "2h 0m").
 */
export function formatElapsed(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const pair = (big: number, unit: string, small: number, smallUnit: string) =>
    small === 0 ? `${big}${unit}` : `${big}${unit} ${small}${smallUnit}`;
  if (s < 3600) return pair(Math.floor(s / 60), "m", s % 60, "s");
  if (s < 86_400) return pair(Math.floor(s / 3600), "h", Math.floor((s % 3600) / 60), "m");
  return pair(Math.floor(s / 86_400), "d", Math.floor((s % 86_400) / 3600), "h");
}

/**
 * The viewer-zone calendar day, as an opaque key.
 *
 * Only ever compared, never shown — which is why its format does not matter and its
 * ZONE does. The tape is newest-first, so when the viewer's midnight falls inside the
 * span the clock column steps 03:59 … 00:12 … 23:58 and nothing says a day passed.
 */
export function dayKey(ms: number | null): string | null {
  if (ms === null) return null;
  return new Date(ms).toLocaleDateString("en-US");
}

// Assembled from parts rather than taken from a locale pattern. en-GB orders the day
// before the month but renders September as "Sept" — the one four-letter month, which
// breaks a mono column — while en-US renders "Sep 15". Every en-US short month is
// three letters, so the parts come from en-US and the order is imposed here.
//
// The formatter is constructed per call and stays that way. Hoisting it to module
// scope would save an Intl construction per row, but an Intl.DateTimeFormat resolves
// its time zone ONCE, at construction: this file is evaluated at import, which in ESM
// is before any statement in the importing module runs, so a hoisted formatter would
// capture the zone that was live before tests/fills.test.ts sets process.env.TZ — and
// every viewer-local string in this file would then be pinned to the wrong clock. The
// cost being avoided is a few hundred microseconds per tape.
function dateParts(ms: number): { weekday: string; day: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(new Date(ms));
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: value("weekday"), day: value("day"), month: value("month") };
}

/** "15 Sep" — for the header, which has to carry two dates when the tape crosses one. */
export function formatDate(ms: number | null): string {
  if (ms === null) return "—";
  const { day, month } = dateParts(ms);
  return `${day} ${month}`;
}

/** "Tue 15 Sep" — the full-width row that marks a day change inside the tape. */
export function formatDayLabel(ms: number | null): string {
  if (ms === null) return "—";
  const { weekday, day, month } = dateParts(ms);
  return `${weekday} ${day} ${month}`;
}

/**
 * The viewer's zone, to be named ONCE per panel.
 *
 * en-US short names are "PDT" for US-named zones and "GMT+2" elsewhere, never
 * "UTC+1". Either form answers the only question the column raises — which clock am I
 * reading — so the inconsistency is not worth a hand-rolled offset.
 */
export function formatZone(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "short",
  }).formatToParts(new Date(ms));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** The finest count this column resolves — four decimals, so anything under half of
 * the last place rounds away. */
const SIZE_FLOOR = 0.00005;

/**
 * Coin-unit size: large counts need no decimals, fractional ones need four.
 *
 * Below the column's resolution it states the bound instead of rounding to "0".
 * parseSpot drops only EXACT zeros — correctly, since 1e-6 of a token is still a
 * holding the account owns — so a bare "0" here was a confident zero printed over
 * something real, which is the one thing this panel's dash convention exists to stop.
 */
export function formatSize(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs > 0 && abs < SIZE_FLOOR) return v < 0 ? ">-0.0001" : "<0.0001";
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

// Three digits is the resolution of the fee column, for every row in it.
const FEE_DIGITS = 3;

/**
 * Fee amounts are small and multi-token, so the token travels with the number.
 *
 * ONE precision for the whole column. Picking the digits by magnitude with only a
 * maximum set produced "0.29924 / 1.714 / 21 / 6.58 USDC" in a single right-aligned
 * column, where the decimal points did not line up and every row asserted a different
 * resolution. Below the column's resolution the value says so rather than rounding to
 * a bare "0.000", which would read as free.
 *
 * The bound TURNS ROUND for a rebate. "-<0.001" read as a minus sign glued to a
 * less-than, and it also said the wrong thing: a rebate of a ten-thousandth is
 * greater than -0.001, not less than it.
 */
export function formatFee(amount: number, token: string): string {
  const abs = Math.abs(amount);
  if (abs > 0 && abs < 0.0005) return `${amount < 0 ? ">-" : "<"}0.001 ${token}`;
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: FEE_DIGITS,
    maximumFractionDigits: FEE_DIGITS,
  })} ${token}`;
}

/**
 * A negative fee is a maker REBATE — the exchange paid the trader for providing
 * liquidity. Four of thirteen sampled addresses were net-negative in USDC, so
 * labelling every one of these "fees" would invert the meaning of the number.
 */
export function isRebate(amount: number): boolean {
  return amount < 0;
}
