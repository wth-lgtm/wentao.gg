"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import TabNavigation from "./components/TabNavigation";
import TimeFilter from "./components/TimeFilter";
import RefreshButton from "./components/RefreshButton";
import LeaderboardTable from "./components/LeaderboardTable";
import { useLeaderboard } from "./hooks/useLeaderboard";
import { useSortAndFilter } from "./hooks/useSortAndFilter";

type Tab = "leaderboard" | "positions" | "trades" | "analytics";

export default function HLWhaleTracker() {
  const [activeTab, setActiveTab] = useState<Tab>("leaderboard");

  // Initialize with empty traders, will be updated after fetch
  const { timePeriod, setTimePeriod, sortField, sortDirection, handleSort } =
    useSortAndFilter([]);

  const { traders, loading, error, lastUpdated, progress, refresh } = useLeaderboard(timePeriod);

  // Use sorted traders from the hook, but with actual data
  const displayTraders = [...traders].sort((a, b) => {
    let aVal: number;
    let bVal: number;

    switch (sortField) {
      case "pnl":
        aVal = a.pnl;
        bVal = b.pnl;
        break;
      case "winRate":
        aVal = a.winRate;
        bVal = b.winRate;
        break;
      case "volume":
        aVal = a.volume;
        bVal = b.volume;
        break;
      default:
        return 0;
    }

    const diff = aVal - bVal;
    return sortDirection === "desc" ? -diff : diff;
  });

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/#projects"
            className="flex items-center gap-2 text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm hidden sm:inline">Back</span>
          </Link>
          <h1 className="text-base sm:text-lg font-bold flex items-center gap-1 sm:gap-1.5">
            <Image
              src="/images/icons/HL symbol_mint green.png"
              alt="Hyperliquid"
              width={20}
              height={20}
              className="w-4 h-4 sm:w-5 sm:h-5"
            />
            🐋 Tracker
          </h1>
          <div className="w-16" />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-center mb-4 sm:mb-6"
        >
          <p className="text-muted text-sm sm:text-base">
            Track top traders by PnL, ROI, and volume
          </p>
        </motion.div>

        {/* API Notice Banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="mb-4 sm:mb-6 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-center"
        >
          <p className="text-red-400 text-xs sm:text-sm font-medium">
            📢 Still tuning the API integration — data may be incomplete or delayed
          </p>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <TabNavigation activeTab={activeTab} onChange={setActiveTab} />
        </motion.div>

        {/* Leaderboard Content */}
        {activeTab === "leaderboard" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            {/* Controls */}
            <div className="flex items-center justify-between mb-4">
              <TimeFilter value={timePeriod} onChange={setTimePeriod} />
              <RefreshButton
                onRefresh={refresh}
                loading={loading}
                lastUpdated={lastUpdated}
              />
            </div>

            {/* Progress indicator */}
            {loading && progress.total > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-muted mb-1">
                  <span>Fetching trader data...</span>
                  <span>
                    {progress.completed} / {progress.total}
                  </span>
                </div>
                <div className="h-1 bg-card rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{
                      width: `${(progress.completed / progress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                {error}
              </div>
            )}

            {/* Leaderboard Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <LeaderboardTable
                traders={displayTraders}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                loading={loading}
              />
            </div>

            {/* Footer info */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="mt-4 text-center text-xs text-muted"
            >
              <p className="flex items-center justify-center gap-1 flex-wrap">
                <span>Data sourced from</span>
                <a
                  href="https://hyperliquid.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <Image
                    src="/images/icons/HL symbol_mint green.png"
                    alt="Hyperliquid"
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5"
                  />
                  Hyperliquid
                </a>
                <span>leaderboard API.</span>
              </p>
            </motion.div>
          </motion.div>
        )}

        {/* Placeholder for other tabs */}
        {activeTab !== "leaderboard" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="bg-card rounded-xl border border-border p-12 text-center"
          >
            <p className="text-muted">Coming soon</p>
          </motion.div>
        )}
      </div>
    </main>
  );
}
