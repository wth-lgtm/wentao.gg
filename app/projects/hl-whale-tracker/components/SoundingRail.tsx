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

/**
 * Isolated so its once-a-second tick re-renders four characters instead of the
 * whole page. aria-live is explicitly off: a clock inside a live region would
 * interrupt a screen reader every second, forever.
 */
function SnapshotAge({ since }: { since: number | null }) {
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

  const label =
    seconds === null
      ? "--:--"
      : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <span className="tabular-nums" aria-live="off">
      {label}
    </span>
  );
}

function Divider() {
  // A 1px element, not a "·" character: a middot inherits the text baseline and
  // sits at a different optical height in every font size on the rail.
  return <span aria-hidden className="h-3 w-px shrink-0 bg-border" />;
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
    <div className={`flex items-baseline gap-1.5 whitespace-nowrap ${className}`}>
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
      <Divider />
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
      <Divider />
      <Field label="SURFACED" gloss="rows shown here">
        <span className="tabular-nums">{surfaced}</span>
      </Field>
      <Divider />
      <Field label="WINDOW">{WINDOW_LABEL[period]}</Field>
      <Divider />
      <Field label="SNAPSHOT" gloss="time since this data was fetched">
        <SnapshotAge since={updatedAt} />
      </Field>
      <Divider />
      <Field label="TTL" gloss="seconds this snapshot is cached for" className="hidden sm:flex">
        <span className="tabular-nums">{ttlSeconds === null ? "—" : `${ttlSeconds}s`}</span>
      </Field>
      <Divider />
      <Field label="SRC" className="hidden md:flex">
        {UPSTREAM_HOST}
      </Field>
    </dl>
  );
}
