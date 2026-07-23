"use client";

import { useEffect, useState } from "react";

// 1st / 2nd / 3rd / 4th … with the 11–13 special case.
function ordinalSuffix(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return n.toLocaleString() + suffix;
}

// Prominent hero welcome: "You're the 1,234th visitor". Posts once on mount; the server
// assigns/returns the visitor's own number (deduped by cookie). Renders nothing until a
// real number arrives, so there's no placeholder flash and nothing shows if unconfigured.
export default function VisitorPrompt() {
  const [ordinal, setOrdinal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/visit", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && typeof d?.ordinal === "number") setOrdinal(d.ordinal);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (ordinal === null) return null;

  return (
    <div className="mb-2 text-sm text-foreground/80 text-legible">
      <span className="text-muted/60">✦</span> You&apos;re the{" "}
      <span className="text-accent font-semibold tabular-nums">{ordinalSuffix(ordinal)}</span> visitor
    </div>
  );
}
