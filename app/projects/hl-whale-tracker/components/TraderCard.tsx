"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import Odometer from "./Odometer";
import { Legend } from "./Instrument";
import { TraderMetrics } from "../lib/types";
import {
  formatAddress,
  formatCurrency,
  formatPercent,
  signGlyph,
  toneClass,
} from "../lib/formatters";
import { tierOf } from "../lib/tier";

interface TraderCardProps {
  trader: TraderMetrics;
  rank: number;
  selected?: boolean;
  onSelect?: (address: string) => void;
}

// The phone's berth. Not a second design — the SAME instrument as the desktop row,
// folded onto two lines because 390px cannot hold five columns.
//
// What this replaced was literally the pre-redesign component: gold/grey/orange
// "#1 #2 #3" (1.74:1 / 2.31:1 / 2.90:1 on the light --card, the exact AA failures
// commit eee25e4 retired on the desktop row), two `bg-background rounded-lg` tiles
// with `text-muted` labels instead of mono --legend legends, and `hover:border-accent/30`
// on a surface only ever mounted under `sm:hidden`, where there is no hover.
//
// So every visual decision here is borrowed rather than invented: .hl-plate for the
// rank, Legend for the labels, the engraved seam from the tape for the separator, the
// Odometer for the figure. Nothing new gets designed for the small screen.
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
      className="hl-berth-card px-3 py-2.5"
    >
      {/* Line 1: rank plate, address, figure. The gaps are 6px, not the row's 8px, and
          the inspect box is 40px rather than 44: at 390px the content box is 332px and
          the widest possible line — a 40px plate, the 6-character address at 120px, and
          a 9-glyph compact figure (the ceiling, since the mantissa never reaches 1000)
          at 103px — measured 333px with 8px gaps and a 44px box, which clipped two
          pixels off the address and cost a hex character. This lands at 323px. */}
      <div className="flex items-center gap-1.5">
        <span className="hl-plate shrink-0" data-tier={tierOf(rank)}>
          {String(rank).padStart(2, "0")}
        </span>

        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Stop the card's select handler firing when the intent was the explorer.
          onClick={(e) => e.stopPropagation()}
          className="flex min-w-0 items-center gap-1 text-muted"
        >
          <span className="truncate font-mono text-xs">
            {formatAddress(trader.address, 6)}
          </span>
          <ExternalLink size={10} aria-hidden className="shrink-0" />
        </a>

        <span
          className={`ml-auto inline-flex shrink-0 items-baseline text-base font-semibold tabular-nums ${toneClass(trader.pnl)}`}
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
            revealed on hover — and it is 40px square (the platform touch minimum)
            rather than the desktop's 28px, with negative margins so the tap box
            grows into the card's padding instead of growing the card. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(trader.address);
          }}
          aria-pressed={selected}
          aria-label={`Inspect positions for ${trader.address}`}
          className="-my-2.5 -mr-3 inline-grid h-10 w-10 shrink-0 place-items-center rounded text-muted"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>

      {/* Line 2: the two readings, as mono legend/value pairs in the rail's language.
          Indented past the plate (40px + the 6px gap) so both lines hang off one edge. */}
      <div className="mt-1.5 flex items-baseline gap-4 pl-[2.875rem]">
        <div className="flex items-baseline gap-1.5">
          <Legend>ROI</Legend>
          {/* Same compact form as the desktop row, so the two views never print the
              same ROI two different ways. The exact figure rides in the title. */}
          <span
            className={`text-xs tabular-nums ${toneClass(trader.winRate)}`}
            title={formatPercent(trader.winRate)}
          >
            {formatPercent(trader.winRate, { compact: true })}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <Legend>VOL</Legend>
          {trader.volume === 0 ? (
            // The desktop row's designed zero. 40 of the 50 rows in the live 30-day
            // window traded exactly nothing (9 in 24H, 5 in 7D, 12 all-time), and this
            // card used to print formatCurrency(0) for every one of them — "$0.0",
            // which reads as a broken number rather than an honest absence.
            <Legend>none</Legend>
          ) : (
            <span className="text-xs tabular-nums text-muted">
              {formatCurrency(trader.volume, { compact: true, decimals: 1 })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
