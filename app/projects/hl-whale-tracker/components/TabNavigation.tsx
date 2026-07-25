"use client";

import { Activity, TrendingUp, Trophy, Wallet } from "lucide-react";

export type Tab = "leaderboard" | "positions" | "trades" | "analytics";

// Restored. Restyled into the mono/etched legend language the rail introduced, so
// this stops being a second segmented control that disagreed with TimeFilter.
//
// Positions and Trades are real tabs now, but they describe ONE trader, so they
// need a focused row. Rather than looking broken when nothing is selected, they
// stay reachable and say what to do.
const TABS: { id: Tab; label: string; icon: React.ElementType; needsTrader: boolean }[] = [
  { id: "leaderboard", label: "Leaderboard", icon: Trophy, needsTrader: false },
  { id: "positions", label: "Positions", icon: Wallet, needsTrader: true },
  { id: "trades", label: "Trades", icon: Activity, needsTrader: true },
  { id: "analytics", label: "Analytics", icon: TrendingUp, needsTrader: false },
];

export default function TabNavigation({
  activeTab,
  onChange,
  focusedLabel,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
  /** Short label for the focused trader, if any — shown so the scope is never ambiguous. */
  focusedLabel: string | null;
}) {
  return (
    <div
      role="tablist"
      aria-label="Whale tracker views"
      className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1"
      style={{ borderTopColor: "var(--engrave-hi)" }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
              active
                ? "bg-accent text-white"
                : "text-[var(--legend)] hover:text-foreground"
            }`}
          >
            <Icon size={14} aria-hidden />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.needsTrader && focusedLabel && !active && (
              <span className="hidden md:inline opacity-60">· {focusedLabel}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
