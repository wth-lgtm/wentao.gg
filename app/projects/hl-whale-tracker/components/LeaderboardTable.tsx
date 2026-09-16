"use client";

import { useMemo } from "react";
import { TraderMetrics, SortField, SortDirection, TimePeriod } from "../lib/types";
import { PREVIOUS_WINDOW, rankByPnl, rankDelta, type RankedTrader } from "../lib/rank";
import { tierOf } from "../lib/tier";
import { useSurfaceTier } from "../hooks/useSurfaceTier";
import { Legend } from "./Instrument";
import SortHeader from "./SortHeader";
import LeaderboardRow from "./LeaderboardRow";
import TraderCard from "./TraderCard";

interface LeaderboardTableProps {
  /** Sorted for display, each row carrying the rank the plate shows (useTableControls.sortRows). */
  traders: RankedTrader[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  loading: boolean;
  /** The leaderboard fetch's failure, if it failed. Zero rows WITH an error is an
   * unknown board; zero rows WITHOUT one is a genuinely empty board, and only the
   * second may say so. */
  error?: string | null;
  /** Address currently focused for the Positions / Trades tabs. */
  selectedAddress?: string | null;
  registerRow?: (key: string, el: HTMLElement | null) => void;
  onSelect?: (address: string) => void;
  /**
   * All four windows, for the delta plate: each row's rank here against its rank in the
   * next-shorter window. Both optional so a caller that has not wired them gets the
   * board without a delta column — the column is added or omitted for the life of the
   * mount, never toggled, so the berth geometry stays locked either way.
   */
  periods?: Partial<Record<TimePeriod, TraderMetrics[]>>;
  timePeriod?: TimePeriod;
}

// The route reduces the upstream to this many rows per window (lib/hyperliquid.ts
// mapAllPeriods, `limit = 50`), which is what makes rank the one column knowable before
// the request is answered: there will be fifty berths, numbered 01–50, whoever sits in them.
const BOARD_SIZE = 50;
const BERTHS = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);

// The four windows as the filter and the rail already spell them (TimeFilter.tsx,
// SoundingRail.tsx WINDOW_LABEL). Repeated here rather than exported from a file this
// task does not own; the delta header is the only reader.
const WINDOW_LABEL: Record<TimePeriod, string> = {
  "1d": "24H",
  "7d": "7D",
  "30d": "30D",
  allTime: "ALL",
};

const legend = "font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--legend)]";

function plate(rank: number) {
  return (
    <span className="hl-plate" data-tier={tierOf(rank)}>
      {String(rank).padStart(2, "0")}
    </span>
  );
}

/**
 * ARMING. Fifty berths with their plates, rendered before the request answers, in the
 * exact geometry the data will land in: the same <tr> height lock, the same columns, the
 * same engraved rules. When the rows arrive they fill these berths and nothing on the
 * page moves — the previous skeleton was five pulse bars (~220px) that jumped to fifty
 * rows (2200px) on arrival. The cells are empty, not dashed: an instrument that has no
 * reading shows no reading (page.tsx HullPlaceholder makes the same argument).
 *
 * Not .hl-berth — these are not selectable, so no pointer cursor and no hover fill.
 */
function ArmingRows({ deltaColumn }: { deltaColumn: boolean }) {
  return (
    <>
      {BERTHS.map((rank) => (
        // aria-hidden: aria-busy is largely ignored by screen readers, and fifty rows of
        // "01" … "50" with empty cells is a frame to look at, not content to read; the
        // caption says the board is loading instead.
        <tr key={rank} data-arming="true" aria-hidden>
          <td className="px-3 sm:px-4">{plate(rank)}</td>
          {deltaColumn && <td />}
          <td />
          <td />
          <td />
          <td className="hidden lg:table-cell" />
          <td />
        </tr>
      ))}
    </>
  );
}

/**
 * The same frame folded for the phone: TraderCard's two lines with the plate and the
 * two legends present and the values absent, so the stack is already its final height
 * (fifty cards at the card's measured 65.6px) when the figures land.
 *
 * The value slots are load-bearing. Line two's 17px comes from a 12px text-xs value
 * sitting baseline-aligned beside a 10px legend; legends alone measured 16px, which is
 * a pixel per card and a 50px jump in the stack at the seating moment. The slot is a
 * flex item, so an empty one is a zero-height block — the zero-width space is a real
 * text node that gives it the 12px font's strut while printing nothing.
 */
function ArmingCards() {
  return (
    <>
      {BERTHS.map((rank) => (
        <div key={rank} className="hl-berth-card px-3 py-2.5" data-arming="true" aria-hidden>
          <div className="flex items-center gap-1.5">{plate(rank)}</div>
          <div className="mt-1.5 flex items-baseline gap-4 pl-[2.875rem]">
            <div className="flex items-baseline gap-1.5">
              <Legend>ROI</Legend>
              <span className="text-xs tabular-nums">{"\u200B"}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <Legend>VOL</Legend>
              <span className="text-xs tabular-nums">{"\u200B"}</span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function LeaderboardTable({
  traders,
  sortField,
  sortDirection,
  onSort,
  loading,
  error = null,
  selectedAddress = null,
  registerRow,
  onSelect,
  periods,
  timePeriod,
}: LeaderboardTableProps) {
  // Two different nothings. useLeaderboard leaves `periods` at {} when the first load
  // throws, so a 502 arrived here as traders: [] and printed "No traders found with
  // activity in this period" — a fabricated fact about the market, sitting directly
  // under page.tsx's red error banner saying the request failed. The upstream always
  // publishes a top-N per window (45,086 rows live), so that copy was in practice
  // reachable ONLY through the error path.
  const noRows = !loading && traders.length === 0;
  const unavailable = noRows && error !== null;
  const isEmpty = noRows && error === null;

  const tier = useSurfaceTier();

  // The delta plate's reference window. `deltaColumn` is whether the caller wired the
  // windows at all; `reference` is which one this window compares against (24H: none).
  const deltaColumn = periods !== undefined && timePeriod !== undefined;
  const reference = deltaColumn ? PREVIOUS_WINDOW[timePeriod] : null;
  const referenceRows = reference === null ? undefined : periods?.[reference];
  const referenceRanks = useMemo(
    () => (referenceRows === undefined ? null : rankByPnl(referenceRows)),
    [referenceRows]
  );
  // Read off the rows rather than re-ranked here, so the plate and the delta cannot be
  // built from two different orders.
  const currentRanks = useMemo(
    () => new Map(traders.map((t) => [t.address, t.canonicalRank])),
    [traders]
  );

  const columns = deltaColumn ? 7 : 6;

  return (
    // data-surface is the structural gate for the board's motion, on the one element
    // that holds both the table and the phone's card stack: below `commit` no odometer
    // under it rolls (CSS) and the rows are not registered for travel (below). A first
    // cut wrote it on the <table>, and the phone's odometers rolled at `seat`.
    <div data-surface={tier}>
      {/* Desktop Table. No overflow-x-auto on this wrapper: it made the wrapper a scroll
          container, which is exactly what a sticky <thead> sticks to instead of the
          viewport — and table-fixed with the colgroup below already prevents overflow. */}
      <div className="hidden sm:block">
        {/* aria-busy while arming: fifty empty berths are a frame, not content. */}
        <table className="hl-board" aria-busy={loading ? true : undefined}>
          {/* Locked geometry: widths never shift between the arming frame, the data, a
              sort or a period switch, which is what lets the re-seat compute travel as
              arithmetic instead of measuring the DOM. Rank is 72, not 68: the plate is
              40px wide and the cell's padding is 16 a side, so 68 left it spilling 4px
              into the next column. */}
          <colgroup>
            <col className="w-[72px]" />
            {deltaColumn && <col className="w-16" />}
            <col />
            <col className="w-[132px]" />
            <col className="w-[96px]" />
            <col className="w-[112px] hidden lg:table-column" />
            <col className="w-9" />
          </colgroup>
          <caption className="sr-only">
            {loading
              ? "Hyperliquid top traders. Loading the board."
              : `Hyperliquid top traders, ranked. Sorted by ${sortField === "winRate" ? "ROI" : sortField}, ${sortDirection === "desc" ? "descending" : "ascending"}.`}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="py-3 px-3 sm:px-4 text-left">
                <span className={legend}>Rank</span>
              </th>
              {deltaColumn && (
                // nowrap: "Δ 24H" fits the 64px column in JetBrains Mono with 6px to spare
                // and wraps in the wider fallback face while the webfont is still loading,
                // which grew the header a line and shifted every row by 25px when it landed.
                <th scope="col" className="whitespace-nowrap py-3 px-2 text-left">
                  {reference === null ? (
                    <span className={legend}>
                      <span aria-hidden>Δ</span>
                      <span className="sr-only">Rank change: no shorter window to compare against</span>
                    </span>
                  ) : (
                    <span className={legend}>
                      <span aria-hidden>Δ {WINDOW_LABEL[reference]}</span>
                      <span className="sr-only">Rank change from the {WINDOW_LABEL[reference]} window</span>
                    </span>
                  )}
                </th>
              )}
              <th scope="col" className="py-3 px-2 sm:px-4 text-left">
                <span className={legend}>Trader</span>
              </th>
              <th scope="col" aria-sort={sortField === "pnl" ? (sortDirection === "desc" ? "descending" : "ascending") : "none"} className="py-3 px-2 sm:px-4 text-right">
                <SortHeader
                  label="PnL"
                  field="pnl"
                  currentField={sortField}
                  direction={sortDirection}
                  onSort={onSort}
                />
              </th>
              <th scope="col" aria-sort={sortField === "winRate" ? (sortDirection === "desc" ? "descending" : "ascending") : "none"} className="py-3 px-2 sm:px-4 text-right">
                <SortHeader
                  label="ROI"
                  field="winRate"
                  currentField={sortField}
                  direction={sortDirection}
                  onSort={onSort}
                />
              </th>
              <th scope="col" aria-sort={sortField === "volume" ? (sortDirection === "desc" ? "descending" : "ascending") : "none"} className="py-3 px-2 sm:px-4 text-right hidden lg:table-cell">
                <SortHeader
                  label="Volume"
                  field="volume"
                  currentField={sortField}
                  direction={sortDirection}
                  onSort={onSort}
                />
              </th>
              <th scope="col" className="w-9" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <ArmingRows deltaColumn={deltaColumn} />
            ) : unavailable ? (
              // Quiet legend colour, no error string: the banner above already carries
              // the detail, and the same failure twice in --loss would read as two.
              <tr>
                <td colSpan={columns} className="py-12 text-center">
                  <Legend>Board unavailable</Legend>
                </td>
              </tr>
            ) : isEmpty ? (
              <tr>
                <td colSpan={columns} className="py-12 text-center text-muted">
                  No traders found with activity in this period
                </td>
              </tr>
            ) : (
              traders.map((trader, index) => (
                <LeaderboardRow
                  key={trader.address}
                  trader={trader}
                  rank={trader.canonicalRank}
                  position={index + 1}
                  deltaColumn={deltaColumn}
                  delta={
                    referenceRanks === null
                      ? undefined
                      : rankDelta(currentRanks, referenceRanks, trader.address)
                  }
                  selected={trader.address === selectedAddress}
                  onSelect={onSelect}
                  // Only the commit tier travels. Unregistered rows are simply not found
                  // by useReSeat, so the still needs no second flag there.
                  registerRow={tier === "commit" ? registerRow : undefined}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-3" aria-busy={loading ? true : undefined}>
        {loading ? (
          <ArmingCards />
        ) : unavailable ? (
          <div className="py-12 text-center bg-card rounded-xl">
            <Legend>Board unavailable</Legend>
          </div>
        ) : isEmpty ? (
          <div className="py-12 text-center text-muted bg-card rounded-xl">
            No traders found with activity in this period
          </div>
        ) : (
          traders.map((trader) => (
            <TraderCard
              key={trader.address}
              trader={trader}
              rank={trader.canonicalRank}
              selected={trader.address === selectedAddress}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
