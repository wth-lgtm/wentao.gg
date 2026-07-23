"use client";

import { useState, useEffect } from "react";

// Ambient hero metadata — owner's location + live local time, editorial corner detail.
export default function HeroMeta() {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          timeZone: "America/Los_Angeles",
          hour: "numeric",
          minute: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted/70 text-legible">
      <span>San Francisco</span>
      <span className="h-px w-5 bg-border" />
      <span className="tabular-nums">{clock || "—"}</span>
    </div>
  );
}
