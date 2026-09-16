"use client";

import { TimePeriod } from "../lib/types";

interface TimeFilterProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
  /** Disabled while a fetch is in flight, so clicks can't stack requests. */
  disabled?: boolean;
}

const periods: { value: TimePeriod; label: string }[] = [
  { value: "1d", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "allTime", label: "All" },
];

export default function TimeFilter({ value, onChange, disabled = false }: TimeFilterProps) {
  return (
    <div className="flex bg-background rounded-lg p-0.5 sm:p-1 gap-0.5 sm:gap-1">
      {periods.map((period) => (
        <button
          key={period.value}
          type="button"
          onClick={() => onChange(period.value)}
          disabled={disabled}
          aria-pressed={value === period.value}
          // bg-foreground/text-background, the repo's high-contrast active treatment
          // (Projects.tsx "Coming Soon"), not bg-accent/text-white: white on the dark
          // theme's --accent measures 3.68:1, under the 4.5:1 AA asks of this text.
          // Foreground on background is 16.09:1 dark and 19.79:1 light. Accent stays
          // for focus rings. No transition utility: an animated background-color is on
          // the plan's banned list (a fill swap is a discrete state change, and
          // SortSegments has none), and the `transition-colors` that used to sit here
          // never ran anyway — globals.css's unlayered `button, .btn` rule owns every
          // button's transition (transform and box-shadow) and beats any utility, so
          // the class only read as if the fill animated. Measured: the pill's computed
          // transition-property is "transform, box-shadow" with or without it.
          className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-md disabled:opacity-60 ${
            value === period.value
              ? "bg-foreground text-background"
              : "text-muted hover:text-foreground"
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
