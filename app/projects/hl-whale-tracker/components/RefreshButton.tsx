"use client";

import { RefreshCw } from "lucide-react";

interface RefreshButtonProps {
  onRefresh: () => void;
  /** In flight over data already on screen. Not "no data yet" — see useLeaderboard. */
  refreshing: boolean;
}

// The "Updated 2m ago" text moved to the status rail, which owns snapshot age and
// counts it in real time rather than freezing at render.
export default function RefreshButton({ onRefresh, refreshing }: RefreshButtonProps) {
  return (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      aria-label="Refresh leaderboard"
      className={`flex items-center gap-1.5 rounded-lg bg-background px-2.5 sm:px-3 py-1.5 sm:py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
        refreshing ? "cursor-not-allowed text-muted" : "text-foreground hover:text-accent"
      }`}
    >
      <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} aria-hidden />
      <span className="hidden sm:inline">{refreshing ? "Fetching" : "Refresh"}</span>
    </button>
  );
}
