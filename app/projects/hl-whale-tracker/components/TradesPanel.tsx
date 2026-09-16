"use client";

import { useMemo, useState } from "react";
import { AddressLegend, Legend, dash } from "./Instrument";
import { formatCurrency, toneClass } from "../lib/formatters";
import { TraderSnapshot } from "../lib/trader";
import {
  DirFacets,
  LabelledFill,
  Order,
  Venue,
  coinLabel,
  dirFacets,
  feeTotals,
  fillSpan,
  formatClock,
  formatElapsed,
  formatFee,
  formatPrice,
  formatSize,
  groupFills,
  isRebate,
  realisedTotal,
  venueOf,
} from "../lib/fills";

// The Trades tab.
//
// The central decision here came from measuring, not from taste. Upstream gives the
// hundred most recent FILLS, and a fill is not a decision — one sampled whale's
// hundred fills were a single ETH order sliced a hundred ways. Compression across
// thirteen live addresses ranged from 1.1x to 100x. So the default view is ORDERS,
// with the raw tape one click away, and the fill count rides on every grouped row so
// nothing is concealed.

const VENUE_TAG: Record<Venue, string> = { PERP: "PERP", SPOT: "SPOT", EQUITY: "EQ" };

/**
 * Direction as a mechanism rather than a string.
 *
 * Upstream's eight `dir` values decompose into an action and a side, so the cell can
 * carry both: a chevron for the side and a short word for the action. Colour is the
 * third cue, never the only one — the glyph and the word both survive greyscale.
 */
function DirCell({ facets, dir }: { facets: DirFacets; dir: string }) {
  const { action, side } = facets;
  const long = side === "LONG" || side === "BUY";
  const short = side === "SHORT" || side === "SELL";
  const tone = long
    ? "text-[var(--gain)]"
    : short
      ? "text-[var(--loss)]"
      : "text-muted";

  // A flip is the only action that is genuinely two things at once, so it gets the
  // double chevron. Everything else reads as one movement.
  const glyph =
    action === "FLIP" ? (long ? "▼▲" : "▲▼") : long ? "▲" : short ? "▼" : "·";

  return (
    <span className={`hl-dir ${tone}`} data-action={action} title={dir}>
      <span aria-hidden className="hl-dir-glyph">
        {glyph}
      </span>
      <span className="hl-dir-word">{action === "SPOT" ? side : action}</span>
      <span className="sr-only">{dir}</span>
    </span>
  );
}

function VenueTag({ venue, label }: { venue: Venue; label: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate font-medium text-foreground">{label}</span>
      {/* Perp is the default and needs no badge; the other two are genuinely
          different markets and one sampled address traded only equities. */}
      {venue !== "PERP" && (
        <span className="hl-venue" data-venue={venue}>
          {VENUE_TAG[venue]}
        </span>
      )}
    </span>
  );
}

function FeeCell({ fees }: { fees: Record<string, number> }) {
  const entries = Object.entries(fees);
  if (entries.length === 0) return dash;
  return (
    <span className="inline-flex flex-col items-end">
      {entries.map(([token, amount]) => (
        <span
          key={token}
          className={`tabular-nums text-[11px] ${
            // A negative fee is a rebate: the exchange paid them. Same tone language
            // as PnL, because it is money in rather than money out.
            isRebate(amount) ? "text-[var(--gain)]" : "text-muted"
          }`}
        >
          {formatFee(amount, token)}
        </span>
      ))}
    </span>
  );
}

/** Realised PnL, shown only where it exists. */
function PnlCell({ value, realises }: { value: number | null; realises: boolean }) {
  // On an opening fill upstream reports 0, and that 0 means "not applicable", not
  // "broke even". Printing $0.00 there asserts something false — and six of fourteen
  // sampled addresses had no realising fills at all in their window.
  if (!realises || value === null) return dash;
  return (
    <span className={`tabular-nums font-semibold ${toneClass(value)}`}>
      {formatCurrency(value, { showSign: true, compact: Math.abs(value) >= 10_000 })}
    </span>
  );
}

export default function TradesPanel({
  address,
  data,
  loading,
  error,
  onRetry,
}: {
  address: string | null;
  data: TraderSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Re-runs the snapshot fetch for this address (useTrader's reload). */
  onRetry?: () => void;
}) {
  const [grouped, setGrouped] = useState(true);

  // Memoised so the `?? []` fallback is not a fresh array on every render, which
  // would re-run every derivation below for nothing. The fallback is reached only
  // before a snapshot arrives and on the absent branch below, which returns before
  // any of these derivations is rendered — `fills: null` means upstream did not
  // answer, and every stat under it would be a figure about nothing.
  const fills = useMemo(() => (data?.fills ?? []) as LabelledFill[], [data]);
  const orders = useMemo(() => groupFills(fills), [fills]);
  const fees = useMemo(() => feeTotals(fills), [fills]);
  const realised = useMemo(() => realisedTotal(fills), [fills]);
  const span = useMemo(() => fillSpan(fills), [fills]);

  if (!address) {
    return (
      <Panel>
        <Legend>No trader selected</Legend>
        <p className="mt-2 text-sm text-muted">
          Pick a row on the leaderboard to read that address&rsquo;s recent fills.
        </p>
      </Panel>
    );
  }

  if (loading && !data) {
    return (
      <Panel>
        <AddressLegend prefix="Reading tape · " address={address} />
        <div className="mt-3 space-y-1.5" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-card-hover" />
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

  // Absent before empty. The route answers 200 with `fills: null` when the userFills
  // call alone fails, and the copy below asserts "that is a real state, not an error"
  // — a literal falsehood over a call that never answered. It is only ever correct
  // for a genuine [].
  if (data.fills === null) {
    return (
      <Panel>
        <AddressLegend prefix="Tape unavailable · " address={address} />
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
          Upstream did not answer for this address
        </p>
        {/* Re-asks for this address through useTrader's reload: the tab, the
            selection and the rest of the snapshot survive the retry. Disabled while
            a request is in flight, since a partial 200 leaves `data` populated and
            nothing else on screen would say the click landed. */}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            className="mt-3 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)] transition-colors hover:text-foreground disabled:opacity-50"
          >
            {loading ? "Re-reading" : "Re-read"}
          </button>
        )}
      </Panel>
    );
  }

  if (fills.length === 0) {
    return (
      <Panel>
        <AddressLegend prefix="No recent fills · " address={address} />
        <p className="mt-2 text-sm text-muted">
          Upstream answered but reported no fill history for this address. That is a
          real state, not an error — one of the fourteen addresses sampled while
          building this panel was ranked on realised PnL yet had traded nothing
          recently.
        </p>
      </Panel>
    );
  }

  const rows: Order[] = grouped
    ? orders
    : // Ungrouped, each fill becomes a single-fill order so one row renderer serves
      // both views and the two can never drift apart.
      fills.map((f, i) => {
        const facets = dirFacets(f.dir);
        const notional = f.sz !== null && f.px !== null ? f.sz * f.px : null;
        return {
          key: `${f.time ?? i}-${f.coin}-${i}`,
          coin: f.coin,
          label: coinLabel(f.coin, f.label),
          venue: venueOf(f.coin),
          dir: f.dir,
          facets,
          fills: 1,
          size: f.sz,
          notional,
          vwap: f.px,
          closedPnl: facets.realises ? f.closedPnl : null,
          fees: f.fee !== null && f.fee !== 0 ? { [f.feeToken || "USDC"]: f.fee } : {},
          latest: f.time,
          earliest: f.time,
        };
      });

  const sliced = orders.filter((o) => o.fills > 1).length;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <AddressLegend prefix="Recent tape · " address={address} />
          <Legend>
            {span
              ? `${formatClock(span.from)} → ${formatClock(span.to)} · ${formatElapsed(
                  span.from,
                  span.to
                )} of activity`
              : "window unknown"}
          </Legend>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Fills">{fills.length}</Stat>
          <Stat label="Orders">
            {orders.length}
            {sliced > 0 && (
              <span className="ml-1.5 font-mono text-[10px] tracking-[0.16em] text-[var(--legend)]">
                {sliced} sliced
              </span>
            )}
          </Stat>
          <Stat label="Realised">
            {/* Counted, not assumed: this is the total over the fills that actually
                close something, and it says so when that count is zero. */}
            {realised.count === 0 ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
                no closes
              </span>
            ) : (
              <span className={toneClass(realised.total)}>
                {formatCurrency(realised.total, { showSign: true, compact: true })}
              </span>
            )}
          </Stat>
          <Stat label="Fees">
            {/* Never one number: fees arrive in USDC, HYPE and UZEC, and a sum
                across them would be a figure in no currency at all. */}
            <FeeCell fees={fees} />
          </Stat>
        </div>
      </Panel>

      <Panel padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <Legend>{grouped ? "Orders" : "Raw fills"}</Legend>
          <div className="hl-seg" role="group" aria-label="Tape detail">
            <button
              type="button"
              onClick={() => setGrouped(true)}
              aria-pressed={grouped}
              className="hl-seg-btn"
              data-on={grouped}
            >
              Orders
            </button>
            <button
              type="button"
              onClick={() => setGrouped(false)}
              aria-pressed={!grouped}
              className="hl-seg-btn"
              data-on={!grouped}
            >
              Tape
            </button>
          </div>
        </div>

        {grouped && sliced > 0 && (
          <p className="border-b border-border px-4 py-2 text-xs text-muted">
            Consecutive fills on the same market and side within a minute are one
            order. The count on each row is how many fills it took.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="hl-tape w-full text-sm">
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Market</Th>
                <Th>Action</Th>
                <Th align="right">Size</Th>
                <Th align="right">{grouped ? "VWAP" : "Price"}</Th>
                <Th align="right" className="hidden sm:table-cell">
                  Notional
                </Th>
                <Th align="right">Realised</Th>
                <Th align="right" className="hidden lg:table-cell">
                  Fee
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.key} className="hl-tape-row">
                  <td className="px-3 sm:px-4">
                    <span className="font-mono text-[11px] tabular-nums text-muted">
                      {formatClock(o.latest)}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4">
                    <VenueTag venue={o.venue} label={o.label} />
                  </td>
                  <td className="px-2 sm:px-4">
                    <span className="flex items-baseline gap-1.5">
                      <DirCell facets={o.facets} dir={o.dir} />
                      {o.fills > 1 && (
                        // The slice count is the honesty valve on grouping: it says
                        // exactly how many rows this one line stands in for.
                        <span className="hl-slice" title={`${o.fills} fills`}>
                          ×{o.fills}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 text-right">
                    <span className="tabular-nums text-foreground">{formatSize(o.size)}</span>
                  </td>
                  <td className="px-2 sm:px-4 text-right">
                    <span className="tabular-nums text-muted">{formatPrice(o.vwap)}</span>
                  </td>
                  <td className="hidden px-2 text-right sm:table-cell sm:px-4">
                    <span className="tabular-nums text-muted">
                      {o.notional === null
                        ? dash
                        : formatCurrency(o.notional, {
                            compact: Math.abs(o.notional) >= 10_000,
                            decimals: Math.abs(o.notional) >= 10_000 ? 1 : 2,
                          })}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 text-right">
                    <PnlCell value={o.closedPnl} realises={o.facets.realises} />
                  </td>
                  <td className="hidden px-2 pr-4 text-right lg:table-cell">
                    <FeeCell fees={o.fees} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-2 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-[var(--legend)] sm:px-4 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Legend>{label}</Legend>
      <span className="tabular-nums text-sm text-foreground">{children}</span>
    </div>
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
