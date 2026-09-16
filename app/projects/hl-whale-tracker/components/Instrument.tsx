import { formatAddress } from "../lib/formatters";

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

export const Legend = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
    {children}
  </span>
);

/** The "unknown", as distinct from a zero. */
export const dash = <span className="text-muted">—</span>;

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
