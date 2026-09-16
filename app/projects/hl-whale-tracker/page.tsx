"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * The instrument's geometry, held for the gap between the prerendered HTML and
 * hydration. The controls live in the query string now, and `useSearchParams` is not
 * available during a static prerender — Next bails the boundary below to this instead,
 * so whatever this does NOT occupy is a layout shift at hydration. The first version
 * stood in for the rail and the rack only, which left the filter row, the table card
 * (which used to prerender a five-row skeleton) and the footer line to appear from
 * nothing: ~400px of movement on every cold load.
 *
 * Every height below is measured off the real LOADING hull in `next dev`, which is the
 * state hydration lands in — the fetch has not resolved yet — at the two widths the
 * board is checked at:
 *
 *            390px   1440px
 *   rail       59       59   (two wrapped lines at both; ONE line, 36px, from 475 to
 *                             767, where SRC is still hidden and the fields fit on one)
 *   rack       48       48
 *   filter     32       44
 *   table    3282     2253   (the arming frame: fifty berth cards vs. a thead and
 *                             fifty berths — rank is knowable before the request
 *                             answers, so the placeholder is the hull's true height)
 *   footer     20       20
 *
 * It states no value. A placeholder reading "SURFACED 0" or "AGE --:--" would be the
 * instrument asserting a reading before it has one, which is the thing this page is
 * most careful about.
 */
function HullPlaceholder() {
  return (
    <div aria-hidden>
      {/* The rail's one-line band starts at 475px, not at Tailwind's sm (640px). Measured
          on the LOADING rail in `next dev` — the state hydration lands in — by stalling
          /api/hl-leaderboard and stepping the viewport a pixel at a time: 59.19px up to
          474px, 35.59px from 475px to 767px, 59.19px again from 768px where SRC appears.
          The `sm:` boundary was a guess at where the fields stop wrapping, and it was
          23.4px wrong across 165px of viewport — a phone in landscape and every small
          tablet reserved two lines for a rail that renders one, and the hull collapsed by
          that much at hydration. An arbitrary min-[] variant is worth more than a round
          number here, because the number is a content wrap point and not a breakpoint. */}
      <div className="mb-4 h-[59px] rounded-xl border border-border bg-card min-[475px]:h-9 md:h-[59px]" />
      <div className="mb-3 h-12 rounded-xl border border-border bg-card" />
      {/* The filter row is deliberately an empty spacer, not a card: the real row is
          `bg-background` pills on the page's own `bg-background`, so a filled block
          here would be MORE visible than the thing it stands in for and would flash
          out at hydration. */}
      <div className="mb-4 h-8 sm:h-11" />
      <div className="h-[3282px] rounded-xl border border-border bg-card sm:h-[2253px]" />
      <div className="mt-4 h-5" />
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
    change,
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
    errorKind,
    snapshot,
    rowsSeen,
    rowsPartial,
    ttlSeconds,
    unchanged,
    refresh,
  } = useLeaderboard(timePeriod);

  const trader = useTrader(TRADER_TABS.includes(activeTab) ? focused : null);

  // One sort site. This used to be re-implemented inline here, unmemoized, while
  // the hook's own memoized sort ran against a permanently-empty array.
  //
  // Memoized, because the array's IDENTITY is a dependency downstream: sortRows returns
  // a fresh array every call, and LeaderboardTable's `currentRanks` map is a useMemo
  // keyed on it — so an unmemoized call here rebuilt that fifty-entry map on every
  // render of this page, including every tick of the rail's age clock. sortRows is
  // itself a useCallback over [sort, dir], so this recomputes exactly when the order
  // can actually change.
  const displayTraders = useMemo(() => sortRows(traders), [sortRows, traders]);
  // Whether the open panel needs its own tab stop depends on what it currently holds,
  // so it is measured after render rather than declared per panel. See the hook.
  const tabpanelRef = useTabpanelFocus();

  // The leaderboard's own equity for the focused address, which the Positions panel
  // needs to quantify the gap against the live perp account instead of just warning
  // that one exists. It is already in memory for the window on screen, so this costs
  // no request; null when the address is not in that window at all (a deep link, or a
  // row that has dropped out of the top fifty), and the panel says so differently.
  const focusedEquity = useMemo(
    () =>
      focused === null
        ? null
        : traders.find((t) => t.address.toLowerCase() === focused.toLowerCase())
            ?.accountValue ?? null,
    [focused, traders]
  );

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
  // Alternated when the visitor ASKED for the commit. A live region does not re-announce
  // text identical to what it already holds, which is right for a state that merely
  // recurred — a wake refetch that changed nothing, a sort reversed and reversed again —
  // and wrong for an action just taken: two presses of Refresh over an unchanged
  // snapshot produce the same sentence, and the second one said nothing at all. A
  // zero-width space makes the text node differ without adding a spoken character.
  const nonceRef = useRef(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      // Nothing has landed yet: the skeleton is the statement, and a row count of 0
      // announced mid-flight would be a number the page does not have.
      if (loading) return;
      const settled = askedRef.current && !refreshing;
      if (settled) askedRef.current = false;
      const speak = (text: string) => {
        if (!settled) {
          setAnnouncement(text);
          return;
        }
        nonceRef.current = !nonceRef.current;
        setAnnouncement(nonceRef.current ? `${text}\u200B` : text);
      };
      // An identical string is not written back to the DOM, which is what keeps a
      // repeated state (a wake refetch that changed nothing, a sort that reverses and
      // reverses again) from announcing twice.
      //
      // A refresh that FAILED gets its own sentence rather than the completion head
      // over the failure: "Refresh complete. Leaderboard unavailable: …" both
      // contradicts itself and, because the error string is usually the same one
      // already showing, was the only way a failed click could announce nothing at all.
      //
      // But only a REQUEST failure is a failed refresh. The hook composes one `error`
      // string from a thrown request and from a 200 whose rows could not be read, and
      // this branch called both a failure: a click that completed and came back with an
      // unreadable board announced "Refresh failed", and the unreadable message — which
      // already opens "Leaderboard unreadable:" — was prefixed with a second
      // "Leaderboard unavailable:". errorKind is what tells them apart.
      if (error !== null) {
        const failed = errorKind === "request";
        speak(
          settled
            ? failed
              ? `Refresh failed: ${error}`
              : `Refresh complete. ${error}`
            : failed
              ? `Leaderboard unavailable: ${error}`
              : error
        );
        return;
      }
      const head = settled
        ? unchangedRef.current
          ? "Refresh complete, the snapshot has not changed. "
          : "Refresh complete. "
        : "";
      speak(head + sentence);
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [sentence, error, errorKind, loading, refreshing]);

  return (
    // The page's one entrance, as a CSS keyframe. It was a framer-motion `motion.div`
    // fading opacity and 10px of y over 300ms — the only motion component on the route,
    // for which the initial script set carried ~35-45KB brotli of animation runtime
    // (chunk d21c4c109d68c963.js, 123.7KB decoded, plus a 9KB br framer chunk) on a
    // page whose real motion — the re-seat, the odometers, the tape — is Web Animations
    // and CSS by design. `.animate-fade-in-up` is the same gesture from globals.css, it
    // runs on the compositor, and the global reduced-motion block already collapses it
    // to a designed still rather than a slowdown.
    <div className="animate-fade-in-up">
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
        rowsPartial={rowsPartial}
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

          {/* overflow-clip, not overflow-hidden: hidden makes the card a scroll container,
              and a sticky header sticks to the nearest one of those — this card never
              scrolls, so the header sat 46px down inside it and covered berth 01. clip
              still cuts the last berth's fill to the rounded corners. */}
          <div className="bg-card rounded-xl border border-border overflow-clip">
            <LeaderboardTable
              traders={displayTraders}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              loading={loading}
              error={error}
              selectedAddress={focused}
              onSelect={selectTrader}
              change={change}
              periods={periods}
              timePeriod={timePeriod}
            />
          </div>
        </div>
      )}

      {activeTab === "positions" && (
        <div ref={tabpanelRef} role="tabpanel" id="hl-panel-positions" aria-labelledby="hl-tab-positions">
          <PositionsPanel
            address={focused}
            data={trader.positions.data}
            loading={trader.positions.loading}
            error={trader.positions.error}
            leaderboardAccountValue={focusedEquity}
            onRetry={trader.reload}
          />
        </div>
      )}

      {activeTab === "trades" && (
        <div ref={tabpanelRef} role="tabpanel" id="hl-panel-trades" aria-labelledby="hl-tab-trades">
          <TradesPanel
            address={focused}
            data={trader.fills.data}
            loading={trader.fills.loading}
            error={trader.fills.error}
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
    </div>
  );
}

export default function HLWhaleTracker() {
  // --hl-header-h is the header below as rendered: py-3 (24) + the 28px title line + the
  // 1px border = 46.59px, rounded down so the board's sticky thead tucks under the header
  // by a sub-pixel instead of opening a gap. It lives on <main> because a custom property
  // only inherits downward and the thead is the header's cousin, not its child.
  // Re-measure when the header's padding, type size or border change.
  return (
    <main className="min-h-screen bg-background [--hl-header-h:46px]">
      {/* Header. Opaque, and no backdrop-blur: the board's rows now scroll under it and
          a 95% fill let them ghost through; a full-width backdrop-filter re-rasterises
          on every scroll frame, and later phases put a live canvas underneath it.
          Three-column grid so the title is optically centred at every width
          rather than balanced against a fixed-width spacer. */}
      <header className="sticky top-0 z-50 border-b border-border bg-background">
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
