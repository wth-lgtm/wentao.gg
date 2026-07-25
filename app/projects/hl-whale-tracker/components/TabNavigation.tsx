"use client";

import { Activity, TrendingUp, Trophy, Wallet } from "lucide-react";

export type Tab = "leaderboard" | "positions" | "trades" | "analytics";

// The address label used to be appended INSIDE two of these tabs. That was wrong
// three ways: it duplicated across Positions and Trades, the container's `uppercase`
// mangled the hex into 0XA822...D748, and at flex-1 the extra text wrapped to a
// second line and grew the whole bar. The focused address now lives once, in its own
// strip below, where it can't fight the tab layout.
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "positions", label: "Positions", icon: Wallet },
  { id: "trades", label: "Trades", icon: Activity },
  { id: "analytics", label: "Analytics", icon: TrendingUp },
];

export default function TabNavigation({
  activeTab,
  onChange,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Whale tracker views"
      className="hl-rack mb-3 grid grid-cols-4 gap-1 rounded-xl border border-border bg-card p-1"
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
            className={`hl-tab relative flex min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] whitespace-nowrap transition-colors ${
              active ? "text-white" : "text-[var(--legend)] hover:text-foreground"
            }`}
          >
            {/* The lit plate travels between tabs instead of each tab flipping its
                own background — one moving part, so the control reads as a
                mechanism rather than four independent buttons. */}
            {active && <span aria-hidden className="hl-tab-plate" />}
            <Icon size={14} aria-hidden className="relative z-10 shrink-0" />
            <span className="relative z-10 truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
