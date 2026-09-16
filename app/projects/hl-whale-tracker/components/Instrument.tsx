import { formatAddress, signGlyph, toneClass } from "../lib/formatters";
import { tierOf } from "../lib/tier";

// The panels' shared etched-instrument primitives.
//
// `Legend` was copy-pasted byte-identically into PositionsPanel, TradesPanel and
// AnalyticsPanel, and `dash` into two of them. That duplication is how seven header
// strings ended up interpolating a hex address INSIDE an `uppercase` span, printing
// "PERP ACCOUNT · 0X5B5D51...98C060" a few pixels under the Inspecting strip's
// correctly-cased "0x5b5d5120...f298c060" — two casings of one address on one screen.
// page.tsx and TabNavigation.tsx both say in comments that an address rendered 0XA822
// "is just wrong"; the panels were simply missed.
//
// So the address gets its own component rather than a convention to remember:
// AddressLegend is the only sanctioned way to put an address in a legend, which is
// what stops the next copy-paste from re-uppercasing it.

// The board's two plates live here for the same reason. The berth plate was written out
// three times — LeaderboardRow, TraderCard and LeaderboardTable's own local `plate()` —
// and the delta plate once, in LeaderboardRow, which is why the phone card had no delta
// at all: there was nothing to import.

export const Legend = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
    {children}
  </span>
);

/** The "unknown", as distinct from a zero. */
export const dash = <span className="text-muted">—</span>;

/** The berth plate: this window's PnL rank, zero-padded, tiered by .hl-plate. A sort
 * never changes it (see lib/rank.ts). */
export function Plate({ rank, className }: { rank: number; className?: string }) {
  return (
    <span
      className={className ? `hl-plate ${className}` : "hl-plate"}
      data-tier={tierOf(rank)}
    >
      {String(rank).padStart(2, "0")}
    </span>
  );
}

// An unmoved berth is a KNOWN zero, so it may not share a glyph with the unknown: this
// repo reads the em dash as "unknown" (`dash` above, used that way across the panels),
// and the delta plate has a genuine unknown of its own — the 24H window has no shorter
// window to compare against. The middle dot is signGlyph's own zero.
const UNMOVED = "·";

/**
 * The delta plate. Direction is carried three ways at once — the glyph, the tone token
 * and the numeral — so no single channel is load-bearing: the glyph survives a
 * monochrome print, the tone survives a glance, the numeral survives both. The sr-only
 * words are what a screen reader gets instead of "black up-pointing triangle".
 *
 * `undefined` is "no reference window" (24H), `null` is "not on that window's board",
 * and a number is a reading with 0 included.
 */
export function DeltaPlate({ delta }: { delta: number | null | undefined }) {
  if (delta === undefined) {
    // No reference window (24H): the reading is unknown, and the unknown is the em dash.
    return (
      <span className="hl-delta" data-tone="unknown">
        {dash}
      </span>
    );
  }
  if (delta === null) {
    // Not on the previous board. Unknown too, but a specific one — the trader arrived —
    // so it gets the etched legend the volume column uses for its designed absence.
    return <Legend>new</Legend>;
  }
  if (delta === 0) {
    return (
      <span className="hl-delta" data-tone="flat">
        <span aria-hidden>{UNMOVED}</span>
        <span className="sr-only">unchanged</span>
      </span>
    );
  }
  return (
    <span
      className={`hl-delta ${toneClass(delta)}`}
      data-tone={delta > 0 ? "up" : "down"}
    >
      <span aria-hidden>{signGlyph(delta)}</span>
      <span className="sr-only">{delta > 0 ? "up" : "down"} </span>
      {Math.abs(delta)}
    </span>
  );
}

/**
 * The absent state, which is NOT the empty state.
 *
 * A trader route answers 200 with a partial body when one of its upstream calls fails
 * — Hyperliquid returns 429 on a second sequential call from a shared egress IP — and
 * the snapshot carries that as null. Rendering the designed "currently flat" or "no
 * trades" copy over it asserts a fact about the whale that the app does not have.
 *
 * Shared because it was not: PositionsPanel had `Unavailable` + `ReRead`, TradesPanel
 * had `Retry` (byte-identical to ReRead but for the prop name) plus two inline copies
 * of this same paragraph's classes. Three copies of one state is how one of them ends
 * up the odd one out.
 */
export function Unavailable({
  reason,
  onRetry,
  busy = false,
}: {
  reason: string;
  onRetry?: () => void;
  busy?: boolean;
}) {
  return (
    <>
      <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
        {reason}
      </p>
      {onRetry && <ReRead onRetry={onRetry} busy={busy} />}
    </>
  );
}

/**
 * Re-asks for THIS address through useTrader's reload, so the tab, the selection and
 * the rest of the snapshot all survive the retry. Disabled while a request is in
 * flight because a partial 200 leaves `data` populated, so nothing else on screen
 * changes to say the click landed.
 */
export function ReRead({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      className="mt-3 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)] transition-colors hover:text-foreground disabled:opacity-50"
    >
      {busy ? "Re-reading" : "Re-read"}
    </button>
  );
}

/** A legend whose tail is an address: the label is etched, the hex is not touched. */
export function AddressLegend({
  prefix,
  address,
  chars = 6,
}: {
  prefix: string;
  address: string;
  chars?: number;
}) {
  return (
    <Legend>
      {prefix}
      {/* text-transform and letter-spacing both inherit, so `normal-case` and
          `tracking-normal` on the child undo the legend's casing and tracking for the
          hex alone; `text-foreground` is the treatment the Inspecting strip uses. */}
      <span className="normal-case tracking-normal text-foreground">
        {formatAddress(address, chars)}
      </span>
    </Legend>
  );
}
