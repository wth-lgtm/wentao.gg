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
import { useLeaderboard } from "./hooks/useLeaderboard";
import { useTableControls } from "./hooks/useTableControls";
import { useTrader } from "./hooks/useTrader";
import { formatAddress } from "./lib/formatters";

export default function HLWhaleTracker() {
  const [activeTab, setActiveTab] = useState<Tab>("leaderboard");
  const [focused, setFocused] = useState<string | null>(null);

  const { timePeriod, setTimePeriod, sortField, sortDirection, handleSort, sortRows } =
    useTableControls();

  const { traders, loading, refreshing, error, lastUpdated, rowsSeen, ttlSeconds, refresh } =
    useLeaderboard(timePeriod);

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

          <TabNavigation
            activeTab={activeTab}
            onChange={setActiveTab}
            focusedLabel={focused ? formatAddress(focused, 4) : null}
          />

          {activeTab === "leaderboard" && (
            <>
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
                  selectedAddress={focused}
                  onSelect={selectTrader}
                />
              </div>
            </>
          )}

          {activeTab === "positions" && (
            <PositionsPanel
              address={focused}
              data={trader.data}
              loading={trader.loading}
              error={trader.error}
            />
          )}

          {(activeTab === "trades" || activeTab === "analytics") && (
            <section className="rounded-xl border border-border bg-card p-6">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
                {activeTab === "trades" ? "Trades" : "Analytics"} — next PR
              </span>
              <p className="mt-2 text-sm text-muted">
                {activeTab === "trades"
                  ? "Fill history is already flowing from the API route this PR added (up to 100 recent fills per address, with direction, size, price, realised PnL and fee). The table lands next."
                  : "Aggregate view across the top fifty — PnL concentration, ROI spread, and how many addresses hold rank across the four windows. Derived from data already in memory, so it needs no new request."}
              </p>
            </section>
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
