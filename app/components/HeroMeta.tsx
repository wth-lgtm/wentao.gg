"use client";

import { useState, useEffect } from "react";

// Ambient chrome metadata — owner's location + live local time. Fixed under the "W." mark
// (top-left) so it's always on the front page regardless of hero height and never collides
// with the fixed bottom footer; fades out once you scroll into the content.
export default function HeroMeta() {
  const [clock, setClock] = useState("");
  const [hidden, setHidden] = useState(false);

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

  useEffect(() => {
    const onScroll = () => setHidden(window.scrollY > 140);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden
      className={`fixed top-[4.5rem] left-0 right-0 z-40 pointer-events-none transition-opacity duration-500 ${
        hidden ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex w-fit items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted text-legible">
          <span>San Francisco</span>
          <span className="h-px w-5 bg-border" />
          <span className="tabular-nums">{clock || "—"}</span>
        </div>
      </div>
    </div>
  );
}
