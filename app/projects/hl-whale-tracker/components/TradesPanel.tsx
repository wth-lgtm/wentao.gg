"use client";

import { Fragment, useMemo, useState } from "react";
import { AddressLegend, Legend, dash } from "./Instrument";
import { formatCurrency, toneClass } from "../lib/formatters";
import { FILL_LIMIT, TraderFills } from "../lib/trader";
import {
  DirFacets,
  LabelledFill,
  Order,
  Venue,
  coinLabel,
  dayKey,
  dirFacets,
  feeTotals,
  fillSpan,
  formatClock,
  formatDate,
  formatDayLabel,
  formatElapsed,
  formatFee,
  formatPrice,
  formatSize,
  formatZone,
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
//
// What the panel also has to say out loud is that those hundred fills are a SAMPLE.
// For an active whale they are: the 7d #1 address's hundred fills spanned five hours
// of a tape upstream can serve fourteen hours of, were all closes, and realised
// +$16.80K — over a period whose full tape was mostly opens and net -$28K. Every
// figure here is right for the rows it holds, so the fix is to name the cap and the
// window on the same line as the figures.

const VENUE_TAG: Record<Venue, string> = { PERP: "PERP", SPOT: "SPOT", EQUITY: "EQ" };

/**
 * Direction as a mechanism rather than a string.
 *
 * Upstream's `dir` values decompose into an action and a side, so the cell can carry
 * both: a chevron for the side and a short word for the action. Colour is the third
 * cue, never the only one — the glyph and the word both survive greyscale.
 *
 * A few dirs need their own word because the action alone would mislabel them (ADL, a
 * settlement, a dust sweep); the raw string stays in the title and in the
 * screen-reader text either way, so the shortening loses nothing.
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
      <span className="hl-dir-word">
        {facets.word ?? (action === "SPOT" ? side : action)}
      </span>
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
  // Whole dollars, never compacted. The 10K compact flip put "+$7,684.44" above
  // "+$10.89K" in one right-aligned column, which inverts the width-as-magnitude cue
  // a tabular column exists for. Cents on a whale's realised PnL carry nothing.
  return (
    <span className={`tabular-nums font-semibold ${toneClass(value)}`}>
      {formatCurrency(value, { showSign: true, decimals: 0 })}
    </span>
  );
}

/**
 * The clock, plus how long a sliced order actually took.
 *
 * A grouped row showed one time for work that spanned up to 58 s on the live sample
 * (252 s on another board address), so the row read as an instant. The span appears
 * only when it is real — more than one fill, at least a second — and the exact range
 * is in the title.
 */
function TimeCell({ order }: { order: Order }) {
  const { latest, earliest, fills } = order;
  const took =
    fills > 1 && latest !== null && earliest !== null && latest - earliest >= 1000
      ? formatElapsed(earliest, latest)
      : null;

  return (
    <span
      className="font-mono text-[11px] tabular-nums text-muted"
      title={took === null ? undefined : `${formatClock(earliest)} → ${formatClock(latest)}`}
    >
      {formatClock(latest)}
      {took !== null && <span className="ml-1.5 text-[var(--legend)]">· {took}</span>}
    </span>
  );
}

/** Re-asks for this address through useTrader's reload. */
function Retry({ onRetry, loading }: { onRetry: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={loading}
      className="mt-3 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)] transition-colors hover:text-foreground disabled:opacity-50"
    >
      {loading ? "Re-reading" : "Re-read"}
    </button>
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
  data: TraderFills | null;
  loading: boolean;
  error: string | null;
  /** Re-reads this trader, both slices (useTrader's reload). */
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
        {/* The only recovery here used to be Clear → leaderboard → reselect, because
            useTrader refetches on a CHANGE of address and re-clicking the same row
            changes nothing. */}
        {onRetry && <Retry onRetry={onRetry} loading={loading} />}
      </Panel>
    );
  }

  if (!data) return null;

  // Absent before empty. The copy below asserts "that is a real state, not an error",
  // which is a literal falsehood over a call that never answered — it is only ever
  // correct for a genuine []. Since the split, an absent tape is the whole of this
  // route's answer being absent, so it arrives as a 502 and the error branch above
  // catches it; this stays as the guard for a `fills: null` that a shape change could
  // still produce, because the state it describes is the one that must never be
  // dressed as "no trades".
  if (data.fills === null) {
    return (
      <Panel>
        <AddressLegend prefix="Tape unavailable · " address={address} />
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
          Upstream did not answer for this address
        </p>
        {/* The tab, the selection and the positions reading all survive the retry.
            Disabled while a request is in flight, since a retry over a body that is
            still on screen changes nothing else to say the click landed. */}
        {onRetry && <Retry onRetry={onRetry} loading={loading} />}
      </Panel>
    );
  }

  if (fills.length === 0) {
    return (
      <Panel>
        <AddressLegend prefix="No recent fills · " address={address} />
        {/* One sentence, about THIS trader. The previous copy spent three on the
            fourteen addresses sampled while the panel was built — a fact about the
            author, not about the address on screen. */}
        <p className="mt-2 text-sm text-muted">
          Upstream answered and reported no fills for this address — a real state, not
          an error.
        </p>
      </Panel>
    );
  }

  const rows: Order[] = grouped
    ? orders
    : // Ungrouped, each fill becomes a single-fill order so one row renderer serves
      // both views and the two can never drift apart.
      fills.map((f, i) => {
        const facets = dirFacets(f.dir, f.closedPnl);
        const notional = f.sz !== null && f.px !== null ? f.sz * f.px : null;
        const id = f.twapId ?? f.oid;
        return {
          key: `${f.time ?? i}-${f.coin}-${i}`,
          orderId: id,
          byId: id !== null,
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
  // Rows the time fallback drew because upstream sent no order id. The copy below
  // promises "one order" only for the rows that can keep the promise.
  const fallback = orders.filter((o) => o.fills > 1 && !o.byId).length;

  // At the cap the span is an artefact of the sample, not a fact about the trader, so
  // the header stops calling it activity and says what it is instead.
  const capped = fills.length >= FILL_LIMIT;
  const crossesDay = span !== null && dayKey(span.from) !== dayKey(span.to);
  // Both dates when the tape crosses one: the live 7d #1 span read "22:45:46 →
  // 03:59:24" to a UTC viewer, an end apparently earlier than its start.
  const stamp = (ms: number) =>
    crossesDay ? `${formatDate(ms)} ${formatClock(ms)}` : formatClock(ms);
  const windowLegend =
    span === null
      ? "window unknown"
      : [
          capped ? `most recent ${FILL_LIMIT} fills` : null,
          `${stamp(span.from)} → ${stamp(span.to)}`,
          `${formatElapsed(span.from, span.to)}${capped ? "" : " of activity"}`,
          // The zone, named once for the panel rather than on every row.
          formatZone(span.to),
        ]
          .filter((part) => part !== null)
          .join(" · ");

  return (
    <div className="space-y-4">
      <Panel>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <AddressLegend prefix="Recent tape · " address={address} />
          <Legend>{windowLegend}</Legend>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat
            label="Fills"
            title={
              capped
                ? `Upstream is sampled to the most recent ${FILL_LIMIT} fills; older fills, including the opens behind these closes, are not shown.`
                : undefined
            }
          >
            {fills.length}
            {capped && (
              <span className="ml-1.5 font-mono text-[10px] tracking-[0.16em] text-[var(--legend)]">
                (cap)
              </span>
            )}
          </Stat>
          <Stat label="Orders">
            {orders.length}
            {sliced > 0 && (
              <span className="ml-1.5 font-mono text-[10px] tracking-[0.16em] text-[var(--legend)]">
                {sliced} sliced
              </span>
            )}
          </Stat>
          {/* "these fills", not "window": the leaderboard already owns that word for
              24H/7D/30D, and this total is neither of those periods. */}
          <Stat
            label="Realised · these fills"
            title="Sum of closedPnl over the fills shown. The leaderboard PnL is a different quantity over a different period."
          >
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
            Fills that belong to the same order are collapsed into one row, keyed on
            the order id upstream reports. The count on each row is how many fills it
            took.
            {fallback > 0 &&
              ` ${fallback} of these rows carried no order id and group consecutive fills on one market and side within a minute instead.`}
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
              {rows.map((o, i) => {
                // Newest-first, so a change of viewer-zone calendar day between two
                // rows means everything BELOW the line happened on the earlier date.
                // Without it the column steps 00:12 → 23:58 and reads as one run.
                const day = dayKey(o.latest);
                const above = i > 0 ? dayKey(rows[i - 1].latest) : null;
                const dayBreak = day !== null && above !== null && above !== day;

                return (
                  <Fragment key={o.key}>
                    {dayBreak && (
                      <tr>
                        {/* Full width, etched by the same tbody rule as every other
                            cell rather than by a border of its own. */}
                        <td colSpan={8} className="px-3 sm:px-4">
                          <Legend>{formatDayLabel(o.latest)}</Legend>
                        </td>
                      </tr>
                    )}
                    <tr className="hl-tape-row">
                      <td className="px-3 sm:px-4">
                        <TimeCell order={o} />
                      </td>
                      <td className="px-2 sm:px-4">
                        <VenueTag venue={o.venue} label={o.label} />
                      </td>
                      <td className="px-2 sm:px-4">
                        <span className="flex items-baseline gap-1.5">
                          <DirCell facets={o.facets} dir={o.dir} />
                          {o.fills > 1 && (
                            // The slice count is the honesty valve on grouping: it
                            // says how many rows this one line stands in for.
                            <span className="hl-slice" title={`${o.fills} fills`}>
                              ×{o.fills}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 text-right">
                        <span className="tabular-nums text-foreground">
                          {formatSize(o.size)}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 text-right">
                        <span className="tabular-nums text-muted">{formatPrice(o.vwap)}</span>
                      </td>
                      <td className="hidden px-2 text-right sm:table-cell sm:px-4">
                        {/* Whole dollars for every row. The 10K compact flip printed
                            "$756.69" wider than "$100.0K" in one column. */}
                        <span className="tabular-nums text-muted">
                          {o.notional === null
                            ? dash
                            : formatCurrency(o.notional, { decimals: 0 })}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 text-right">
                        <PnlCell value={o.closedPnl} realises={o.facets.realises} />
                      </td>
                      <td className="hidden px-2 pr-4 text-right lg:table-cell">
                        <FeeCell fees={o.fees} />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
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

function Stat({
  label,
  title,
  children,
}: {
  label: string;
  /** The qualification the figure needs and the tile has no room for. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
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
