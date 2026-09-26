"use client";

import { useState, useEffect, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import VisitorIntel from "./VisitorIntel";
import MagneticButton from "./MagneticButton";
import SplitFlap from "./SplitFlap";

// ============================================================================
// HeroAnimations — the two-column hero: identity (left) + visitor intel (right)
// ============================================================================

export default function HeroAnimations({ children, worldMap }: { children: ReactNode; worldMap?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 md:items-center gap-x-10 gap-y-6 md:gap-y-10">
      {/* ================= LEFT — identity ================= */}
      <div className="md:col-span-7 space-y-4 md:space-y-6 pointer-events-none">
        {/* Name — the dominant statement (static server HTML, LCP element) */}
        {children}

        {/* Role — a lifelike split-flap board cycling the roles */}
        <div className="min-h-[1.6rem] md:min-h-[2.9rem]">
          {mounted && <SplitFlap />}
        </div>
      </div>

      {/* ================= RIGHT — visitor intel rail ================= */}
      {/* The CARD centers on the name; the CTA hangs just below it from tablets up (absolute,
          so it doesn't drag the card's centering up) and stacks normally on phones. This is the
          locked hero at scrollY 0 from 768 up: the name centred beside the card, the jacks
          around both. The card fits the 5/12 column (277 px at 768) with its own type row
          (globals.css "VISITOR CARD") rather than re-composing the hero around it.
          data-hero-card is the rect the jack field keeps half-clear while it is on screen
          (JackFieldScene.tsx). Only the card and the button take the pointer (.vcard and the
          button carry pointer-events-auto); the rail and this wrapper pass it through, so the
          empty rail around the card and the strip beside the button stay the fluid's — on a
          phone-width window with a mouse the button's row is inside this wrapper, and a
          pointer-events-auto wrapper caught it there. */}
      <div className="md:col-span-5 pointer-events-none">
        <div data-hero-card className="pointer-events-none relative mx-auto w-full max-w-sm md:mx-0 md:max-w-none">
          <VisitorIntel worldMap={worldMap} />
          {/* The CTA's row spans the card's width but only the button takes the pointer: the
              rest of that strip is empty hero space, and it belongs to the fluid. On laptops the
              button sits at the card's right edge: the card grew with its type (~390 → 530 px),
              which brought a left-aligned button down onto the hero's empty space at 0.75 × 0.85
              of a 1024 × 768 window — the point verify-field clicks for the jacks' burst and
              hit-tests for the fluid. Right-aligned, that space stays the fluid's at every size. */}
          <div className="pointer-events-none mt-4 md:absolute md:inset-x-0 md:top-full md:mt-4 lg:flex lg:justify-end">
            <MagneticButton
              href="#connect"
              className="pointer-events-auto group inline-flex items-center gap-3 rounded-full border border-border/70 bg-card/30 py-2 pl-5 pr-2 backdrop-blur-md transition-colors hover:border-foreground/30 hover:bg-card/50"
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
