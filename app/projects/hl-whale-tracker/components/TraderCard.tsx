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

interface TraderCardProps {
  trader: TraderMetrics;
  rank: number;
  selected?: boolean;
  onSelect?: (address: string) => void;
}

export default function TraderCard({
  trader,
  rank,
  selected = false,
  onSelect,
}: TraderCardProps) {
  const explorerUrl = `https://app.hyperliquid.xyz/explorer/address/${trader.address}`;

  return (
    <div
      // The whole card is the pointer target, same as the desktop hl-berth row —
      // no role attribute, because the explorer <a> below is nested interactive
      // content and a role="button" container would make that invalid.
      onClick={() => onSelect?.(trader.address)}
      data-selected={selected}
      className={`rounded-xl border p-4 transition-colors cursor-pointer ${
        selected
          ? "border-border bg-card-hover border-l-[3px] border-l-accent"
          : "bg-card border-border hover:border-accent/30"
      }`}
    >
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
              // Stop the card's select handler firing when the intent was the explorer.
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-muted font-mono hover:text-accent transition-colors"
            >
              {formatAddress(trader.address, 6)}
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`inline-flex items-baseline text-lg font-bold tabular-nums ${toneClass(trader.pnl)}`}
          >
            <span aria-hidden className="mr-1 text-[0.7em] align-[0.1em]">
              {signGlyph(trader.pnl)}
            </span>
            {/* Mobile shows three cards at a time, not fifty rows, so the stagger is
                tighter — a 26ms-per-row cascade tuned for a full board reads as lag
                when only a few are on screen. */}
            <Odometer
              formatted={formatCurrency(trader.pnl, { showSign: true, compact: true })}
              delayMs={Math.min(rank - 1, 6) * 40}
            />
          </span>
          {/* Keyboard/AT path for selection. Touch devices have no hover, so unlike
              the desktop row's .hl-inspect this control is always visible, not
              revealed on hover. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(trader.address);
            }}
            aria-pressed={selected}
            aria-label={`Inspect positions for ${trader.address}`}
            className="inline-grid h-8 w-8 shrink-0 place-items-center rounded text-muted transition-colors hover:text-accent"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-background rounded-lg p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">
            ROI
          </div>
          {/* Same compact form as the desktop row, so the two views never print the
              same ROI two different ways. The exact figure rides in the title. */}
          <div
            className={`font-semibold tabular-nums ${toneClass(trader.winRate)}`}
            title={formatPercent(trader.winRate)}
          >
            {formatPercent(trader.winRate, { compact: true })}
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
