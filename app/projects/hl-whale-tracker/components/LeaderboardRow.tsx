"use client";

import { ExternalLink } from "lucide-react";
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
}

export default function LeaderboardRow({ trader, rank, selected = false, onSelect }: LeaderboardRowProps) {
  const explorerUrl = `https://app.hyperliquid.xyz/explorer/address/${trader.address}`;

  return (
    <tr
      className={`border-b border-border transition-colors ${
        selected ? "bg-card-hover" : "hover:bg-card-hover"
      }`}
    >
      {/* Rank */}
      <td className="py-3 px-3 sm:px-4">
        <button
          type="button"
          onClick={() => onSelect?.(trader.address)}
          aria-pressed={selected}
          aria-label={`Inspect positions for ${trader.address}`}
          className={`font-bold tabular-nums transition-colors hover:text-accent ${
            rank === 1
              ? "text-yellow-500"
              : rank === 2
              ? "text-gray-400"
              : rank === 3
              ? "text-amber-600"
              : "text-muted"
          }`}
        >
          #{rank}
        </button>
      </td>

      {/* Address */}
      <td className="py-3 px-2 sm:px-4">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 group"
        >
          <div className="flex flex-col">
            {trader.label && (
              <span className="font-medium text-foreground group-hover:text-accent transition-colors">
                {trader.label}
              </span>
            )}
            <span className="text-xs text-muted font-mono">
              {formatAddress(trader.address, 6)}
            </span>
          </div>
          <ExternalLink
            size={12}
            className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </a>
      </td>

      {/* PnL */}
      <td className="py-3 px-2 sm:px-4 text-right">
        <span className={`font-semibold tabular-nums ${toneClass(trader.pnl)}`}>
          {/* Glyph carries direction non-chromatically; formatCurrency already
              emits an explicit +/-. Colour is then the third redundant cue, not
              the only one. */}
          <span aria-hidden className="mr-1 text-[0.7em] align-[0.1em]">
            {signGlyph(trader.pnl)}
          </span>
          {formatCurrency(trader.pnl, { showSign: true, compact: true })}
        </span>
      </td>

      {/* ROI */}
      <td className="py-3 px-2 sm:px-4 text-right">
        <span className={`tabular-nums ${toneClass(trader.winRate)}`}>
          {formatPercent(trader.winRate)}
        </span>
      </td>

      {/* Volume */}
      <td className="py-3 px-2 sm:px-4 text-right hidden lg:table-cell">
        <span className="tabular-nums text-muted">
          {formatCurrency(trader.volume, { compact: true, decimals: 1 })}
        </span>
      </td>
    </tr>
  );
}
