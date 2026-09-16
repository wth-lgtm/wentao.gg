"use client";

import { useEffect, useMemo, useState } from "react";
import { AddressLegend, Legend, dash } from "./Instrument";
import { formatCurrency, formatPercent, toneClass } from "../lib/formatters";
import { formatPrice, formatSize } from "../lib/fills";
import { PerpPosition, SpotBalance, TraderPositions } from "../lib/trader";

// The Positions tab: what one whale is actually holding right now.
//
// A verified fact that shapes this whole panel: of eight top-50 addresses sampled
// live, only FOUR held any open perp position at all. An empty list is therefore
// the common case, not a failure, and it gets a designed state that says so —
// especially since these accounts always hold spot balances, so "nothing here"
// would be actively misleading.
//
// Two measurements set the layout. First, on the 30-day board 40 of 50 rows hold no
// perp position at all, and clicking one of them used to land on four dashes: for
// those addresses the SPOT list is the answer, so it is rendered first. Second, the
// twelve positions of the 7d #1 address sum to exactly the figures upstream reports
// for the account (Σ positionValue 576,299,154.24 = marginSummary.totalNtlPos,
// Σ marginUsed 109,818,645.23 = totalMarginUsed), so the roll-up below is arithmetic
// on the same snapshot rather than a second opinion about it.

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Legend>{label}</Legend>
      <span className="tabular-nums text-sm text-foreground">{children}</span>
    </div>
  );
}

const money = (v: number | null, decimals = 2) =>
  v === null ? dash : formatCurrency(v, { compact: Math.abs(v) >= 10_000, decimals });

// formatPrice and formatSize hand back a bare "—" for null, which sits a shade
// darker than the muted `dash` every other unknown on this panel uses — Entry and
// Liq. printed one grey, Size the other, in the same row. Both go through these so
// the panel has exactly one glyph for "upstream did not say".
const price = (v: number | null) => (v === null ? dash : formatPrice(v));
const size = (v: number | null) => (v === null ? dash : formatSize(v));

function SideBadge({ side }: { side: PerpPosition["side"] }) {
  // Word + glyph + colour: three cues, so side never depends on hue alone.
  const tone =
    side === "LONG" ? "text-[var(--gain)]" : side === "SHORT" ? "text-[var(--loss)]" : "text-muted";
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}>
      <span aria-hidden className="mr-1">
        {side === "LONG" ? "▲" : side === "SHORT" ? "▼" : "·"}
      </span>
      {side}
    </span>
  );
}

/**
 * Age of THIS address's snapshot.
 *
 * The route caches at the edge (`s-maxage=30, stale-while-revalidate=120`) and two
 * consecutive live GETs came back MISS then HIT with an identical fetchedAt, so what
 * is on screen can be two minutes old with nothing saying so. The rail above the tabs
 * ages the LEADERBOARD, which is different data on a different schedule — hence a
 * second, local reading in the rail's own MM:SS language.
 *
 * Deliberately not a live region (`aria-live="off"`, matching the rail): a clock
 * inside one would interrupt a screen reader every second, forever.
 */
function AsOf({ since }: { since: number }) {
  // Elapsed SECONDS in state, label is pure formatting — and the first sample is
  // deferred a frame rather than taken in the effect body, so nothing reads
  // Date.now() during render and no setState cascades a second render.
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    const sample = () => setSeconds(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    const frame = requestAnimationFrame(sample);
    const id = setInterval(sample, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, [since]);

  const label =
    seconds === null
      ? "--:--"
      : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <Legend>
      As of{" "}
      <span aria-live="off" className="tabular-nums text-foreground">
        {label}
      </span>{" "}
      ago
      <span className="sr-only">
        {" "}
        — how long since these perp and spot figures were read; the snapshot age on the
        rail above belongs to the leaderboard
      </span>
    </Legend>
  );
}

// ── Position ordering and the dust gate ───────────────────────────────────────

/** Largest notional first, unknown value last. Upstream order is asset-index order
 * and carries no meaning to a reader — it is why a $0.35 SUI residue sat between INJ
 * at $1.63M and XRP at $19.6M. Sort is stable, so equal values keep upstream order. */
function byValueDesc(a: PerpPosition, b: PerpPosition): number {
  if (a.positionValue === b.positionValue) return 0;
  if (a.positionValue === null) return 1;
  if (b.positionValue === null) return -1;
  return b.positionValue - a.positionValue;
}

/**
 * The gate is ABSOLUTE and stays that way.
 *
 * A relative gate (`positionValue < totalNtlPos * 0.0001`) was probed against live
 * accounts and collapses real trades: eight positions of $1.3K–$12K for 0x45d26f28,
 * eight more for 0x7fdafde5, a $21,070 ASTER position for 0xb83de012. The residues
 * this is for measured $0.01, $0.35, $3, $18 and $22, so ten dollars catches the
 * garbage without hiding anybody's trade.
 */
const DUST_USD = 10;
const isDust = (p: PerpPosition) => p.positionValue !== null && p.positionValue < DUST_USD;

interface Ranked {
  main: PerpPosition[];
  dust: PerpPosition[];
}

function rankPositions(positions: PerpPosition[] | null): Ranked | null {
  if (positions === null) return null;
  const sorted = [...positions].sort(byValueDesc);
  return { main: sorted.filter((p) => !isDust(p)), dust: sorted.filter(isDust) };
}

// ── The roll-up ───────────────────────────────────────────────────────────────

/** A sum together with how much of the book it actually covers. */
interface Aggregate {
  /** null when upstream gave none of the inputs: the dash, never a 0 built of unknowns. */
  total: number | null;
  /** Rows that contributed a figure. */
  seen: number;
  /** Rows that were asked for one. */
  of: number;
}

/**
 * Sum over the values upstream actually gave, and remember how many that was.
 *
 * Returning only the number was a quieter version of the same lie the dash exists to
 * prevent: a figure missing from ONE of twelve present rows is a case the data really
 * produces (tests/trader.test.ts pins that a missing figure inside a present row stays
 * null, never 0), and the header then printed a sum of eleven under a bare "Unrealised"
 * as though it were the book's total. The count travels with the total so the cell can
 * say "11 of 12".
 */
function sumOf(values: (number | null)[]): Aggregate {
  let total = 0;
  let seen = 0;
  for (const v of values) {
    if (v !== null) {
      total += v;
      seen += 1;
    }
  }
  return { total: seen === 0 ? null : total, seen, of: values.length };
}

interface PerpTotals {
  unrealized: Aggregate;
  /** Long notional minus short notional. positionValue is a magnitude upstream, so
   * the sign has to come from `side`. */
  net: Aggregate;
  longs: number;
  shorts: number;
  funding: Aggregate;
}

function totalPositions(positions: PerpPosition[]): PerpTotals {
  return {
    unrealized: sumOf(positions.map((p) => p.unrealizedPnl)),
    net: sumOf(
      positions.map((p) => {
        // "FLAT" is two different facts in one word: parsePositions labels a position
        // flat when szi is 0 AND when szi failed to parse. Only the first contributes a
        // real 0 to net exposure; an unknown direction — or an unknown notional — has to
        // contribute null, or a book of unparseable rows would read "FLAT $0.00", which
        // is a confident claim that this whale is hedged.
        if (p.positionValue === null || p.szi === null) return null;
        if (p.side === "LONG") return p.positionValue;
        if (p.side === "SHORT") return -p.positionValue;
        return 0;
      })
    ),
    longs: positions.filter((p) => p.side === "LONG").length,
    shorts: positions.filter((p) => p.side === "SHORT").length,
    funding: sumOf(positions.map((p) => p.fundingSinceOpen)),
  };
}

/** The honesty valve on a Σ: how much of the book it covers, shown only when that is
 * not all of it. */
function Coverage({
  agg,
  what,
  unit = "positions",
}: {
  agg: Aggregate;
  what: string;
  /** What the counts are counting. The spot roll-up sums BALANCES, and a legend
   * reading "9 of 11 positions" over a wallet would name the wrong thing. */
  unit?: string;
}) {
  if (agg.total === null || agg.seen >= agg.of) return null;
  return (
    <Legend>
      {agg.seen} of {agg.of}
      <span className="sr-only">
        {` ${unit}: upstream reported no ${what} for the other ${agg.of - agg.seen}, so this total is not the whole book`}
      </span>
    </Legend>
  );
}

/** Maintenance margin as a share of equity: 100% is the liquidation line. Null unless
 * both figures are present AND equity is above zero — a ratio of a zero account is not
 * a percentage, and printing 0% there would read as "nothing at risk". */
function maintenanceShare(
  required: number | null,
  equity: number | null
): number | null {
  if (required === null || equity === null || equity <= 0) return null;
  return (required / equity) * 100;
}

function TotalsRow({ totals, maintenance }: { totals: PerpTotals; maintenance: number | null }) {
  const net = totals.net.total;
  const netSide = net === null || net === 0 ? "FLAT" : net > 0 ? "LONG" : "SHORT";
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      <Metric label="Unrealised">
        {totals.unrealized.total === null ? (
          dash
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className={toneClass(totals.unrealized.total)}>
              {formatCurrency(totals.unrealized.total, { showSign: true, compact: true })}
            </span>
            <Coverage agg={totals.unrealized} what="unrealised PnL" />
          </span>
        )}
      </Metric>
      <Metric label="Net exposure">
        {net === null ? (
          dash
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <SideBadge side={netSide} />
            <span>{money(Math.abs(net))}</span>
            <Legend>
              {totals.longs} long · {totals.shorts} short
            </Legend>
            <Coverage agg={totals.net} what="direction or notional" />
          </span>
        )}
      </Metric>
      <Metric label="Funding since open">
        {/* Same convention as the per-position cell, from the same field, so the
            roll-up and the rows can never disagree about who paid whom. */}
        {totals.funding.total === null ? (
          dash
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <Funding value={totals.funding.total} />
            <Coverage agg={totals.funding} what="funding since open" />
          </span>
        )}
      </Metric>
      <Metric label="Maintenance">
        {maintenance === null ? (
          dash
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span>{formatPercent(maintenance, { decimals: 1 })}</span>
            <Legend>of equity</Legend>
            <span className="sr-only">
              — maintenance margin required as a share of account value; at 100% the
              account is liquidated
            </span>
          </span>
        )}
      </Metric>
    </div>
  );
}

// ── Position cells ────────────────────────────────────────────────────────────

function Funding({ value }: { value: number }) {
  return (
    // Already in the trader's P&L sign (see PerpPosition.fundingSinceOpen).
    <span className={toneClass(value)}>
      {formatCurrency(value, { showSign: true, compact: true })}
      <span className="sr-only">{value > 0 ? " received" : value < 0 ? " paid" : ""}</span>
    </span>
  );
}

function Upnl({ value }: { value: number | null }) {
  if (value === null) return dash;
  return (
    <span className={`tabular-nums font-semibold ${toneClass(value)}`}>
      {formatCurrency(value, { showSign: true, compact: true })}
    </span>
  );
}

/** ROE and the liquidation price of a residue are arithmetically true and practically
 * meaningless: the $0.35 SUI position reports 812.60% and a $259.69M liquidation price,
 * the two largest numbers on the page. The cell keeps its label and its width so the
 * grid stays aligned, and says why it is blank to anyone reading with a screen reader. */
const notMeaningful = (
  <>
    {dash}
    <span className="sr-only"> not meaningful at this size</span>
  </>
);

function Market({ p }: { p: PerpPosition }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-semibold text-foreground">{p.coin}</span>
      <SideBadge side={p.side} />
      {p.leverage !== null && (
        <span className="hl-plate hl-pos-lev" data-tier="4">
          {p.leverage}× {p.leverageType}
        </span>
      )}
    </span>
  );
}

function Roe({ p, dust }: { p: PerpPosition; dust: boolean }) {
  if (dust) return notMeaningful;
  if (p.roe === null) return dash;
  return <span className={toneClass(p.roe)}>{(p.roe * 100).toFixed(2)}%</span>;
}

/**
 * The positions ledger, in the hull's language.
 *
 * At sm+ this is an engraved table like the board and the tape; below sm the same
 * rows stack, separated by the same engraved rule rather than nested inside twelve
 * rounded cards within a rounded card. No colgroup: the table hides columns by
 * breakpoint, and `display: none` on a `<col>` is not honoured by browsers, so a
 * fixed colgroup would describe a column set the table no longer has.
 */
function PositionList({ rows, dust = false }: { rows: PerpPosition[]; dust?: boolean }) {
  const caption = dust
    ? "Perp positions worth under ten dollars"
    : "Open perp positions, largest notional first";
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="hl-pos-table w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          {/* The drawer's rows are a footnote to the list above, and a second visible
              nine-column header — which cannot align with the first, since both tables
              size to their own content — reads worse than none. So the drawer's header
              row is rendered and hidden VISUALLY rather than dropped: nine columns of
              money with no column names in the accessibility tree is a worse bargain
              than a duplicate header (WCAG 1.3.1). `Th` emits scope="col" either way. */}
          <thead className={dust ? "sr-only" : undefined}>
            <tr>
              <Th pad="pl-4 pr-2">Market</Th>
              <Th align="right">Size</Th>
              <Th align="right">Entry</Th>
              <Th align="right">Value</Th>
              <Th align="right" className="hidden lg:table-cell">
                Margin
              </Th>
              <Th align="right" className="hidden md:table-cell">
                ROE
              </Th>
              <Th align="right" className="hidden lg:table-cell">
                Liq.
              </Th>
              <Th align="right" className="hidden lg:table-cell">
                Funding
              </Th>
              <Th align="right" pad="pl-2 pr-4">
                uPnL
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.coin} className="hl-pos-row">
                <td className="pl-4 pr-2">
                  <Market p={p} />
                </td>
                <Td>{size(p.szi === null ? null : Math.abs(p.szi))}</Td>
                <Td muted>{price(p.entryPx)}</Td>
                <Td>{money(p.positionValue)}</Td>
                <Td muted className="hidden lg:table-cell">
                  {money(p.marginUsed)}
                </Td>
                <Td className="hidden md:table-cell">
                  <Roe p={p} dust={dust} />
                </Td>
                <Td muted className="hidden lg:table-cell">
                  {dust ? notMeaningful : price(p.liquidationPx)}
                </Td>
                <Td className="hidden lg:table-cell">
                  {p.fundingSinceOpen === null ? dash : <Funding value={p.fundingSinceOpen} />}
                </Td>
                <Td pad="pl-2 pr-4">
                  <Upnl value={p.unrealizedPnl} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="sm:hidden">
        {rows.map((p) => (
          <li key={p.coin} className="hl-pos-slab py-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <Market p={p} />
              <Upnl value={p.unrealizedPnl} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Metric label="Size">{size(p.szi === null ? null : Math.abs(p.szi))}</Metric>
              <Metric label="Entry">{price(p.entryPx)}</Metric>
              <Metric label="Value">{money(p.positionValue)}</Metric>
              <Metric label="Margin">{money(p.marginUsed)}</Metric>
              <Metric label="ROE">
                <Roe p={p} dust={dust} />
              </Metric>
              <Metric label="Liq. price">
                {dust ? notMeaningful : price(p.liquidationPx)}
              </Metric>
              <Metric label="Funding since open">
                {p.fundingSinceOpen === null ? dash : <Funding value={p.fundingSinceOpen} />}
              </Metric>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The residues, folded away but never dropped: the count in the panel heading stays
 * the full total, and the summary names what is behind it. A native `<details>` needs
 * no motion of its own, works as a designed still under reduced motion, and adds no
 * live region. */
function DustBlock({ rows, total }: { rows: PerpPosition[]; total: number }) {
  const named = rows
    .slice(0, 3)
    .map((p) =>
      p.positionValue === null
        ? `${p.coin} —`
        : `${p.coin} ${formatCurrency(p.positionValue, { decimals: 2 })}`
    )
    .join(" · ");
  return (
    <details className="hl-pos-dust">
      <summary>
        <span aria-hidden className="hl-pos-caret">
          ▶
        </span>
        <span className="hl-plate" data-tier="4">
          dust
        </span>
        <Legend>
          {rows.length} of {total} under ${DUST_USD} · {named}
          {rows.length > 3 ? " · …" : ""}
        </Legend>
      </summary>
      {/* Same gutter as the list above it, so the ledger reads as one column of
          figures whether or not the drawer is open. */}
      <div className="px-4 pb-4 sm:px-0 sm:pb-0">
        <PositionList rows={rows} dust />
      </div>
    </details>
  );
}

/**
 * The absent state, which is NOT the empty state.
 *
 * The route answers 200 with a partial body when one of its three upstream calls
 * fails — Hyperliquid returns 429 on a second sequential call from a shared egress IP
 * — and the snapshot carries that as null. Rendering the designed "currently flat"
 * copy over it asserted a fact about the whale that the app did not have.
 */
function Unavailable({
  reason,
  onRetry,
  busy,
}: {
  reason: string;
  onRetry?: () => void;
  busy: boolean;
}) {
  return (
    <>
      <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
        {reason}
      </p>
      {onRetry && <ReRead onRetry={onRetry} busy={busy} />}
    </>
  );
}

// Re-asks for THIS address through useTrader's reload, so the tab, the selection and
// the rest of the snapshot all survive the retry. Disabled while a request is in
// flight because a partial 200 leaves `data` populated, so nothing else on screen
// changes to say the click landed.
function ReRead({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      className="mt-3 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)] transition-colors hover:text-foreground disabled:opacity-50"
    >
      {busy ? "Re-reading" : "Re-read"}
    </button>
  );
}

// ── Spot ordering, pricing and its own dust gate ──────────────────────────────

/** Biggest count first, unknown last. Only the tie-break behind byUsdDesc now: on its
 * own it ranked 2,331,863 UBONK ($5.90) above 556,416 HYPE ($43.25M). */
function byTotalDesc(a: SpotBalance, b: SpotBalance): number {
  if (a.total === b.total) return 0;
  if (a.total === null) return 1;
  if (b.total === null) return -1;
  return b.total - a.total;
}

/** Biggest holding first, in money. An unpriced row cannot be ranked against a dollar
 * figure at all, so it sinks below every priced one and keeps count order among its
 * own kind — rather than being sorted as though its value were zero. */
function byUsdDesc(a: SpotBalance, b: SpotBalance): number {
  if (a.usdValue !== null && b.usdValue !== null) {
    return a.usdValue === b.usdValue ? 0 : b.usdValue - a.usdValue;
  }
  if (a.usdValue !== null) return -1;
  if (b.usdValue !== null) return 1;
  return byTotalDesc(a, b);
}

/**
 * A dollar, and for the same reason the perp gate is ten.
 *
 * The live 7d #1 wallet holds eleven balances of which one — 0.01 USDH, a single cent
 * — is under a dollar, while the rows just above it ($1.93 FUND, $2.06 LICKO, $5.90
 * UBONK) are small but real and stay on the list. It earns its keep on the long tail:
 * the zero address holds 174 non-zero balances and 63 of them are under a dollar, so
 * without the drawer its real $31.29M of holdings sat below sixty rows of residue.
 *
 * An UNPRICED row is never dust: "we could not price this" is not "this is worth
 * nothing", and folding it away would hide a holding the panel has no figure for.
 */
const SPOT_DUST_USD = 1;

/**
 * A holding too small for two decimal places still has to read as a holding.
 *
 * money() prints two decimals, so the long tail of a memecoin wallet rounds to "$0.00"
 * — a confident zero over something the account genuinely owns. Measured on the zero
 * address: 39 of its 63 sub-dollar balances price below a cent (KNTQ at $0.00000064),
 * and "0" is reserved in this panel for a real zero.
 */
function spotValue(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  // Same tiers as money(), inlined because the null branch — which hands back a JSX
  // dash — cannot be reached here and the row renders the unpriced case itself.
  return formatCurrency(usd, { compact: Math.abs(usd) >= 10_000, decimals: 2 });
}

const isSpotDust = (b: SpotBalance) => b.usdValue !== null && b.usdValue < SPOT_DUST_USD;

interface SpotRanked {
  main: SpotBalance[];
  dust: SpotBalance[];
  /** Σ usdValue with its coverage, over ALL balances including the folded ones. */
  value: Aggregate;
}

function rankSpot(spot: SpotBalance[] | null): SpotRanked | null {
  if (spot === null) return null;
  const sorted = [...spot].sort(byUsdDesc);
  return {
    main: sorted.filter((b) => !isSpotDust(b)),
    dust: sorted.filter(isSpotDust),
    value: sumOf(sorted.map((b) => b.usdValue)),
  };
}

function SpotRow({ b }: { b: SpotBalance }) {
  return (
    <li className="hl-pos-slab flex items-baseline justify-between gap-3 py-2">
      <span className="font-medium text-foreground">{b.coin}</span>
      <span className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 tabular-nums text-sm">
        {/* The count is now the SECONDARY figure. It used to be the only one, and
            nothing on screen said that this wallet's 2.33M UBONK is $5.90 while its
            556K HYPE is $43.25M — an order that invited exactly the wrong reading. */}
        <span className="text-muted">{size(b.total)}</span>
        {b.hold !== null && b.hold > 0 && (
          // "HELD" said nothing: the number is the part of the balance the exchange
          // has already committed to the trader's own resting orders. 118.1M of the
          // 7d #1 address's 159.4M USDC is sitting behind orders, which is the whole
          // point of the figure.
          <Legend>
            {formatSize(b.hold)} on order
            <span className="sr-only"> — reserved against open orders, not spendable</span>
          </Legend>
        )}
        <span className="text-foreground">
          {b.usdValue === null ? (
            <>
              {dash}
              <span className="sr-only"> no spot mid for this token, so it is unpriced</span>
            </>
          ) : (
            spotValue(b.usdValue)
          )}
        </span>
      </span>
    </li>
  );
}

/** The cents, folded away but never dropped: the count in the section legend stays the
 * full total and the summary names what is behind it. Same native `<details>` as the
 * perp drawer — no motion of its own, a designed still under reduced motion, no live
 * region. The negative margin is what lines the full-bleed summary up with this
 * Panel's own padding box. */
function SpotDustBlock({ rows, total }: { rows: SpotBalance[]; total: number }) {
  const named = rows
    .slice(0, 3)
    // `?? 0` would have been a zero standing in for an unknown. A dust row always
    // carries a value by construction (isSpotDust requires one), so the dash branch is
    // unreachable — and it is written anyway, because the alternative is a literal 0.
    .map((b) => `${b.coin} ${b.usdValue === null ? "—" : spotValue(b.usdValue)}`)
    .join(" · ");
  return (
    <details className="hl-pos-dust -mx-4 mt-1">
      <summary>
        <span aria-hidden className="hl-pos-caret">
          ▶
        </span>
        <span className="hl-plate" data-tier="4">
          dust
        </span>
        <Legend>
          {rows.length} of {total} under ${SPOT_DUST_USD} · {named}
          {rows.length > 3 ? " · …" : ""}
        </Legend>
      </summary>
      <ul className="px-4">
        {rows.map((b) => (
          <SpotRow key={b.coin} b={b} />
        ))}
      </ul>
    </details>
  );
}

export default function PositionsPanel({
  address,
  data,
  loading,
  error,
  leaderboardAccountValue,
  onRetry,
}: {
  address: string | null;
  /** The positions slice only. Fills live in their own route and their own slice, so
   * this panel no longer waits on a 1.16-1.38s userFills call it never reads. */
  data: TraderPositions | null;
  loading: boolean;
  error: string | null;
  /** This address's equity as the LEADERBOARD measures it, from the row that is
   * already in memory for the window on screen. null when the address is not in that
   * window — a deep-linked one, or a row that dropped out of the top fifty — and the
   * note below then explains the discrepancy without inventing a size for it. */
  leaderboardAccountValue: number | null;
  /** Re-reads this trader, both slices (useTrader's reload). */
  onRetry?: () => void;
}) {
  // Derived before the early returns, because hooks cannot live behind a branch. Each
  // one is keyed on the snapshot object, so a re-render that does not change the data
  // re-sorts and re-sums nothing.
  const ranked = useMemo(() => rankPositions(data?.positions ?? null), [data]);
  const totals = useMemo(
    () => (data?.positions?.length ? totalPositions(data.positions) : null),
    [data]
  );
  const spotRanked = useMemo(() => rankSpot(data?.spot ?? null), [data]);

  if (!address) {
    return (
      <Panel>
        <Legend>No trader selected</Legend>
        <p className="mt-2 text-sm text-muted">
          Pick a row on the leaderboard to inspect what that address is holding.
        </p>
      </Panel>
    );
  }

  if (loading && !data) {
    return (
      <Panel>
        <AddressLegend prefix="Reading " address={address} />
        <div className="mt-3 space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-card-hover" />
          ))}
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <AddressLegend prefix="Could not read " address={address} />
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
          {error}
        </p>
      </Panel>
    );
  }

  if (!data) return null;

  const { margin, positions, spot } = data;

  // Spot first when upstream ANSWERED, the perp account is genuinely empty, and there
  // are balances to lead with — 40 of 50 rows on the 30-day board are that address, and
  // for them the spot list is the answer to "what is this whale holding". Two states
  // deliberately do NOT reorder: `positions === null` is upstream not answering, which
  // keeps the perp panel on top where its unavailable state and its retry belong, and
  // an empty spot list would make "spot holder" a claim about nothing.
  const spotFirst =
    positions !== null && positions.length === 0 && spot !== null && spot.length > 0;
  const asOf = <AsOf since={data.fetchedAt} />;

  // Both figures or neither. A ratio needs a positive denominator to be a ratio at
  // all, and printing "0.00×" against an empty perp account would read as a
  // measurement rather than as the absence of one.
  const leaderboardEquity =
    leaderboardAccountValue !== null &&
    margin?.accountValue != null &&
    margin.accountValue > 0
      ? {
          leaderboard: leaderboardAccountValue,
          perp: margin.accountValue,
          ratio: leaderboardAccountValue / margin.accountValue,
        }
      : null;

  const perpAccount = (
    <Panel key="account">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <AddressLegend prefix="Perp account · " address={address} />
        {spotFirst ? <Legend>Secondary — no open perps</Legend> : asOf}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Metric label="Account value">{money(margin?.accountValue ?? null)}</Metric>
        <Metric label="Notional open">{money(margin?.totalNtlPos ?? null)}</Metric>
        <Metric label="Margin used">{money(margin?.totalMarginUsed ?? null)}</Metric>
        <Metric label="Withdrawable">{money(margin?.withdrawable ?? null)}</Metric>
      </div>
      {totals && (
        <>
          <div aria-hidden className="hl-pos-rule" />
          <TotalsRow
            totals={totals}
            maintenance={maintenanceShare(
              margin?.crossMaintenanceMarginUsed ?? null,
              margin?.accountValue ?? null
            )}
          />
        </>
      )}
      {/* This note read "PERPS ONLY — DIFFERS FROM LEADERBOARD EQUITY" over a comment
          claiming the two "disagree by orders of magnitude". Measured on 2026-09-16:
          the leaderboard reports $216.43M for this address while
          marginSummary.accountValue is $107.37M — a 2.02x gap. Warning of a gap while
          stating neither number, and misstating its size in the comment, is the part a
          visitor could not act on; the row that carries the leaderboard figure is
          already in memory for the window on screen, so it is passed in and the ratio
          is arithmetic rather than a claim. No direction is asserted with it: which way
          the two land is a property of the address, not of the measurement. */}
      <p className="mt-3 text-xs text-muted">
        {leaderboardEquity !== null && (
          <>
            Leaderboard equity {money(leaderboardEquity.leaderboard)} · live perp{" "}
            {money(leaderboardEquity.perp)} — a {leaderboardEquity.ratio.toFixed(2)}×
            difference.{" "}
          </>
        )}
        Account value here is this address&rsquo;s live perp margin account, read straight
        from Hyperliquid. The equity on the leaderboard is a different measurement —
        Hyperliquid&rsquo;s own stats snapshot, refreshed on its own schedule and over a
        wider scope than perps — so the two are not expected to tie. The figures on this
        tab are the live ones.
      </p>
    </Panel>
  );

  const perpPositions = (
    <Panel key="positions" padded={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-2.5 pt-4">
        <Legend>
          {positions === null
            ? "Perp state unavailable"
            : `Open perp positions${positions.length > 0 ? ` · ${positions.length}` : ""}`}
        </Legend>
        {ranked && ranked.main.length > 1 && <Legend>Largest notional first</Legend>}
      </div>
      {positions === null ? (
        <div className="px-4 pb-4">
          <Unavailable
            reason="Upstream did not answer for this address"
            onRetry={onRetry}
            busy={loading}
          />
        </div>
      ) : positions.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">
          This address holds no open perp positions right now. That is common among the
          top fifty — several rank on realised PnL and are currently flat.
        </p>
      ) : (
        <>
          {ranked && ranked.main.length > 0 && (
            <div className="px-4 pb-4 sm:px-0 sm:pb-0">
              <PositionList rows={ranked.main} />
            </div>
          )}
          {ranked && ranked.dust.length > 0 && (
            <DustBlock rows={ranked.dust} total={positions.length} />
          )}
        </>
      )}
    </Panel>
  );

  const spotBalances = (
    <Panel key="spot">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {spotFirst ? (
          <AddressLegend prefix="Spot holder · no open perps · " address={address} />
        ) : (
          <Legend>
            {spot === null
              ? "Spot balances unavailable"
              : `Spot balances${spot.length > 0 ? ` · ${spot.length}` : ""}`}
          </Legend>
        )}
        {/* The roll-up the section was missing. "≈" is load-bearing: this is a sum of
            balances at the current mids, not a settled figure, and the mids are a live
            market. Coverage states how much of the wallet it covers whenever some of
            it could not be priced. */}
        {spotRanked && spotRanked.value.total !== null && (
          <Legend>
            Total ≈{" "}
            <span className="tabular-nums text-foreground">
              {money(spotRanked.value.total)}
            </span>{" "}
            <Coverage agg={spotRanked.value} what="spot mid" unit="balances" />
          </Legend>
        )}
        {spotFirst && asOf}
      </div>
      {spot === null ? (
        <Unavailable
          reason="Upstream did not answer for this address"
          onRetry={onRetry}
          busy={loading}
        />
      ) : spot.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No non-zero spot balances.</p>
      ) : (
        <>
          <ul>
            {spotRanked?.main.map((b) => (
              <SpotRow key={b.coin} b={b} />
            ))}
          </ul>
          {spotRanked && spotRanked.dust.length > 0 && (
            <SpotDustBlock rows={spotRanked.dust} total={spot.length} />
          )}
          {/* The order ranks MONEY now, so the note that used to warn "coin counts, not
              USD value" would be false. What still needs saying is where the dollars
              come from and what an em dash in that column means. */}
          <p className="mt-3 text-xs text-muted">
            Largest holding first, valued at the current spot mid — so the figure moves
            with the market and is an estimate, not a settled balance. A dash means this
            token has no USDC spot pair to price it against; the coin count beside it is
            still exactly what Hyperliquid reported.
          </p>
        </>
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      {spotFirst
        ? [spotBalances, perpAccount, perpPositions]
        : [perpAccount, perpPositions, spotBalances]}
    </div>
  );
}

function Th({
  children,
  align = "left",
  pad = "px-2",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  pad?: string;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`${pad} py-2 font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-[var(--legend)] ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  muted = false,
  pad = "px-2",
  className = "",
}: {
  children: React.ReactNode;
  muted?: boolean;
  pad?: string;
  className?: string;
}) {
  return (
    <td className={`${pad} text-right ${className}`}>
      <span className={`tabular-nums ${muted ? "text-muted" : "text-foreground"}`}>
        {children}
      </span>
    </td>
  );
}

function Panel({
  children,
  padded = true,
}: {
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-border bg-card ${padded ? "p-4" : ""}`}
      style={{ borderTopColor: "var(--engrave-hi)" }}
    >
      {children}
    </section>
  );
}
