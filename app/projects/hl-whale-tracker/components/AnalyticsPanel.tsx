"use client";

import { useMemo } from "react";
import { TimePeriod, TraderMetrics } from "../lib/types";
import { Legend } from "./Instrument";
import { formatAddress, formatCurrency } from "../lib/formatters";
import {
  Periods,
  WINDOWS,
  WINDOW_LABEL,
  churnMatrix,
  concentration,
  curvePath,
  divergence,
  formatRoi,
  formatShare,
  overlapKey,
  rhoLabel,
  zeroVolumeCohort,
} from "../lib/analytics";

// The Analytics tab.
//
// This is the one tab that does not describe a trader — it describes the BOARD, and
// it exists because measuring the payload contradicts how the board reads. Sorted by
// PnL it looks like a ranking of skill. Across the 24H, 7D and 30D windows the
// address at #1 by PnL sits at #50 of 50 by return, rho(PnL, return) is negative and
// rho(PnL, account size) is +0.73. So it is much closer to a ranking of capital.
//
// That claim is deliberately scoped. In the all-time window it does NOT hold: there
// the top address leads on both, and the correlation flips weakly positive. Stating
// the finding as universal would have been the easier, wronger page.
//
// Costs no network. The leaderboard hook already fetches all four windows in one
// request; this reads what is already in memory.

const CURVE_W = 100;
const CURVE_H = 40;

function Panel({
  children,
  title,
  aside,
}: {
  children: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      style={{ borderTopColor: "var(--engrave-hi)" }}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Legend>{title}</Legend>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One trader, framed as an archetype rather than a row. */
function LeaderCard({
  role,
  trader,
  note,
}: {
  role: string;
  trader: TraderMetrics;
  note: string;
}) {
  return (
    <div className="hl-archetype">
      <Legend>{role}</Legend>
      <a
        href={`https://app.hyperliquid.xyz/explorer/address/${trader.address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block truncate font-mono text-xs text-muted transition-colors hover:text-accent"
      >
        {formatAddress(trader.address, 6)}
      </a>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        <Cell label="PnL">
          {formatCurrency(trader.pnl, { compact: true, showSign: true })}
        </Cell>
        <Cell label="Return">{formatRoi(trader.winRate)}</Cell>
        <Cell label="Capital">
          {formatCurrency(trader.accountValue, { compact: true, decimals: 1 })}
        </Cell>
      </dl>
      <p className="mt-2 text-xs text-muted">{note}</p>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--legend)]">
        {label}
      </dt>
      <dd className="truncate tabular-nums text-xs text-foreground">{children}</dd>
    </div>
  );
}

export default function AnalyticsPanel({
  periods,
  timePeriod,
  loading,
  error = null,
}: {
  periods: Periods;
  timePeriod: TimePeriod;
  loading: boolean;
  /** The leaderboard fetch's failure. This tab needs it more than the table does:
   * page.tsx renders the error banner only under the Leaderboard tab, so a failed
   * first load showed "a failure here means the board itself is empty" with no
   * indication anywhere that anything had failed. */
  error?: string | null;
}) {
  const present = useMemo(
    () => WINDOWS.filter((w) => (periods[w]?.length ?? 0) > 0),
    [periods]
  );
  const churn = useMemo(() => churnMatrix(periods), [periods]);
  const conc = useMemo(
    () => new Map(present.map((w) => [w, concentration(periods[w] ?? [])])),
    [periods, present]
  );
  const divs = useMemo(
    () => new Map(present.map((w) => [w, divergence(w, periods[w] ?? [])])),
    [periods, present]
  );

  if (loading && present.length === 0) {
    return (
      <Panel title="Reading the board">
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-card-hover" />
          ))}
        </div>
      </Panel>
    );
  }

  // Absent before empty: with no windows AND a failed fetch, nothing is known about
  // the board, so the panel cannot say the board is empty.
  if (present.length === 0 && error !== null) {
    return (
      <Panel title="Board unavailable">
        <p className="text-sm text-muted">
          The leaderboard request failed, so there is nothing in memory to aggregate.
          Retry from the Leaderboard tab.
        </p>
      </Panel>
    );
  }

  if (present.length === 0) {
    return (
      <Panel title="Nothing to analyse">
        <p className="text-sm text-muted">
          No window returned rows, so there is nothing to aggregate. This panel derives
          everything from the leaderboard already in memory — it makes no request of its
          own, so a failure here means the board itself is empty.
        </p>
      </Panel>
    );
  }

  // The selected window is emphasised everywhere, but all four are always shown:
  // the finding IS the change across windows, so hiding three of them would hide it.
  const focus = divs.get(timePeriod) ?? divs.get(present[0])!;
  const focusConc = conc.get(focus.window);
  const focusCohort = zeroVolumeCohort(periods[focus.window] ?? []);
  const inverted = focus.pnlLeaderRoiRank === focus.count && focus.count > 1;

  return (
    <div className="space-y-4">
      {/* ── 1. What the board is actually sorting ───────────────────────────── */}
      <Panel
        title="What the board is sorting"
        aside={<Legend>{WINDOW_LABEL[focus.window]} window</Legend>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {focus.pnlLeader && (
            <LeaderCard
              role="Ranked #1 by PnL"
              trader={focus.pnlLeader}
              note={
                inverted
                  ? `Also ranks #${focus.pnlLeaderRoiRank} of ${focus.count} by return — last on the board.`
                  : focus.pnlLeaderRoiRank !== null
                    ? `Ranks #${focus.pnlLeaderRoiRank} of ${focus.count} by return.`
                    : ""
              }
            />
          )}
          {focus.roiLeader && (
            <LeaderCard
              role="Ranked #1 by return"
              trader={focus.roiLeader}
              note="Same window, same fifty addresses — a different trader entirely."
            />
          )}
        </div>

        {/* The correlation strip. Both numbers per window, so the reader watches the
            relationship change rather than taking one figure on trust. */}
        <div className="mt-4 overflow-x-auto">
          <table className="hl-corr w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-left">
                  <Legend>Window</Legend>
                </th>
                <th scope="col" className="text-right">
                  <Legend>PnL vs return</Legend>
                </th>
                <th scope="col" className="text-right">
                  <Legend>PnL vs capital</Legend>
                </th>
                <th scope="col" className="text-right">
                  <Legend>#1 by PnL, ranked by return</Legend>
                </th>
              </tr>
            </thead>
            <tbody>
              {present.map((w) => {
                const d = divs.get(w)!;
                const isFocus = w === focus.window;
                return (
                  <tr key={w} data-focus={isFocus}>
                    <td>
                      <span className="font-mono text-[11px] tracking-[0.12em] text-foreground">
                        {WINDOW_LABEL[w]}
                      </span>
                    </td>
                    <td className="text-right">
                      <Rho value={d.pnlVsRoi} />
                    </td>
                    <td className="text-right">
                      <Rho value={d.pnlVsCapital} />
                    </td>
                    <td className="text-right">
                      <span className="tabular-nums text-xs text-muted">
                        {d.pnlLeaderRoiRank === null
                          ? "—"
                          : `#${d.pnlLeaderRoiRank} of ${d.count}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-muted">
          Across the shorter windows, PnL tracks account size far better than it tracks
          return — and the address at the top has the worst return on the board. The
          all-time window is the exception: there the leader tops both, and the
          relationship flips weakly positive. Rank correlation is Spearman&rsquo;s rho over
          the same fifty rows the table shows.
        </p>
      </Panel>

      {/* ── 2. Concentration ────────────────────────────────────────────────── */}
      <Panel
        title="How concentrated the profit is"
        aside={
          focusConc ? (
            <Legend>
              top address {formatShare(focusConc.topShare)} · top five{" "}
              {formatShare(focusConc.top5Share)}
            </Legend>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <svg
            viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
            preserveAspectRatio="none"
            className="hl-curve h-24 w-full sm:flex-1"
            role="img"
            aria-label={
              focusConc
                ? `Cumulative profit share for the ${WINDOW_LABEL[focus.window]} window: the top address holds ${formatShare(focusConc.topShare)} and the top five hold ${formatShare(focusConc.top5Share)} of the window total.`
                : "Cumulative profit share"
            }
          >
            {/* Perfect-equality diagonal: what the curve would be if all fifty
                addresses had earned the same. The gap to it IS the concentration. */}
            <line
              x1="0"
              y1={CURVE_H}
              x2={CURVE_W}
              y2="0"
              className="hl-curve-equality"
              vectorEffect="non-scaling-stroke"
            />
            {present.map((w) => {
              const c = conc.get(w);
              const d = c ? curvePath(c.curve, CURVE_W, CURVE_H) : "";
              if (!d) return null;
              return (
                <path
                  key={w}
                  d={d}
                  className="hl-curve-line"
                  data-focus={w === focus.window}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:w-56 sm:shrink-0">
            {present.map((w) => {
              const c = conc.get(w)!;
              return (
                <div key={w} className="min-w-0">
                  <dt>
                    <span
                      className="hl-curve-key"
                      data-focus={w === focus.window}
                      aria-hidden
                    />
                    <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--legend)]">
                      {WINDOW_LABEL[w]}
                    </span>
                  </dt>
                  <dd className="tabular-nums text-xs text-foreground">
                    {formatShare(c.topShare)}{" "}
                    <span className="text-[var(--legend)]">top 1</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        <p className="mt-3 text-xs text-muted">
          Each line is the cumulative share of a window&rsquo;s total profit, richest
          address first; the straight diagonal is what perfect equality would look
          like. Concentration is not stable — one address holds{" "}
          {formatShare(conc.get("7d")?.topShare ?? null)} of the 7-day total but only{" "}
          {formatShare(conc.get("allTime")?.topShare ?? null)} of the all-time total.
        </p>
      </Panel>

      {/* ── 3. Churn ────────────────────────────────────────────────────────── */}
      <Panel
        title="How much the top fifty is the same fifty"
        aside={
          <Legend>
            {churn.persistent.length} of 50 in all {present.length} windows
          </Legend>
        }
      >
        <div className="overflow-x-auto">
          <table className="hl-matrix">
            <caption className="sr-only">
              Number of addresses shared between each pair of time windows, out of fifty.
            </caption>
            <thead>
              <tr>
                <td />
                {present.map((w) => (
                  <th key={w} scope="col">
                    {WINDOW_LABEL[w]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {present.map((a) => (
                <tr key={a}>
                  <th scope="row">{WINDOW_LABEL[a]}</th>
                  {present.map((b) => {
                    const n = churn.overlap[overlapKey(a, b)] ?? 0;
                    const self = a === b;
                    return (
                      <td
                        key={b}
                        data-self={self}
                        // Opacity carries magnitude, the numeral carries the value.
                        // Never colour alone.
                        style={self ? undefined : { opacity: 0.35 + (n / 50) * 0.65 }}
                      >
                        <span className="tabular-nums">{n}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-muted">
          Only {churn.persistent.length} addresses hold a place in every window, and the
          30-day and all-time boards share just{" "}
          {churn.overlap[overlapKey("30d", "allTime")] ?? 0}. The leaderboard renders one
          window at a time, so this churn is invisible in the view it belongs to.
        </p>
      </Panel>

      {/* ── 4. The zero-reported-volume cohort ──────────────────────────────── */}
      <Panel
        title="Addresses reporting no volume"
        aside={<Legend>{WINDOW_LABEL[focus.window]} window</Legend>}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Cell label="Addresses">
            {focusCohort.count} of {focus.count}
          </Cell>
          <Cell label="Their PnL">
            {formatCurrency(focusCohort.pnl, { compact: true, showSign: true })}
          </Cell>
          <Cell label="Share of window total">{formatShare(focusCohort.share)}</Cell>
        </div>
        <p className="mt-3 text-xs text-muted">
          Upstream reports volume as exactly zero for {focusCohort.count} of these fifty,
          and those addresses carry {formatShare(focusCohort.share)} of the window&rsquo;s
          profit. Read that as <em>reported</em> volume: a zero here is as likely to mean
          upstream published no figure as it is to mean the address did not trade, and
          the two are not the same claim. It is the reason the board&rsquo;s volume column
          reads <span className="font-mono text-[10px] tracking-[0.16em]">none</span>{" "}
          rather than $0.00.
        </p>
      </Panel>
    </div>
  );
}

function Rho({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="tabular-nums text-xs text-foreground">
        {value === null ? "—" : (value > 0 ? "+" : "") + value.toFixed(2)}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--legend)]">
        {rhoLabel(value)}
      </span>
    </span>
  );
}
