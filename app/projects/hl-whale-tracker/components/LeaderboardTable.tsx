"use client";

import { Component, useMemo, useRef, type ReactNode } from "react";
import { TraderMetrics, SortField, SortDirection, TimePeriod } from "../lib/types";
import { PREVIOUS_WINDOW, rankByPnl, rankDelta, type RankedTrader } from "../lib/rank";
import { NO_CHANGE, ROW_H, zeroBlock, type BoardChange } from "../lib/commitPlan";
import { useSurfaceTier } from "../hooks/useSurfaceTier";
import { useCommit } from "../hooks/useCommit";
import { Legend, Plate } from "./Instrument";
import SortHeader from "./SortHeader";
import LeaderboardRow from "./LeaderboardRow";
import TraderCard, { ArmingCard } from "./TraderCard";

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
  onSelect?: (address: string) => void;
  /**
   * What the last control change was, and its sequence — the commit engine picks the
   * moment by kind (useCommit.ts). Defaults to "no change yet", under which nothing
   * ever travels.
   */
  change?: BoardChange;
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

interface OutgoingBoardProps {
  seq: number;
  /** Only the period commit needs the outgoing board, and only at the commit tier. */
  armed: boolean;
  onBeforeCommit: () => void;
  children: ReactNode;
}

/**
 * The one hook React does not have. The period commit dissolves the DEPARTING rows as a
 * ghost sheet, which means it needs the outgoing tbody — and every function-component
 * hook (useLayoutEffect included) runs after React has already replaced the rows, when
 * the departures are gone. getSnapshotBeforeUpdate is the API React provides for
 * reading the DOM before an update mutates it, and it exists only on classes; so this
 * is a class, with the one method, wrapping the table. It renders nothing of its own.
 */
class OutgoingBoard extends Component<OutgoingBoardProps> {
  getSnapshotBeforeUpdate(prev: Readonly<OutgoingBoardProps>): null {
    if (this.props.armed && prev.seq !== this.props.seq) this.props.onBeforeCommit();
    return null;
  }

  // React requires the pair. The snapshot is consumed by useCommit's layout effect, which
  // runs in the same commit; there is nothing left to do here.
  componentDidUpdate() {}

  render() {
    return this.props.children;
  }
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
          <td className="px-3 sm:px-4">
            <Plate rank={rank} />
          </td>
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

// The phone's arming frame is TraderCard's own ArmingCard variant, so the two cannot be
// laid out differently: this used to be a second copy of the card's markup and its three
// layout literals, in the one place whose job is to match the card to the pixel.
function ArmingCards() {
  return (
    <>
      {BERTHS.map((rank) => (
        <ArmingCard key={rank} rank={rank} />
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
  onSelect,
  change = NO_CHANGE,
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

  // The commit engine. The wrapper below is the ghost sheet's host and the table is what
  // the ghost is cloned from; the rows register themselves at the commit tier only.
  const hostRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const orderKey = traders.map((t) => t.address).join("|");
  const { registerRow, snapshotOutgoing } = useCommit(orderKey, change, tier, {
    host: hostRef,
    table: tableRef,
  });

  // The rows that traded exactly nothing, as one block, when the volume sort has put
  // them together. Rendered as an overlay over the volume column — an absolutely
  // positioned plate that is not a row, so the tbody stays fifty <tr>s of fifty traders
  // and the travel arithmetic stays exact — with one sentence for a screen reader.
  const block = loading ? null : zeroBlock(traders, sortField);

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
          viewport — and table-fixed with the colgroup below already prevents overflow.
          `relative isolate`: the ghost sheet and the zero-volume block position against
          the table's own box, and the isolation lets the ghost sit at z-index -1 UNDER
          the live rows without falling behind the card's fill. */}
      <div ref={hostRef} className="hidden sm:block relative isolate">
        <OutgoingBoard
          seq={change.seq}
          armed={tier === "commit" && change.kind === "period"}
          onBeforeCommit={snapshotOutgoing}
        >
        {/* aria-busy while arming: fifty empty berths are a frame, not content. */}
        <table ref={tableRef} className="hl-board" aria-busy={loading ? true : undefined}>
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
                  // by useCommit, so the still needs no second flag there.
                  registerRow={tier === "commit" ? registerRow : undefined}
                />
              ))
            )}
          </tbody>
        </table>
        </OutgoingBoard>

        {block && (
          <>
            {/* Anchored to the table's BOTTOM edge — the tbody ends where the table does,
                so the plate lands on its rows without anyone measuring the header — and
                only where the volume column exists (lg). pointer-events: none; the rows
                beneath still select. The words are the plan's "N rows · vlm 0.00 ·
                positions held, not traded", cut to what a 112px column holds; the
                sentence below carries the whole of it. */}
            <div
              // Re-keyed on a PERIOD commit so the plate re-stamps. .hl-block's entrance
              // is `animation: hlBlockStamp` (globals.css), which runs on mount — and a
              // period switch keeps the same element while its rows dissolve, travel and
              // seat underneath it, so the plate slid to a new height and a new count
              // without a stamp, the one still thing in a commit that is all motion.
              // Only `period`: a sort-field commit that keeps the block at all is a
              // re-sort WITHIN the volume sort, where the plate is describing the same
              // rows it already described, and a refresh is not a commit.
              key={change.kind === "period" ? `block-${change.seq}` : "block"}
              className="hl-block hidden lg:flex flex-col items-end justify-start"
              aria-hidden
              style={{ bottom: block.below * ROW_H, height: block.count * ROW_H }}
            >
              <span>{block.count} rows</span>
              <span>vlm 0.00</span>
              <span>untraded</span>
            </div>
            <p className="sr-only">
              {`${block.count} of ${traders.length} rows show a volume of 0.00: positions held, not traded in this window.`}
            </p>
          </>
        )}
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
              // The same two props the desktop row gets, from the same two maps, so
              // neither view can compute a delta the other disagrees with.
              deltaColumn={deltaColumn}
              delta={
                referenceRanks === null
                  ? undefined
                  : rankDelta(currentRanks, referenceRanks, trader.address)
              }
              selected={trader.address === selectedAddress}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
