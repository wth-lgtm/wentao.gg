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

interface TraderCardProps {
  trader: TraderMetrics;
  rank: number;
}

export default function TraderCard({ trader, rank }: TraderCardProps) {
  const explorerUrl = `https://app.hyperliquid.xyz/explorer/address/${trader.address}`;

  return (
    <div className="bg-card rounded-xl p-4 border border-border hover:border-accent/30 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`text-lg font-bold tabular-nums ${
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
          </span>
          <div>
            {trader.label && (
              <div className="font-medium text-foreground">{trader.label}</div>
            )}
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted font-mono hover:text-accent transition-colors"
            >
              {formatAddress(trader.address, 6)}
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
        <span className={`text-lg font-bold tabular-nums ${toneClass(trader.pnl)}`}>
          <span aria-hidden className="mr-1 text-[0.7em] align-[0.1em]">
            {signGlyph(trader.pnl)}
          </span>
          {formatCurrency(trader.pnl, { showSign: true, compact: true })}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-background rounded-lg p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">
            ROI
          </div>
          <div className={`font-semibold tabular-nums ${toneClass(trader.winRate)}`}>
            {formatPercent(trader.winRate)}
          </div>
        </div>
        <div className="bg-background rounded-lg p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">
            Volume
          </div>
          <div className="font-semibold tabular-nums">
            {formatCurrency(trader.volume, { compact: true, decimals: 1 })}
          </div>
        </div>
      </div>
    </div>
  );
}
