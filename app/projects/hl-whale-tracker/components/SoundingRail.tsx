"use client";

import { useEffect, useState } from "react";
import { TimePeriod } from "../lib/types";
import { SWR_S, UPSTREAM_HOST } from "../lib/config";
import type { LeaderboardSnapshot } from "../hooks/useLeaderboard";

// Replaces the banner that used to sit here reading "Still tuning the API
// integration" in bg-red-500/10 error styling — a demo announcing itself as
// broken, in the colour reserved for failure.
//
// Every value on this rail traces to something already in memory. Nothing is
// invented: rows scanned is the real upstream row count, TTL is the real
// s-maxage on our own route, and the age counts real seconds since the snapshot.
// The status word is IDLE, FETCHING or UNCHANGED, never "POLL" — there is still no
// poller (the hook refetches on expiry and on the tab coming forward, not on an
// interval), and naming one would invent machinery.

const WINDOW_LABEL: Record<TimePeriod, string> = {
  "1d": "24H",
  "7d": "7D",
  "30d": "30D",
  allTime: "ALL",
};

// Past an hour the age used to print "60:00", then "125:07" — `Math.floor(s/60)` with
// no hours term, so a tab left open showed a minutes field that had stopped being one.
// H:MM:SS is the tape's own reading (fills.ts formatClock) and it keeps the seconds
// visible, which is the point of a field that ticks.
function formatAge(seconds: number): string {
  const mm = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const hours = Math.floor(seconds / 3600);
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Isolated so its once-a-second tick re-renders four characters instead of the
 * whole page. aria-live is explicitly off: a clock inside a live region would
 * interrupt a screen reader every second, forever.
 */
function SnapshotAge({
  snapshot,
  ttlSeconds,
}: {
  snapshot: LeaderboardSnapshot | null;
  ttlSeconds: number | null;
}) {
  // Elapsed SECONDS live in state; the label is pure formatting. Two things are
  // deliberately avoided here, both of which React 19's lint catches and both of
  // which are real violations rather than noise:
  //   - reading Date.now() during render (impure), and
  //   - calling setState synchronously in the effect body (cascading render).
  // So the first sample is deferred by one frame — imperceptible, and it means the
  // placeholder is what the server renders.
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    // The CDN's own age at the moment the body landed, plus our own elapsed time since
    // — one clock on each side of the subtraction. This used to be
    // `Date.now() - body.updatedAt`, which straddles two clocks: a visitor running
    // three minutes behind the server was shown a fresh 00:00 over a snapshot that was
    // genuinely three minutes old. See LeaderboardSnapshot in useLeaderboard.
    const sample = () =>
      setSeconds(
        Math.max(
          0,
          Math.floor(
            (snapshot.ageAtReceipt + (Date.now() - snapshot.receivedAt)) / 1000
          )
        )
      );
    const frame = requestAnimationFrame(sample);
    const id = setInterval(sample, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, [snapshot]);

  const label = seconds === null ? "--:--" : formatAge(seconds);

  // Only claimable when the TTL is known: with ttlSeconds === null there is no window
  // to be outside of, and a guessed staleness is worse than none.
  const stale = seconds !== null && ttlSeconds !== null && seconds > ttlSeconds + SWR_S;

  return (
    <span className="inline-flex items-baseline gap-1.5" aria-live="off">
      <span className={`tabular-nums ${stale ? "text-[var(--legend)]" : ""}`}>{label}</span>
      {/* Not a colour swap alone — the rail's own sign convention is that a state is
          always carried by something you can read. The hook now refetches once the
          snapshot passes its TTL and whenever the tab comes forward, so this word is no
          longer the page's only invitation — but it is still reachable in the
          foreground, and for a while: a refetch that FAILS leaves this age climbing,
          and the next attempt is a TTL away by design (one request per TTL, whatever
          happened last time). An answer served at the far end of the SWR window lands
          here already at the threshold. So it means "nothing is currently guaranteeing
          this reading", not "nobody is trying". */}
      {stale ? <span className="text-[var(--legend)]">STALE</span> : null}
    </span>
  );
}

function Field({
  label,
  children,
  gloss,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  gloss?: string;
  className?: string;
}) {
  return (
    // The seam between fields is drawn by .hl-rail-field::before, INSIDE the field it
    // precedes, not as a sibling of it. As siblings the six dividers were rendered
    // unconditionally while SCANNED, TTL and SRC are display:none below their
    // breakpoints, so the phone rail read "STATE IDLE |  | SURFACED 50 | WINDOW 7D |
    // AGE 00:26 |  |" — two orphan pairs and a trailing one. A hidden field takes its
    // own pseudo-element with it, so an orphan is now unrepresentable. It also makes
    // the <dl> valid: a bare <span> is not permitted content there (only div/dt/dd).
    <div className={`hl-rail-field flex items-baseline gap-1.5 whitespace-nowrap ${className}`}>
      <dt className="text-[var(--legend)]">
        {label}
        {gloss ? <span className="sr-only"> ({gloss})</span> : null}
      </dt>
      <dd className="text-foreground/85">{children}</dd>
    </div>
  );
}

export default function SoundingRail({
  refreshing,
  unchanged,
  rowsSeen,
  surfaced,
  period,
  snapshot,
  ttlSeconds,
}: {
  refreshing: boolean;
  /** A refresh answered with the body already on screen. Transient — see useLeaderboard. */
  unchanged: boolean;
  rowsSeen: number | null;
  surfaced: number;
  period: TimePeriod;
  snapshot: LeaderboardSnapshot | null;
  ttlSeconds: number | null;
}) {
  return (
    <dl
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]"
      style={{ borderTopColor: "var(--engrave-hi)" }}
    >
      {/* Three readings, and only one of them is activity. A refresh inside the cache
          window is answered by the CDN with the body already on screen, so the spinner
          used to imply work that could not change anything; UNCHANGED is what actually
          happened. It stays foreground rather than accent because it is a result, not
          a state the instrument is in — the word carries it, which is this rail's own
          rule. */}
      <Field label="STATE">
        <span className={refreshing ? "text-accent" : "text-foreground/85"}>
          {refreshing ? "FETCHING" : unchanged ? "UNCHANGED" : "IDLE"}
        </span>
      </Field>
      {/* Scanned is hidden first on narrow screens — it is context, not a reading. */}
      <Field
        label="SCANNED"
        gloss="rows returned by the upstream leaderboard"
        className="hidden sm:flex"
      >
        <span className="tabular-nums">
          {rowsSeen === null ? "—" : rowsSeen.toLocaleString("en-US")}
        </span>
      </Field>
      <Field label="SURFACED" gloss="rows shown here">
        <span className="tabular-nums">{surfaced}</span>
      </Field>
      <Field label="WINDOW">{WINDOW_LABEL[period]}</Field>
      {/* "SNAPSHOT 00:06" read as a clock — the only thing saying otherwise was the
          sr-only gloss. AGE says it on the surface, and on a phone it is the only
          freshness signal at all, since TTL is hidden below sm. */}
      <Field label="AGE" gloss="time since this data was fetched">
        <SnapshotAge snapshot={snapshot} ttlSeconds={ttlSeconds} />
      </Field>
      <Field label="TTL" gloss="seconds this snapshot is cached for" className="hidden sm:flex">
        <span className="tabular-nums">{ttlSeconds === null ? "—" : `${ttlSeconds}s`}</span>
      </Field>
      <Field label="SRC" className="hidden md:flex">
        {UPSTREAM_HOST}
      </Field>
    </dl>
  );
}
