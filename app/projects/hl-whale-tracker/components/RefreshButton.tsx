"use client";

import { RefreshCw } from "lucide-react";

interface RefreshButtonProps {
  onRefresh: () => void;
  /** In flight over data already on screen. Not "no data yet" — see useLeaderboard. */
  refreshing: boolean;
  /** The last click was answered with the body already on screen. Transient, 1200ms. */
  unchanged: boolean;
}

// The "Updated 2m ago" text moved to the status rail, which owns snapshot age and
// counts it in real time rather than freezing at render.
//
// The third label is the honest end of a click inside the cache window: Vercel consumes
// s-maxage at the edge, so a refresh there is answered from the same CDN snapshot and
// the spinner used to be the whole story — 200ms of implied work over a body that could
// not have moved. "Unchanged" is a result, so it is also the accessible name for as
// long as it is showing; the label itself is `hidden` below sm and the name is the only
// form of it a screen reader ever had.
export default function RefreshButton({
  onRefresh,
  refreshing,
  unchanged,
}: RefreshButtonProps) {
  const label = refreshing ? "Fetching" : unchanged ? "Unchanged" : "Refresh";
  return (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      aria-label={
        refreshing
          ? "Refreshing leaderboard"
          : unchanged
            ? "Refresh leaderboard, the snapshot has not changed"
            : "Refresh leaderboard"
      }
      className={`flex items-center gap-1.5 rounded-lg bg-background px-2.5 sm:px-3 py-1.5 sm:py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
        refreshing ? "cursor-not-allowed text-muted" : "text-foreground hover:text-accent"
      }`}
    >
      <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
