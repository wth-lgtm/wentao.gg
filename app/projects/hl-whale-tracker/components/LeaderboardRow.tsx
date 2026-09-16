"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import Odometer from "./Odometer";
import { DeltaPlate, Legend, Plate } from "./Instrument";
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
  /** The plate: this window's PnL rank. A sort never changes it. */
  rank: number;
  /** Where the current sort put the row, 1-based. Drives the top-down fill stagger. */
  position: number;
  /** Whether the table has a delta column at all (see LeaderboardTable). */
  deltaColumn?: boolean;
  /**
   * Berths moved since the next-shorter window. A number is a reading (0 included);
   * `null` means the trader was not on that window's board; `undefined` means there is
   * no window to compare against (24H), which renders as the unknown.
   */
  delta?: number | null;
  selected?: boolean;
  onSelect?: (address: string) => void;
  registerRow?: (key: string, el: HTMLElement | null) => void;
}

export default function LeaderboardRow({
  trader,
  rank,
  position,
  deltaColumn = false,
  delta,
  selected = false,
  onSelect,
  registerRow,
}: LeaderboardRowProps) {
  const explorerUrl = `https://app.hyperliquid.xyz/explorer/address/${trader.address}`;
  // The compact ROI and the exact one. The title is set only when they DIFFER: below
  // 1000% the compact form is the uncompacted form character for character, so every
  // short ROI on the board carried a tooltip that repeated the cell — a hover target
  // and an extra announcement for no information. 12 of 50 all-time rows are above
  // 1000%, which is where the title earns its place.
  const roi = formatPercent(trader.winRate, { compact: true });
  const roiExact = formatPercent(trader.winRate);

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
        <Plate rank={rank} />
      </td>

      {deltaColumn && (
        <td className="px-2">
          <DeltaPlate delta={delta} />
        </td>
      )}

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
          {/* Staggered by POSITION, not by plate, so the board fills top-down on first
              paint whatever the sort. Capped at the twelfth row — fifty rows at 26ms
              each is 1.3s of arrival, which stops reading as a mechanism and starts
              reading as a slow page. Same cap and the same reason as the trades tape. */}
          <Odometer
            formatted={formatCurrency(trader.pnl, { showSign: true, compact: true })}
            delayMs={Math.min(position - 1, 12) * 26}
          />
        </span>
      </td>

      <td className="px-2 sm:px-4 text-right">
        {/* Compact because this column is locked to 96px by the colgroup and all-time
            ROI runs to 2,641,203.9%: that string measured 94px against a 64px content
            box and spilled into Volume. The exact figure rides in the title. */}
        <span
          className={`tabular-nums ${toneClass(trader.winRate)}`}
          title={roiExact === roi ? undefined : roiExact}
        >
          {roi}
        </span>
      </td>

      <td className="px-2 sm:px-4 text-right hidden lg:table-cell">
        <span className="tabular-nums text-muted">
          {trader.volume === 0 ? (
            // Seven of the fifty on the live 7D board traded exactly nothing (41 on
            // 30D). Saying so beats printing a $0.00 that looks like a bug. <Legend>,
            // not a hand-written copy of its five classes — the phone card next door
            // already said this with the component.
            <Legend>none</Legend>
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
