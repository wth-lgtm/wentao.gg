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
          className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-colors disabled:opacity-60 ${
            value === period.value
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
