"use client";

import { TraderMetrics, SortField, SortDirection } from "../lib/types";
import { Legend } from "./Instrument";
import SortHeader from "./SortHeader";
import LeaderboardRow from "./LeaderboardRow";
import TraderCard from "./TraderCard";

interface LeaderboardTableProps {
  traders: TraderMetrics[];
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
}

// Loading skeleton for desktop
function TableSkeleton() {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i} className="border-b border-border">
          <td className="py-3 px-4">
            <div className="h-4 w-8 bg-card-hover animate-pulse rounded" />
          </td>
          <td className="py-3 px-4">
            <div className="space-y-1">
              <div className="h-4 w-20 bg-card-hover animate-pulse rounded" />
              <div className="h-3 w-32 bg-card-hover animate-pulse rounded" />
            </div>
          </td>
          <td className="py-3 px-4 text-right">
            <div className="h-4 w-16 bg-card-hover animate-pulse rounded ml-auto" />
          </td>
          <td className="py-3 px-4 text-right">
            <div className="h-4 w-12 bg-card-hover animate-pulse rounded ml-auto" />
          </td>
          <td className="py-3 px-4 text-right hidden lg:table-cell">
            <div className="h-4 w-16 bg-card-hover animate-pulse rounded ml-auto" />
          </td>
        </tr>
      ))}
    </>
  );
}

// Loading skeleton for mobile
function CardSkeleton() {
  return (
    <>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-card rounded-xl p-4 border border-border animate-pulse">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-6 w-8 bg-background rounded" />
              <div className="space-y-1">
                <div className="h-4 w-16 bg-background rounded" />
                <div className="h-3 w-24 bg-background rounded" />
              </div>
            </div>
            <div className="h-6 w-20 bg-background rounded" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, j) => (
              <div key={j} className="bg-background rounded-lg p-2.5">
                <div className="h-3 w-12 bg-card rounded mb-1" />
                <div className="h-4 w-16 bg-card rounded" />
              </div>
            ))}
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

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="hl-board">
          {/* Locked geometry: widths never shift between skeleton, data, sort or
              period switch, which is what lets the re-seat compute travel as
              arithmetic instead of measuring the DOM. */}
          <colgroup>
            <col className="w-[68px]" />
            <col />
            <col className="w-[132px]" />
            <col className="w-[96px]" />
            <col className="w-[112px] hidden lg:table-column" />
            <col className="w-9" />
          </colgroup>
          <caption className="sr-only">
            Hyperliquid top traders, ranked. Sorted by {sortField === "winRate" ? "ROI" : sortField}, {sortDirection === "desc" ? "descending" : "ascending"}.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="py-3 px-3 sm:px-4 text-left">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--legend)]">
                  Rank
                </span>
              </th>
              <th scope="col" className="py-3 px-2 sm:px-4 text-left">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--legend)]">
                  Trader
                </span>
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
              <TableSkeleton />
            ) : unavailable ? (
              // Quiet legend colour, no error string: the banner above already carries
              // the detail, and the same failure twice in --loss would read as two.
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <Legend>Board unavailable</Legend>
                </td>
              </tr>
            ) : isEmpty ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted">
                  No traders found with activity in this period
                </td>
              </tr>
            ) : (
              traders.map((trader, index) => (
                <LeaderboardRow
                  key={trader.address}
                  trader={trader}
                  rank={index + 1}
                  selected={trader.address === selectedAddress}
                  onSelect={onSelect}
                  registerRow={registerRow}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-3">
        {loading ? (
          <CardSkeleton />
        ) : unavailable ? (
          <div className="py-12 text-center bg-card rounded-xl">
            <Legend>Board unavailable</Legend>
          </div>
        ) : isEmpty ? (
          <div className="py-12 text-center text-muted bg-card rounded-xl">
            No traders found with activity in this period
          </div>
        ) : (
          traders.map((trader, index) => (
            <TraderCard
              key={trader.address}
              trader={trader}
              rank={index + 1}
              selected={trader.address === selectedAddress}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </>
  );
}
