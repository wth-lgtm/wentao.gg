"use client";

import { TraderMetrics, SortField, SortDirection } from "../lib/types";
import SortHeader from "./SortHeader";
import LeaderboardRow from "./LeaderboardRow";
import TraderCard from "./TraderCard";

interface LeaderboardTableProps {
  traders: TraderMetrics[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  loading: boolean;
  /** Address currently focused for the Positions / Trades tabs. */
  selectedAddress?: string | null;
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
  selectedAddress = null,
  onSelect,
}: LeaderboardTableProps) {
  const isEmpty = !loading && traders.length === 0;

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">
            Hyperliquid top traders, ranked. Sorted by {sortField === "winRate" ? "ROI" : sortField}, {sortDirection === "desc" ? "descending" : "ascending"}.
          </caption>
          <thead>
            <tr className="border-b border-border">
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton />
            ) : isEmpty ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-muted">
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
        ) : isEmpty ? (
          <div className="py-12 text-center text-muted bg-card rounded-xl">
            No traders found with activity in this period
          </div>
        ) : (
          traders.map((trader, index) => (
            <TraderCard key={trader.address} trader={trader} rank={index + 1} />
          ))
        )}
      </div>
    </>
  );
}
