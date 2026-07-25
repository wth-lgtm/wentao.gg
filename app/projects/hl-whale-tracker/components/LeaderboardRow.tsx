"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import Odometer from "./Odometer";
import { TraderMetrics } from "../lib/types";
import {
  formatAddress,
  formatCurrency,
  formatPercent,
  signGlyph,
  toneClass,
} from "../lib/formatters";

interface LeaderboardRowProps {
  trader: TraderMetrics;
  rank: number;
  selected?: boolean;
  onSelect?: (address: string) => void;
  registerRow?: (key: string, el: HTMLElement | null) => void;
}

// Tier is static WEIGHT on the berth plate, not a medal colour. The old
// gold/silver/bronze was colour-only and measured poorly in light mode.
const tierOf = (rank: number) => (rank <= 3 ? String(rank) : "4");

export default function LeaderboardRow({
  trader,
  rank,
  selected = false,
  onSelect,
  registerRow,
}: LeaderboardRowProps) {
  const explorerUrl = `https://app.hyperliquid.xyz/explorer/address/${trader.address}`;

  return (
    <tr
      ref={(el) => registerRow?.(trader.address, el)}
      // The whole row is the pointer target — selection used to hang off the rank
      // number, which nothing announced and nobody would think to click.
      onClick={() => onSelect?.(trader.address)}
      data-selected={selected}
      className="hl-berth"
    >
      <td className="px-3 sm:px-4">
        <span className="hl-plate" data-tier={tierOf(rank)}>
          {String(rank).padStart(2, "0")}
        </span>
      </td>

      <td className="px-2 sm:px-4">
        <div className="flex items-center gap-2">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            // Stop the row's select handler firing when the intent was the explorer.
            onClick={(e) => e.stopPropagation()}
            className="group flex min-w-0 items-center gap-1.5"
          >
            <span className="truncate font-mono text-xs text-muted group-hover:text-accent transition-colors">
              {formatAddress(trader.address, 6)}
            </span>
            <ExternalLink
              size={11}
              aria-hidden
              className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
            />
          </a>
        </div>
      </td>

      <td className="px-2 sm:px-4 text-right">
        <span className={`inline-flex items-baseline font-semibold tabular-nums ${toneClass(trader.pnl)}`}>
          <span aria-hidden className="mr-1 text-[0.7em] align-[0.1em]">
            {signGlyph(trader.pnl)}
          </span>
          {/* Staggered by rank so the board fills top-down on first paint. Capped at
              the twelfth row — fifty rows at 26ms each is 1.3s of arrival, which stops
              reading as a mechanism and starts reading as a slow page. Same cap and
              the same reason as the trades tape. */}
          <Odometer
            formatted={formatCurrency(trader.pnl, { showSign: true, compact: true })}
            delayMs={Math.min(rank - 1, 12) * 26}
          />
        </span>
      </td>

      <td className="px-2 sm:px-4 text-right">
        <span className={`tabular-nums ${toneClass(trader.winRate)}`}>
          {formatPercent(trader.winRate)}
        </span>
      </td>

      <td className="px-2 sm:px-4 text-right hidden lg:table-cell">
        <span className="tabular-nums text-muted">
          {trader.volume === 0 ? (
            // Sixteen of the top fifty traded exactly nothing. Saying so beats
            // printing a $0.00 that looks like a bug.
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
              none
            </span>
          ) : (
            formatCurrency(trader.volume, { compact: true, decimals: 1 })
          )}
        </span>
      </td>

      {/* Keyboard path for selection. The row's onClick serves the pointer; this is
          the focusable control, and it doubles as the visible affordance. */}
      <td className="w-9 pr-2 text-right">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(trader.address);
          }}
          aria-pressed={selected}
          aria-label={`Inspect positions for ${trader.address}`}
          className="hl-inspect inline-grid h-7 w-7 place-items-center rounded text-muted hover:text-accent"
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </td>
    </tr>
  );
}
