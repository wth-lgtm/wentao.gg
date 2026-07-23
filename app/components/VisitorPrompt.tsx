"use client";

import { useEffect, useState } from "react";

// Prominent hero line: "This page has been visited 1,234 times". Posts once on mount; the
// server counts the device once and returns the live total (deduped by cookie). Renders
// nothing until a real number arrives, so there's no placeholder flash and nothing shows
// if the counter isn't configured.
export default function VisitorPrompt() {
  const [count, setCount] = useState<number | null>(null);

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

  if (count === null) return null;

  return (
    <div className="mb-2 text-sm text-foreground/80 text-legible">
      <span className="text-muted/60">✦</span> This page has been visited{" "}
      <span className="text-accent font-semibold tabular-nums">{count.toLocaleString()}</span> times
    </div>
  );
}
