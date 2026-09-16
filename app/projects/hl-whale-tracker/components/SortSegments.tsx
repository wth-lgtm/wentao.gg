"use client";

import { ChevronDown } from "lucide-react";
import type { SortDirection, SortField } from "../lib/types";

// The phone's sort control.
//
// Below sm the board is a card stack and the <thead> that holds the SortHeaders is
// `hidden sm:block`, so `?sort=roi&dir=asc` was a state the URL accepted and no phone
// control could write: a visitor who arrived on it from a shared link had no way off it,
// and one who wanted the ROI order had no way on. Three segments for the three figures
// the cards print, driven by the SAME onSort the headers use — so the URL, the direction
// toggle (a second tap on the active segment) and the canonical plates behave identically
// whichever control was tapped.
//
// Active fill is bg-foreground/text-background, the repo's high-contrast active treatment
// (Projects.tsx "Coming Soon", TimeFilter, the tab plate): 16.09:1 dark, 19.79:1 light.
// Accent is kept for focus rings. No transition on the fill: a fill swap is a discrete
// state change, and an animated background-color is on the plan's banned list.
//
// 40px segments, the platform touch minimum, in the etched legend's own type. The
// chevron is SortHeader's — one glyph that turns for the direction — and the direction is
// spelled out for a screen reader, since aria-pressed alone says which segment is on and
// not which way it sorts.

const SEGMENTS: { field: SortField; label: string }[] = [
  { field: "pnl", label: "PNL" },
  { field: "winRate", label: "ROI" },
  { field: "volume", label: "VOL" },
];

export default function SortSegments({
  field,
  direction,
  onSort,
}: {
  field: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Sort the board"
      className="flex gap-0.5 rounded-lg bg-background p-0.5"
    >
      {SEGMENTS.map((segment) => {
        const active = segment.field === field;
        return (
          <button
            key={segment.field}
            type="button"
            aria-pressed={active}
            onClick={() => onSort(segment.field)}
            className={`flex min-h-10 flex-1 items-center justify-center gap-1 rounded-md font-mono text-[10px] uppercase tracking-[0.16em] ${
              active
                ? "bg-foreground text-background"
                : "text-[var(--legend)] hover:text-foreground"
            }`}
          >
            <span>{segment.label}</span>
            {active && (
              <>
                <span className="hl-chevron" data-dir={direction} aria-hidden>
                  <ChevronDown size={12} />
                </span>
                <span className="sr-only">
                  , {direction === "desc" ? "descending" : "ascending"}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
