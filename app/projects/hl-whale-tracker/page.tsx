"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import type { SortDirection, SortField, TimePeriod } from "./lib/types";

// The tabs that describe one trader. The Inspecting strip and the per-trader fetch
// were both gated on `!== "leaderboard"`, which put "INSPECTING 0x5b5d…" directly
// above the board-wide Analytics panels — implying they were scoped to that address —
// gave that tab a CLEAR button that yanked the reader back to the leaderboard, and
// fired an unused GET /api/hl-trader (12 positions + 100 fills) that nothing there
// reads. Positions → Analytics → Positions now re-fetches, which is exactly what
// Positions → Leaderboard → Positions already did.
const TRADER_TABS: readonly Tab[] = ["positions", "trades"];

// One sentence per settled commit, composed this long after the last input moves. The
// delay is what makes it one sentence rather than three: a window switch re-sorts, the
// re-seat runs and a wake refetch may land inside it, and all of that is one commit.
const ANNOUNCE_DEBOUNCE_MS = 150;

const WINDOW_WORD: Record<TimePeriod, string> = {
  "1d": "24 hour",
  "7d": "7 day",
  "30d": "30 day",
  allTime: "all time",
};
// Spoken, so these are the words on the column headers rather than the field names the
// upstream payload uses (types.ts:49: `winRate` is "Actually ROI from API").
const SORT_WORD: Record<SortField, string> = {
  pnl: "PnL",
  winRate: "ROI",
  volume: "volume",
};
const DIRECTION_WORD: Record<SortDirection, string> = {
  asc: "ascending",
  desc: "descending",
};

/**
 * What the page currently shows, in one sentence. Pure, so the live region has nothing
 * to decide: the only thing the caller adds is whether a refresh was asked for.
 */
function settledSentence({
  tab,
  focused,
  period,
  sort,
  dir,
  surfaced,
}: {
  tab: Tab;
  focused: string | null;
  period: TimePeriod;
  sort: SortField;
  dir: SortDirection;
  surfaced: number;
}): string {
  if (TRADER_TABS.includes(tab)) {
    const panel = tab === "positions" ? "Positions" : "Trades";
    return focused === null
      ? `${panel}: no trader selected.`
      : `${panel} for ${formatAddress(focused, 6)}.`;
  }
  const board = `${WINDOW_WORD[period]} window, ${surfaced} traders, ranked by ${SORT_WORD[sort]} ${DIRECTION_WORD[dir]}.`;
  // Analytics reads the board itself, so it gets the board's sentence with its subject
  // named — the panels there are not scoped to a trader.
  return tab === "analytics" ? `Board analytics. ${board}` : board;
}

/**
 * The instrument's geometry, held for the one frame between the prerendered HTML and
 * hydration. The controls live in the query string now, and `useSearchParams` is not
 * available during a static prerender — Next bails the boundary below to this instead,
 * which is why it must occupy the rail's and the rack's exact height rather than
 * nothing. It states no value: a placeholder that reads "SURFACED 0" would be a number
 * the page does not have yet.
 */
function HullPlaceholder() {
  return (
    <div aria-hidden>
      <div className="mb-4 rounded-xl border border-border bg-card px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]">
        &nbsp;
      </div>
      <div className="mb-3 rounded-xl border border-border bg-card p-1">
        <div className="py-2.5 font-mono text-[11px]">&nbsp;</div>
      </div>
    </div>
  );
}

function WhaleTracker() {
  const {
    activeTab,
    focused,
    timePeriod,
    sortField,
    sortDirection,
    setTimePeriod,
    handleSort,
    selectTab,
    selectTrader,
    clearTrader,
    sortRows,
  } = useTableControls();

  const {
    traders,
    periods,
    loading,
    refreshing,
    error,
    snapshot,
    rowsSeen,
    ttlSeconds,
    unchanged,
    refresh,
  } = useLeaderboard(timePeriod);

  const trader = useTrader(TRADER_TABS.includes(activeTab) ? focused : null);

  // One sort site. This used to be re-implemented inline here, unmemoized, while
  // the hook's own memoized sort ran against a permanently-empty array.
  const displayTraders = sortRows(traders);
  // The re-seat animates rows to new berths whenever the sorted ORDER changes.
  const order = displayTraders.map((t) => t.address);
  const registerRow = useReSeat(order.join("|"), order);
  // Whether the open panel needs its own tab stop depends on what it currently holds,
  // so it is measured after render rather than declared per panel. See the hook.
  const tabpanelRef = useTabpanelFocus();

  // A refresh is the one commit the sentence below cannot infer: the CDN can answer a
  // click with the same fifty rows in the same order, and "nothing happened" is still
  // the answer to a button press. Recorded on the click rather than read out of the
  // hook so a wake refetch, which nobody asked for, stays silent.
  const askedRef = useRef(false);
  const onRefresh = useCallback(() => {
    askedRef.current = true;
    refresh();
  }, [refresh]);

  // The 1200ms UNCHANGED reading belongs to the instrument, not to the announcement:
  // when it expires nothing has been committed, so it must not be a dependency of the
  // effect that decides when to speak — a revert to the previous sentence would be a
  // second announcement for one click.
  const unchangedRef = useRef(false);
  useEffect(() => {
    unchangedRef.current = unchanged;
  }, [unchanged]);

  const sentence = settledSentence({
    tab: activeTab,
    focused,
    period: timePeriod,
    sort: sortField,
    dir: sortDirection,
    surfaced: displayTraders.length,
  });

  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => {
      // Nothing has landed yet: the skeleton is the statement, and a row count of 0
      // announced mid-flight would be a number the page does not have.
      if (loading) return;
      const settled = askedRef.current && !refreshing;
      if (settled) askedRef.current = false;
      const head = settled
        ? unchangedRef.current
          ? "Refresh complete, the snapshot has not changed. "
          : "Refresh complete. "
        : "";
      // An identical string is not written back to the DOM, which is what keeps a
      // repeated state (a wake refetch that changed nothing, a sort that reverses and
      // reverses again) from announcing twice.
      setAnnouncement(
        head + (error ? `Leaderboard unavailable: ${error}` : sentence)
      );
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [sentence, error, loading, refreshing]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      {/* The page's ONLY live region (plan of record: exactly one). It is a sibling of
          the panels rather than a child of any of them — a region inside a container
          that goes aria-busy is not announced while it is busy — and it never carries
          a per-row message or the age clock, which would interrupt a reader every
          second forever. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {/* Status rail — replaces the banner that read "Still tuning the API
          integration" in error red. */}
      <SoundingRail
        refreshing={refreshing}
        unchanged={unchanged}
        rowsSeen={rowsSeen}
        surfaced={displayTraders.length}
        period={timePeriod}
        snapshot={snapshot}
        ttlSeconds={ttlSeconds}
      />

      <TabNavigation activeTab={activeTab} onChange={selectTab} />

      {/* The focused address lives HERE, once, where it cannot fight the tab
          layout. Not uppercased — a hex address rendered 0XA822 is just wrong. */}
      {focused && TRADER_TABS.includes(activeTab) && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
            Inspecting
          </span>
          <span className="truncate font-mono text-xs text-foreground">
            {formatAddress(focused, 8)}
          </span>
          <button
            type="button"
            onClick={clearTrader}
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
            <RefreshButton onRefresh={onRefresh} refreshing={refreshing} unchanged={unchanged} />
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
  );
}

export default function HLWhaleTracker() {
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
        {/* What the page is. Everything below this line is instrument chrome — the
            first thing a visitor used to read was "STATE IDLE | SCANNED 45,089 |
            SURFACED 50", which is a reading, not an introduction. Deliberately OUTSIDE
            the boundary below so it is in the prerendered HTML: it is the only
            sentence on the page that says what the page does. */}
        <p className="mb-4 text-sm text-muted">
          The fifty most profitable Hyperliquid perp accounts in a window, ranked by
          PnL. Select a berth to read what it holds and what it just traded; Analytics
          reads the board itself.
        </p>

        {/* The five controls live in the query string, and reading them with
            `useSearchParams` opts the subtree out of the static prerender — without a
            boundary here `next build` fails the whole route. The boundary is also what
            keeps the header and the line above in the prerendered HTML. */}
        <Suspense fallback={<HullPlaceholder />}>
          <WhaleTracker />
        </Suspense>
      </div>
    </main>
  );
}
