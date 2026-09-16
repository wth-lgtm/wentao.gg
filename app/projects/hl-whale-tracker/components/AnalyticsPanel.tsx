"use client";

import { useMemo } from "react";
import { TimePeriod, TraderMetrics } from "../lib/types";
import { Legend, Unavailable } from "./Instrument";
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
  plural,
  rhoLabel,
  rhoNoiseFloor,
  zeroVolumeCohort,
} from "../lib/analytics";

// The Analytics tab.
//
// This is the one tab that does not describe a trader — it describes the BOARD, and
// it exists because measuring the payload contradicts how the board reads. Sorted by
// PnL it looks like a ranking of skill; measured, it tracks capital much more closely
// than it tracks return.
//
// Every sentence below is templated over `divs`, `churn` and `conc`. That is the
// whole point of this file's history: the prose used to be a July snapshot, so the
// live table rendered its own refutation 40px above a paragraph claiming the PnL
// leader "has the worst return on the board" (ranks measured 2026-09-16: #21, #26,
// #50, #1) and that the all-time relationship "flips weakly positive" (measured
// 2026-09-16: -0.01, within noise). Any number in the JSX must come from the payload;
// any number in a comment is dated — including those two, which were not.
//
// Costs no network. The leaderboard hook already fetches all four windows in one
// request; this reads what is already in memory.

const CURVE_W = 100;
const CURVE_H = 40;

// Identity for the four concentration curves rides on a dash pattern, not a hue: the
// single-accent rule left every unfocused line and every legend swatch the identical
// grey, so the legend could not say which line was which (and at opacity 0.4 the
// strokes measured 2.18:1 on dark, under the 3:1 WCAG 1.4.11 asks of a graphical
// object). One map, read by both the path and its swatch, is what stops the two
// drifting apart — and 30D is dash-dot rather than the obvious "2 3" because "2 3" is
// the equality diagonal's pattern, and two lines in one chart wearing one pattern is
// the defect this map exists to fix.
const WINDOW_DASH: Record<TimePeriod, string | undefined> = {
  "1d": undefined,
  "7d": "6 3",
  "30d": "4 2 1 2",
  allTime: "1 2",
};
// Raised from the stylesheet's 0.4 (≈3.9:1 on dark). It lives here rather than in
// globals.css so the stroke and its swatch cannot be given different values.
const UNFOCUSED_OPACITY = 0.7;

// The equality diagonal's own pattern, long enough that no window's line can be
// mistaken for the reference the copy tells the reader to measure against — the ALL
// curve sits closest to it and is the one that used to be confusable.
const EQUALITY_DASH = "8 4";

// WINDOW_LABEL is chip text: it belongs in a Legend, a column head, a table cell.
// Sentences get these instead, because "of the ALL total" is not English.
const WINDOW_PROSE: Record<TimePeriod, string> = {
  "1d": "24-hour",
  "7d": "7-day",
  "30d": "30-day",
  allTime: "all-time",
};

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
  className,
}: {
  role: string;
  trader: TraderMetrics;
  note: string;
  className?: string;
}) {
  return (
    <div className={className ? `hl-archetype ${className}` : "hl-archetype"}>
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

/** A signed rho, or the em dash that means it could not be computed. */
const fmtRho = (value: number | null): string =>
  value === null ? "—" : (value > 0 ? "+" : "") + value.toFixed(2);

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
        {/* The same etched failure line the Positions and Trades tabs use, from the
            same shared primitive: this panel said its absent state in muted prose
            while the other two said theirs in mono --loss, so one tab out of three
            did not look like a failure at all. No retry here — this tab makes no
            request of its own, which is why the sentence below points at the one
            that does. */}
        <Unavailable reason="The leaderboard request failed" />
        <p className="mt-2 text-sm text-muted">
          There is nothing in memory to aggregate. Retry from the Leaderboard tab.
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

  // Two independent reduces can land on one address, and in the live all-time window
  // they do (0x4ec8fe22, #1 by both). Two identical cards used to render, the second
  // captioned "a different trader entirely".
  const sameLeader =
    !!focus.pnlLeader && focus.pnlLeader.address === focus.roiLeader?.address;

  // Magnitudes, not signed values: rho(PnL, return) is negative in most windows, so a
  // signed comparison against rho(PnL, capital) would be vacuously true. A window
  // missing either rho is out of the denominator too — counting it as "not capital"
  // would read as evidence for return.
  const comparable = present.filter((w) => {
    const d = divs.get(w)!;
    return d.pnlVsCapital !== null && d.pnlVsRoi !== null;
  });
  const capitalCloser = comparable.filter((w) => {
    const d = divs.get(w)!;
    return Math.abs(d.pnlVsCapital!) > Math.abs(d.pnlVsRoi!);
  }).length;

  // Ordered largest first so the concentration sentence never presumes which window
  // is the concentrated one — the live order has already swapped once.
  const topShares = present
    .map((w) => ({ window: w, share: conc.get(w)?.topShare ?? null }))
    .filter((s): s is { window: TimePeriod; share: number } => s.share !== null)
    .sort((a, b) => b.share - a.share);
  const shareHi = topShares[0];
  const shareLo = topShares[topShares.length - 1];
  // Gated on what is PRINTED, not on the windows being different ones: shares render
  // at 0 decimals, so 14.6% and 15.4% both read "15%" and a sentence claiming
  // instability would refute itself in its own numbers.
  const shareSpread =
    topShares.length > 1 && formatShare(shareHi.share) !== formatShare(shareLo.share);
  const shareSteady = topShares.length > 1 && !shareSpread;
  // Whether it is the SAME address. topShare is the share held by the window's
  // largest earner, which is divergence()'s own pnlLeader, so this needs no second
  // pass over the rows. The sentences below said "one address holds X% of the total in
  // each", which a reader takes as one address across every window — and the churn
  // matrix two panels down measures exactly 1 address in all four, so for most of the
  // board it was the reading the page itself refutes.
  const topAddress = (w: TimePeriod) => divs.get(w)?.pnlLeader?.address;
  const hiAddress = topAddress(shareHi?.window ?? present[0]);
  const sameTopAddress =
    hiAddress !== undefined &&
    topShares.every(({ window: w }) => topAddress(w) === hiAddress);

  // The board is fifty rows per window today, but that is upstream's choice, not
  // ours, and the panel used to spell it "fifty" in four places.
  const boardSize = Math.max(
    ...present.map((w) => churn.overlap[overlapKey(w, w)] ?? 0)
  );

  // "about", because the floor is 0.28284 and the sentence prints two decimals. At
  // n <= 4 the floor is unreachable by construction, and "below Infinity" is not a
  // sentence, so that case says what it means instead.
  const noiseFloor = rhoNoiseFloor(focus.count);
  const noiseNote = Number.isFinite(noiseFloor)
    ? `At n\u00a0= ${focus.count}, |rho| below about ${noiseFloor.toFixed(2)} is within what that many ranks produce by chance, so nothing under it is given a direction.`
    : `At n\u00a0= ${focus.count} every correlation is within what that many ranks produce by chance, so no direction is given at all.`;

  const monthlyOverlap =
    present.includes("30d") && present.includes("allTime")
      ? (churn.overlap[overlapKey("30d", "allTime")] ?? null)
      : null;

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
              role={sameLeader ? "Ranked #1 by both PnL and return" : "Ranked #1 by PnL"}
              trader={focus.pnlLeader}
              // One card spans both columns rather than leaving an empty cell.
              className={sameLeader ? "sm:col-span-2" : undefined}
              note={
                sameLeader
                  ? "In this window the largest earner is also the best earner."
                  : inverted
                    ? `Also ranks #${focus.pnlLeaderRoiRank} of ${focus.count} by return — last on the board.`
                    : focus.pnlLeaderRoiRank !== null
                      ? `Ranks #${focus.pnlLeaderRoiRank} of ${focus.count} by return.`
                      : ""
              }
            />
          )}
          {!sameLeader && focus.roiLeader && (
            <LeaderCard
              role="Ranked #1 by return"
              trader={focus.roiLeader}
              note={
                focus.roiLeaderPnlRank !== null
                  ? `Ranks #${focus.roiLeaderPnlRank} of ${focus.count} by PnL — same window, same ${focus.count} addresses.`
                  : `Same window, same ${focus.count} addresses.`
              }
            />
          )}
        </div>

        {/* The correlation strip. Both numbers per window, so the reader watches the
            relationship change rather than taking one figure on trust.

            Four columns cannot fit a 390px phone — the three left columns and their
            cell padding alone measure ~318px of a ~324px content width — so the
            scroll stays and .hl-scroll-x makes it discoverable. role/tabIndex are the
            scrollable-region pattern: a focusable div with no role fails axe. */}
        <div
          className="hl-scroll-x mt-4 overflow-x-auto"
          role="region"
          aria-label="Rank correlation by window"
          tabIndex={0}
        >
          <table className="hl-corr w-full text-sm">
            <caption className="sr-only">
              Spearman rank correlation per time window: PnL against return, PnL against
              account size, and where the window&rsquo;s PnL leader places by return.
            </caption>
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
                  <Legend>Leader&rsquo;s return rank</Legend>
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
                      <Rho value={d.pnlVsRoi} n={d.count} />
                    </td>
                    <td className="text-right">
                      <Rho value={d.pnlVsCapital} n={d.count} />
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
          In the {WINDOW_PROSE[focus.window]} window, among the {focus.count} largest
          PnLs, PnL against capital is {rhoLabel(focus.pnlVsCapital, focus.count)} (
          {fmtRho(focus.pnlVsCapital)}) and PnL against return is{" "}
          {rhoLabel(focus.pnlVsRoi, focus.count)} ({fmtRho(focus.pnlVsRoi)})
          {focus.pnlLeaderRoiRank !== null && (
            <>
              ; the PnL leader ranks #{focus.pnlLeaderRoiRank} of {focus.count} by return
            </>
          )}
          .
          {comparable.length > 0 && (
            <>
              {" "}
              PnL tracks capital more closely than return in {capitalCloser} of{" "}
              {plural(comparable.length, "window", "windows")}.
            </>
          )}{" "}
          The scoping matters: a sample truncated at the {focus.count} largest PnLs
          mechanically favours capital over return, so this is a statement about the top
          of the board, not about the board.
        </p>
        <p className="mt-2 text-xs text-muted">
          Rank correlation is Spearman&rsquo;s rho over the same rows the table shows.{" "}
          {noiseNote}
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
            // All four curves are drawn, so all four are described. The label used to
            // cover only the focused window, leaving three lines with no text at all.
            aria-label={`Cumulative share of each window's profit, richest address first. ${present
              .map((w) => {
                const c = conc.get(w);
                return `${WINDOW_PROSE[w]}: top address ${formatShare(c?.topShare ?? null)}, top five ${formatShare(c?.top5Share ?? null)}`;
              })
              .join("; ")}. The ${WINDOW_PROSE[focus.window]} window is emphasised.`}
          >
            {/* Perfect-equality diagonal: what the curve would be if every address in
                the window had earned the same. The gap to it IS the concentration.
                Drawn in --muted because --engrave-lo measured 1.11:1 on dark, which
                is not a reference line anyone can see, and in a long dash that no
                window wears, so the ALL curve running closest to it cannot be read as
                the reference itself.

                Withheld when no window has more than one address. A one-row window's
                cumulative curve IS this diagonal by construction — one address holds
                100% of its own total — so drawing the reference underneath it puts two
                identical lines on the chart under copy telling the reader to measure
                the gap between them, and the only gap available is zero. Nothing is
                lost: with one address there is no distribution to be concentrated. */}
            {boardSize > 1 && (
              <line
                x1="0"
                y1={CURVE_H}
                x2={CURVE_W}
                y2="0"
                className="hl-curve-equality"
                strokeDasharray={EQUALITY_DASH}
                style={{ stroke: "var(--muted)" }}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {present.map((w) => {
              const c = conc.get(w);
              const d = c ? curvePath(c.curve, CURVE_W, CURVE_H) : "";
              if (!d) return null;
              const isFocus = w === focus.window;
              return (
                <path
                  key={w}
                  d={d}
                  className="hl-curve-line"
                  data-focus={isFocus}
                  strokeDasharray={WINDOW_DASH[w]}
                  style={{ opacity: isFocus ? 1 : UNFOCUSED_OPACITY }}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:w-56 sm:shrink-0">
            {present.map((w) => {
              const c = conc.get(w)!;
              const isFocus = w === focus.window;
              return (
                <div key={w} className="min-w-0">
                  <dt>
                    {/* An actual line, not a coloured block: the swatch has to carry
                        the same dash pattern as the curve it names, and the only way
                        to guarantee that is to draw it the same way — which includes
                        wearing the curve's own class, so the two cannot be given
                        different strokes. It restated `var(--accent)` / `var(--legend)`
                        inline, one copy of the focus colour per swatch.

                        The width and the opacity are overridden through `style`, not
                        through the SVG presentation attributes they were written as.
                        A presentation attribute sits at the very bottom of the author
                        cascade — below every stylesheet rule — so `strokeWidth={2}`
                        lost to .hl-curve-line's `stroke-width: 1` and the swatch
                        rendered as exactly the hairline this comment said it avoided
                        (measured: attribute 2, computed 1px; focused attribute 3,
                        computed 2px). An inline style wins, which is also how the
                        chart's own <path> sets its opacity a few lines up. */}
                    <svg
                      className="mr-1.5 inline-block align-middle"
                      width="16"
                      height="4"
                      viewBox="0 0 16 4"
                      aria-hidden
                    >
                      <line
                        x1="0"
                        y1="2"
                        x2="16"
                        y2="2"
                        className="hl-curve-line"
                        data-focus={isFocus}
                        strokeDasharray={WINDOW_DASH[w]}
                        style={{
                          // 3px and 2px, not the chart's 1px and 2px: a hairline is
                          // right in a 100x40 chart and invisible in a 16x4 box.
                          strokeWidth: isFocus ? 3 : 2,
                          opacity: isFocus ? 1 : UNFOCUSED_OPACITY,
                        }}
                      />
                    </svg>
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
          address first; the straight diagonal is what perfect equality would look like.
          {shareSpread && (
            <>
              {" "}
              Concentration is not stable across windows: the largest earner holds{" "}
              {formatShare(shareHi.share)} of the {WINDOW_PROSE[shareHi.window]} total and{" "}
              {sameTopAddress ? "the same address holds" : "another holds"}{" "}
              {formatShare(shareLo.share)} of the {WINDOW_PROSE[shareLo.window]} total.
            </>
          )}
          {shareSteady && (
            <>
              {" "}
              Concentration is similar across the windows measured:{" "}
              {sameTopAddress
                ? "one address holds"
                : "each window\u2019s largest earner holds"}{" "}
              {formatShare(shareHi.share)} of the total in each
              {sameTopAddress ? "" : ", but they are not all the same address"}.
            </>
          )}
        </p>
      </Panel>

      {/* ── 3. Churn ────────────────────────────────────────────────────────── */}
      <Panel
        title={`How much the top ${boardSize} is the same ${boardSize}`}
        aside={
          <Legend>
            {plural(churn.persistent.length, "address", "addresses")} in all{" "}
            {plural(present.length, "window", "windows")}
          </Legend>
        }
      >
        <div className="hl-scroll-x overflow-x-auto">
          <table className="hl-matrix">
            <caption className="sr-only">
              Number of addresses shared between each pair of time windows; the diagonal
              is each window against itself.
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
                        // Never colour alone. The denominator is the board's own size
                        // — the panel spent four places spelling that "fifty" before
                        // boardSize existed, and this was the fifth: a board of 20
                        // would have ramped over a range it never reaches and shown
                        // every pair at nearly the same shade.
                        style={
                          self
                            ? undefined
                            : { opacity: 0.35 + (boardSize > 0 ? n / boardSize : 0) * 0.65 }
                        }
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
          {plural(churn.persistent.length, "address holds", "addresses hold")} a place in
          every window
          {monthlyOverlap !== null && (
            <>
              , and the {WINDOW_PROSE["30d"]} and {WINDOW_PROSE.allTime} boards share{" "}
              {monthlyOverlap}
            </>
          )}
          . The leaderboard renders one window at a time, so this churn is invisible in
          the view it belongs to.
        </p>
      </Panel>

      {/* ── 4. The zero-perpetuals-volume cohort ────────────────────────────── */}
      <Panel
        title="Addresses with no perpetuals volume"
        aside={<Legend>{WINDOW_LABEL[focus.window]} window</Legend>}
      >
        {/* A <dl>, because Cell emits a dt/dd pair and this grid was a plain div —
            three term/definition pairs with no list to belong to. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Cell label="Addresses">
            {focusCohort.count} of {focus.count}
          </Cell>
          <Cell label="Their PnL">
            {formatCurrency(focusCohort.pnl, { compact: true, showSign: true })}
          </Cell>
          <Cell label="Share of window total">{formatShare(focusCohort.share)}</Cell>
        </dl>
        <p className="mt-3 text-xs text-muted">
          Volume here is perpetuals volume. The board&rsquo;s PnL and account value also
          mark spot holdings to market, so an address can post a large PnL in a window
          without a single perp trade.
          {focusCohort.count > focus.count / 2 && (
            <>
              {" "}
              In the {WINDOW_PROSE[focus.window]} window that is most of the board:{" "}
              {focusCohort.count} of {focus.count}, carrying{" "}
              {formatShare(focusCohort.share)} of the profit.
            </>
          )}
        </p>
      </Panel>
    </div>
  );
}

function Rho({ value, n }: { value: number | null; n: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="tabular-nums text-xs text-foreground">{fmtRho(value)}</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--legend)]">
        {rhoLabel(value, n)}
      </span>
    </span>
  );
}
