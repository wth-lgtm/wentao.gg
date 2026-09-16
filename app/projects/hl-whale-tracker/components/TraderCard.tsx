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

interface TraderCardProps {
  trader: TraderMetrics;
  rank: number;
  /** Whether the table has a delta column at all (see LeaderboardTable). */
  deltaColumn?: boolean;
  /**
   * Berths moved since the next-shorter window, exactly as the desktop row takes it: a
   * number is a reading (0 included), `null` means the trader was not on that window's
   * board, `undefined` means there is no window to compare against (24H).
   */
  delta?: number | null;
  selected?: boolean;
  onSelect?: (address: string) => void;
}

// The three layout literals the live card and its arming frame have to agree on, to the
// pixel. They were written out twice — here and in LeaderboardTable's ArmingCards — and
// the arming frame's whole job is to be the card's exact geometry before the data lands,
// so two copies of it is two chances for the stack to jump at the seating moment.
const CARD = "hl-berth-card px-3 py-2.5";
const LINE_1 = "flex items-center gap-1";
// 2.75rem = the 40px plate plus line one's 4px gap, so line two's first legend starts
// exactly where the address does. It was 2.875rem, which was that sum when the gap was
// 6px — measured after the gap changed, the two lines sat 2px apart.
const LINE_2 = "mt-1.5 flex items-baseline gap-4 pl-[2.75rem]";

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
  deltaColumn = false,
  delta,
  selected = false,
  onSelect,
}: TraderCardProps) {
  const explorerUrl = `https://app.hyperliquid.xyz/explorer/address/${trader.address}`;
  // Only when the two differ — see the same pair in LeaderboardRow.
  const roi = formatPercent(trader.winRate, { compact: true });
  const roiExact = formatPercent(trader.winRate);

  return (
    <div
      // The whole card is the pointer target, same as the desktop hl-berth row —
      // no role attribute, because the explorer <a> below is nested interactive
      // content and a role="button" container would make that invalid.
      onClick={() => onSelect?.(trader.address)}
      data-selected={selected}
      className={CARD}
    >
      {/* Line 1: rank plate, address, figure, explorer, inspect. Every width on it is
          spent, so the arithmetic is worth writing down. At 390px the card's content box
          is 332px; the plate is 40; the six-and-six address needs 122.41 (JetBrains Mono
          at 12px); the two 40px controls give back 12px (the inspect box's -mr-3, into
          the card's own padding) and 8px (the explorer's -mx-1); four gaps take 16. That
          leaves 216 minus the figure for the address.

          The FIGURE's ceiling is nine tabular glyphs — "+$999.99B", since formatCurrency
          compacts at two decimals and the mantissa can never reach 1000 — plus the sign
          triangle at 0.7em and its 4px margin. Measured through this odometer: 99.06px.
          The widest figure the live board actually produces is 92.73px, which leaves the
          address 123.27 against the 122.41 it needs: 0.86px of slack.

          So the line fits today and it does NOT fit its own ceiling: at 99.06px the
          address box drops to 116.95 and the ellipsis takes about three quarters of a
          hex character. That is the designed direction of failure, not an oversight — a
          truncated address is already a truncation and degrades to 6+5, while a figure
          giving up a digit would be a wrong number. Nothing else moves: the card does
          not overflow the page at the ceiling.

          The gaps are 4px, not the 6px they were. Promoting the explorer from an inline
          10px glyph to a real 40px control (see below) cost line one 18px, and measured
          across the live 30-day board that pushed 4 of the 50 cards past their budget —
          address box 115.27 against 122.41, one hex character eaten, the exact defect the
          6px gaps were chosen to avoid. Four gaps at 2px less is the 8px that buys it
          back, and it is the only slack on the line that is not a touch target or a
          numeral. */}
      <div className={LINE_1}>
        <Plate rank={rank} className="shrink-0" />

        {/* PLAIN TEXT, not a link. As a link it was a 136x16 box in the middle of line
            one — 9% of the card's area, and sitting right where a thumb lands. Chromium's
            touch-target adjustment snaps a tap within a few pixels of a small link INTO
            it, so a measured tap at the card's centre opened the explorer in a new tab
            and never selected the trader (a tap on line two selected correctly). The
            address is now part of the select target, which is what the rest of the card
            already was. */}
        <span className="truncate font-mono text-xs text-muted">
          {formatAddress(trader.address, 6)}
        </span>

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

        {/* The explorer, as its own control with its own box, and at the END of the line
            rather than beside the address.

            40px square — the platform touch minimum, and the same size as the inspect
            button next to it — with negative vertical margins so the tap box grows into
            the card's padding rather than growing the card, and `-mx-1` giving back 8px
            of the line's width budget so the address keeps its full six-and-six hex
            characters.

            The POSITION is the whole point. Measured at 390px: the card is 356x66, so its
            centre is (178, 33) — and a 40px control placed at the address's right lands on
            x 175-215, y 1-41, which contains that point. So the first cut of this fix
            moved the defect instead of removing it: a tap at the card's centre still
            adjusted into the explorer link and still opened a new tab instead of selecting
            the trader. Here the control sits at x 276-316, 98px clear of the centre, and
            the centre is plain card. */}
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Stop the card's select handler firing when the intent was the explorer.
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${trader.address} in the Hyperliquid explorer`}
          // Out of the tab sequence, the same rule as the desktop row's link: a card is
          // ONE tab stop (the inspect button beside it), not two times fifty. The
          // selected trader's explorer link is reachable from the Inspecting strip
          // (page.tsx); this stays a 40px control for a thumb.
          tabIndex={-1}
          className="-my-2.5 -mx-1 inline-grid h-10 w-10 shrink-0 place-items-center rounded text-muted transition-colors hover:text-accent"
        >
          <ExternalLink size={13} aria-hidden />
        </a>

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
          // hover:text-accent, like the desktop row's .hl-inspect. Below sm is not only
          // touch: a desktop window narrowed past 640px renders this card with a fine
          // pointer, and both of its controls gave no feedback at all on hover.
          className="-my-2.5 -mr-3 inline-grid h-10 w-10 shrink-0 place-items-center rounded text-muted transition-colors hover:text-accent"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>

      {/* Line 2: the readings, as mono legend/value pairs in the rail's language.
          Indented past the plate by LINE_2 so both lines hang off one edge. */}
      <div className={LINE_2}>
        <div className="flex items-baseline gap-1.5">
          <Legend>ROI</Legend>
          {/* Same compact form as the desktop row, so the two views never print the
              same ROI two different ways. The exact figure rides in the title, and only
              when it differs from what is printed. */}
          <span
            className={`text-xs tabular-nums ${toneClass(trader.winRate)}`}
            title={roiExact === roi ? undefined : roiExact}
          >
            {roi}
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
        {/* The delta, in the same three-channel plate the desktop column uses. The phone
            had no delta at all — the plate lived inside LeaderboardRow, so there was
            nothing to import — which left the two views disagreeing about what a berth
            row says. Last on the line and only when the caller wired the windows: the
            reference window is named once, in the desktop table's Δ header, and a phone
            card cannot carry that legend. `ml-auto` puts it on the right edge, clear of
            the two readings. */}
        {deltaColumn && (
          <div className="ml-auto flex items-baseline gap-1.5">
            <Legend>Δ</Legend>
            <DeltaPlate delta={delta} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ARMING: this card's exact frame with the plate and the legends present and every value
 * absent, so the stack is already its final height (fifty cards at the card's measured
 * 65.6px) when the figures land.
 *
 * It is a variant of the card rather than a lookalike in LeaderboardTable, which is what
 * it used to be: it shares CARD, LINE_1 and LINE_2 above, so a change to the card's
 * padding or indent cannot leave the arming frame a different shape.
 *
 * The value slots are load-bearing. Line two's 17px comes from a 12px text-xs value
 * sitting baseline-aligned beside a 10px legend; legends alone measured 16px, which is a
 * pixel per card and a 50px jump in the stack at the seating moment. The slot is a flex
 * item, so an empty one is a zero-height block — the zero-width space is a real text node
 * that gives it the 12px font's strut while printing nothing.
 */
export function ArmingCard({ rank }: { rank: number }) {
  return (
    <div className={CARD} data-arming="true" aria-hidden>
      <div className={LINE_1}>
        <Plate rank={rank} className="shrink-0" />
      </div>
      <div className={LINE_2}>
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
  );
}
