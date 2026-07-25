"use client";

import { ChevronUp, ChevronDown } from "lucide-react";
import { SortField, SortDirection } from "../lib/types";

interface SortHeaderProps {
  label: string;
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}

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
      <div className="flex flex-col -space-y-1">
        <ChevronUp
          size={12}
          className={`${
            isActive && direction === "asc" ? "text-accent" : "text-[var(--legend)]/70"
          }`}
        />
        <ChevronDown
          size={12}
          className={`${
            isActive && direction === "desc" ? "text-accent" : "text-[var(--legend)]/70"
          }`}
        />
      </div>
    </button>
  );
}
