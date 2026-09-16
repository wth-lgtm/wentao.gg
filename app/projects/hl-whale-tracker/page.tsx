"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import TimeFilter from "./components/TimeFilter";
import RefreshButton from "./components/RefreshButton";
import LeaderboardTable from "./components/LeaderboardTable";
import SoundingRail from "./components/SoundingRail";
import TabNavigation, { type Tab } from "./components/TabNavigation";
import PositionsPanel from "./components/PositionsPanel";
import TradesPanel from "./components/TradesPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import { useLeaderboard } from "./hooks/useLeaderboard";
import { useTableControls } from "./hooks/useTableControls";
import { useTrader } from "./hooks/useTrader";
import { useReSeat } from "./hooks/useReSeat";
import { useTabpanelFocus } from "./hooks/useTabpanelFocus";
import { formatAddress } from "./lib/formatters";

export default function HLWhaleTracker() {
  const [activeTab, setActiveTab] = useState<Tab>("leaderboard");
  const [focused, setFocused] = useState<string | null>(null);

  const { timePeriod, setTimePeriod, sortField, sortDirection, handleSort, sortRows } =
    useTableControls();

  const {
    traders,
    periods,
    loading,
    refreshing,
    error,
    lastUpdated,
    rowsSeen,
    ttlSeconds,
    refresh,
  } = useLeaderboard(timePeriod);

  const trader = useTrader(activeTab === "leaderboard" ? null : focused);

  // Selecting a row jumps straight to its positions — the tab is the destination,
  // so making the click do nothing visible would be the wrong affordance.
  const selectTrader = (address: string) => {
    setFocused(address);
    setActiveTab("positions");
  };

  // One sort site. This used to be re-implemented inline here, unmemoized, while
  // the hook's own memoized sort ran against a permanently-empty array.
  const displayTraders = sortRows(traders);
  // The re-seat animates rows to new berths whenever the sorted ORDER changes.
  const order = displayTraders.map((t) => t.address);
  const registerRow = useReSeat(order.join("|"), order);
  // Whether the open panel needs its own tab stop depends on what it currently holds,
  // so it is measured after render rather than declared per panel. See the hook.
  const tabpanelRef = useTabpanelFocus();

  return (
    <main className="min-h-screen bg-background">
      {/* Header. No backdrop-blur: a full-width backdrop-filter re-rasterises on
          every scroll frame, and later phases put a live canvas underneath it.
          Three-column grid so the title is optically centred at every width
          rather than balanced against a fixed-width spacer. */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95">
        <div className="max-w-4xl mx-auto px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center">
          <Link
            href="/#projects"
            className="flex items-center gap-2 justify-self-start text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm hidden sm:inline">Back</span>
          </Link>
          <h1 className="flex items-center gap-1.5 text-base sm:text-lg font-bold">
            <Image
              src="/images/icons/HL symbol_mint green.png"
              alt=""
              width={20}
              height={20}
              className="w-4 h-4 sm:w-5 sm:h-5"
            />
            Whale Tracker
          </h1>
          <span />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          {/* Status rail — replaces the banner that read "Still tuning the API
              integration" in error red. */}
          <SoundingRail
            refreshing={refreshing}
            rowsSeen={rowsSeen}
            surfaced={displayTraders.length}
            period={timePeriod}
            updatedAt={lastUpdated}
            ttlSeconds={ttlSeconds}
          />

          <TabNavigation activeTab={activeTab} onChange={setActiveTab} />

          {/* The focused address lives HERE, once, where it cannot fight the tab
              layout. Not uppercased — a hex address rendered 0XA822 is just wrong. */}
          {focused && activeTab !== "leaderboard" && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
                Inspecting
              </span>
              <span className="truncate font-mono text-xs text-foreground">
                {formatAddress(focused, 8)}
              </span>
              <button
                type="button"
                onClick={() => { setFocused(null); setActiveTab("leaderboard"); }}
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)] hover:text-foreground"
              >
                Clear
              </button>
            </div>
          )}

          {activeTab === "leaderboard" && (
            <div ref={tabpanelRef} role="tabpanel" id="hl-panel-leaderboard" aria-labelledby="hl-tab-leaderboard">
              <div className="flex items-center justify-between mb-4">
                <TimeFilter value={timePeriod} onChange={setTimePeriod} />
                <RefreshButton onRefresh={refresh} refreshing={refreshing} />
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-[var(--loss)]/30 bg-[var(--loss)]/10 p-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
                  {error}
                </div>
              )}

              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <LeaderboardTable
                  traders={displayTraders}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  loading={loading}
                  error={error}
                  selectedAddress={focused}
                  onSelect={selectTrader}
                  registerRow={registerRow}
                />
              </div>
            </div>
          )}

          {activeTab === "positions" && (
            <div ref={tabpanelRef} role="tabpanel" id="hl-panel-positions" aria-labelledby="hl-tab-positions">
              <PositionsPanel
                address={focused}
                data={trader.data}
                loading={trader.loading}
                error={trader.error}
                onRetry={trader.reload}
              />
            </div>
          )}

          {activeTab === "trades" && (
            <div ref={tabpanelRef} role="tabpanel" id="hl-panel-trades" aria-labelledby="hl-tab-trades">
              <TradesPanel
                address={focused}
                data={trader.data}
                loading={trader.loading}
                error={trader.error}
                onRetry={trader.reload}
              />
            </div>
          )}

          {activeTab === "analytics" && (
            <div ref={tabpanelRef} role="tabpanel" id="hl-panel-analytics" aria-labelledby="hl-tab-analytics">
              <AnalyticsPanel
                periods={periods}
                timePeriod={timePeriod}
                loading={loading}
                error={error}
              />
            </div>
          )}

          <p className="mt-4 flex items-center justify-center gap-1 flex-wrap text-center text-xs text-muted">
            <span>Data sourced from</span>
            <a
              href="https://hyperliquid.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              <Image
                src="/images/icons/HL symbol_mint green.png"
                alt=""
                width={14}
                height={14}
                className="w-3.5 h-3.5"
              />
              Hyperliquid
            </a>
            <span>leaderboard API.</span>
          </p>
        </motion.div>
      </div>
    </main>
  );
}
