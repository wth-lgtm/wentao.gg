"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import LocatorMap from "./LocatorMap";
import ScrambleText from "./ScrambleText";
import { getVisitorData, type VisitorData } from "./visitorData";

// The "visitor intel" rail card: a dotted world map that zooms to the visitor's own
// coordinates, their own IP (the surprise), their city, and the live visit counter — one
// tangible console object. All of it is the visitor's OWN data echoed back client-side;
// only the anonymous counter touches the DB.
export default function VisitorIntel() {
  const reduce = useReducedMotion() ?? false;
  const [data, setData] = useState<VisitorData | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [located, setLocated] = useState(false);

  // Read the visitor cookie (client-only) once mounted.
  useEffect(() => {
    setData(getVisitorData());
  }, []);

  // Count this device once; every load returns the live total (deduped server-side).
  useEffect(() => {
    let alive = true;
    fetch("/api/visit", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && typeof d?.count === "number") setCount(d.count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Flip the header from "LOCATING…" to "WHERE YOU'RE AT" once the zoom has settled.
  const hasFix = data !== null && data.lat !== null && data.lon !== null;
  useEffect(() => {
    if (!hasFix) return;
    if (reduce) {
      setLocated(true);
      return;
    }
    const t = setTimeout(() => setLocated(true), 1500);
    return () => clearTimeout(t);
  }, [hasFix, reduce]);

  // Placeholder before the cookie is read — reserves the card's footprint (no CLS).
  const lat = data?.lat ?? null;
  const lon = data?.lon ?? null;
  const ip = data?.ip ?? "";
  const location = data?.location ?? "";

  const header = !hasFix
    ? "OFF THE GRID"
    : located
      ? "WHERE YOU'RE AT"
      : "LOCATING YOU…";

  const caption = hasFix
    ? "no logs, just vibes \u{1F91D}"
    : "couldn't triangulate you \u{1F6F0}\u{FE0F}";

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 font-mono select-none">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden>{"\u{1F4CD}"}</span>
          <span className="text-legible">{header}</span>
        </span>
        <span aria-hidden className="text-muted/40">
          {"◎"}
        </span>
      </div>

      {/* Dotted world map → zoom to pin */}
      <div className="mb-4 overflow-hidden rounded-xl bg-background/40 ring-1 ring-border/60">
        <LocatorMap lat={lat} lon={lon} />
      </div>

      {/* Readout */}
      <dl className="space-y-2 text-xs">
        <div className="flex items-baseline gap-3">
          <dt className="w-9 shrink-0 text-muted/60">IP</dt>
          <dd className="min-w-0 break-all font-semibold text-accent">
            {ip ? (
              <ScrambleText text={ip} scrambleSpeed={18} revealSpeed={14} />
            ) : (
              <span className="font-normal text-muted/70">hidden {"\u{1F575}\u{FE0F}"}</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="w-9 shrink-0 text-muted/60">CITY</dt>
          <dd className="min-w-0 break-words text-foreground/85">
            {location || "somewhere on the interwebs"}
          </dd>
        </div>
      </dl>

      {/* Divider */}
      <div className="my-3 h-px bg-border/70" />

      {/* Live counter — the fun fact */}
      {count !== null && (
        <p className="text-xs leading-relaxed text-foreground/80">
          <span className="text-accent">{"✦"}</span>{" "}
          <span className="font-semibold tabular-nums text-accent">
            {count.toLocaleString()}
          </span>{" "}
          of you couldn&apos;t resist a peek {"\u{1F440}"}
        </p>
      )}

      {/* Disarming caption */}
      <p className="mt-2 text-[11px] text-muted/60">{caption}</p>
    </div>
  );
}
