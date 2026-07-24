"use client";

import { useState, useEffect, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import VisitorIntel from "./VisitorIntel";
import MagneticButton from "./MagneticButton";
import SplitFlap from "./SplitFlap";

// ============================================================================
// HeroAnimations — the two-column hero: identity (left) + visitor intel (right)
// ============================================================================

export default function HeroAnimations({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 md:items-center gap-x-10 gap-y-8 md:gap-y-10">
      {/* ================= LEFT — identity ================= */}
      <div className="md:col-span-7 space-y-5 md:space-y-6 pointer-events-none">
        {/* Name — the dominant statement (static server HTML, LCP element) */}
        {children}

        {/* Role — a lifelike split-flap board cycling the roles */}
        <div className="min-h-[1.6rem] md:min-h-[2.9rem]">
          {mounted && <SplitFlap />}
        </div>
      </div>

      {/* ================= RIGHT — visitor intel rail ================= */}
      {/* The CARD centers on the name; the CTA hangs just below it on desktop (absolute, so
          it doesn't drag the card's centering up) and stacks normally on mobile. */}
      <div className="md:col-span-5 pointer-events-auto">
        <div className="relative mx-auto w-full max-w-sm md:mx-0 md:max-w-none">
          <VisitorIntel />
          <div className="mt-4 md:absolute md:inset-x-0 md:top-full md:mt-4">
            <MagneticButton
              href="#connect"
              className="group inline-flex items-center gap-3 rounded-full border border-border/70 bg-card/30 py-2 pl-5 pr-2 backdrop-blur-md transition-colors hover:border-foreground/30 hover:bg-card/50"
            >
              <span className="text-sm font-medium tracking-tight text-foreground">
                Get in touch
              </span>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-45">
                <ArrowUpRight size={16} />
              </span>
            </MagneticButton>
          </div>
        </div>
      </div>
    </div>
  );
}
