"use client";

import { useEffect, useState } from "react";
import { TimePeriod } from "../lib/types";
import { UPSTREAM_HOST } from "../lib/config";

// Replaces the banner that used to sit here reading "Still tuning the API
// integration" in bg-red-500/10 error styling — a demo announcing itself as
// broken, in the colour reserved for failure.
//
// Every value on this rail traces to something already in memory. Nothing is
// invented: rows scanned is the real upstream row count, TTL is the real
// s-maxage on our own route, and the age counts real seconds since the snapshot.
// The status word is IDLE or FETCHING, never "POLL" — there is no poller, and
// naming one would invent machinery.

const WINDOW_LABEL: Record<TimePeriod, string> = {
  "1d": "24H",
  "7d": "7D",
  "30d": "30D",
  allTime: "ALL",
};

// Mirrors SWR_S in app/api/hl-leaderboard/route.ts, the
// `stale-while-revalidate` on our own Cache-Control. Duplicated rather than imported
// because Next's route type plugin rejects any non-handler export from a route file —
// the same reason TTL_S already lives in lib/config.ts. Until the TTL passes, the
// snapshot is current; for SWR_S after that the CDN is still contracted to serve it
// while it revalidates. Only past TTL + SWR is nothing guaranteeing the reading, which
// is the first moment the rail can honestly call it stale.
const SWR_SECONDS = 900;

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
function SnapshotAge({ since, ttlSeconds }: { since: number | null; ttlSeconds: number | null }) {
  // Elapsed SECONDS live in state; the label is pure formatting. Two things are
  // deliberately avoided here, both of which React 19's lint catches and both of
  // which are real violations rather than noise:
  //   - reading Date.now() during render (impure), and
  //   - calling setState synchronously in the effect body (cascading render).
  // So the first sample is deferred by one frame — imperceptible, and it means the
  // placeholder is what the server renders.
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (since === null) {
      return;
    }
    const sample = () => setSeconds(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    const frame = requestAnimationFrame(sample);
    const id = setInterval(sample, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, [since]);

  const label = seconds === null ? "--:--" : formatAge(seconds);

  // Only claimable when the TTL is known: with ttlSeconds === null there is no window
  // to be outside of, and a guessed staleness is worse than none.
  const stale = seconds !== null && ttlSeconds !== null && seconds > ttlSeconds + SWR_SECONDS;

  return (
    <span className="inline-flex items-baseline gap-1.5" aria-live="off">
      <span className={`tabular-nums ${stale ? "text-[var(--legend)]" : ""}`}>{label}</span>
      {/* Not a colour swap alone — the rail's own sign convention is that a state is
          always carried by something you can read. Nothing here auto-refetches: the
          route serves the same CDN snapshot until it revalidates, so REFRESH is the
          action and this is the invitation. */}
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
  rowsSeen,
  surfaced,
  period,
  updatedAt,
  ttlSeconds,
}: {
  refreshing: boolean;
  rowsSeen: number | null;
  surfaced: number;
  period: TimePeriod;
  updatedAt: number | null;
  ttlSeconds: number | null;
}) {
  return (
    <dl
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]"
      style={{ borderTopColor: "var(--engrave-hi)" }}
    >
      <Field label="STATE">
        <span className={refreshing ? "text-accent" : "text-foreground/85"}>
          {refreshing ? "FETCHING" : "IDLE"}
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
        <SnapshotAge since={updatedAt} ttlSeconds={ttlSeconds} />
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
