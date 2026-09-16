"use client";

import { ChevronDown } from "lucide-react";
import { SortField, SortDirection } from "../lib/types";

interface SortHeaderProps {
  label: string;
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}

// One chevron that TURNS, not two that swap colour. A direction toggle is not a travel
// commit — reversing fifty rows says nothing the reader did not already have — so the
// header is the whole of that moment: the chevron rotates through one 200ms settle
// (globals.css .hl-chevron, gated on the commit tier) and the rows simply swap.
//
// The chevron's box keeps the stacked pair's 20px, so the header row — and with it the
// HullPlaceholder's measured 2253px — does not move by a pixel.
export default function SortHeader({
  label,
  field,
  currentField,
  direction,
  onSort,
  align = "right",
}: SortHeaderProps) {
  const isActive = field === currentField;

  return (
    <button
      onClick={() => onSort(field)}
      aria-label={`Sort by ${label}`}
      className={`flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
        isActive ? "text-accent" : "text-muted hover:text-foreground"
      } ${align === "right" ? "ml-auto" : ""}`}
    >
      <span>{label}</span>
      {/* An inactive header points down: that is the direction a click gives it. The
          <th>'s aria-sort carries the state for assistive tech; this is the picture. */}
      <span className="hl-chevron" data-dir={isActive ? direction : "desc"} aria-hidden>
        <ChevronDown
          size={12}
          className={isActive ? "text-accent" : "text-[var(--legend)]/70"}
        />
      </span>
    </button>
  );
}
