"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

// A digit tumbler for the board's figures.
//
// Every digit is a vertical strip of 0-9 sitting inside a one-character window; the
// only thing that ever changes is a `translate` on that strip. So the whole effect
// runs on CSS transitions with ZERO per-frame JavaScript — which matters at fifty
// rows, where the obvious build (a spring writing formatted text each frame) would
// mean fifty DOM text writes every frame.
//
// It is also the same mechanical language as the SplitFlap board on the homepage:
// a physical drum landing on a glyph rather than a number fading into another.
//
// One deliberate departure from that board. SplitFlap only ever riffles FORWARD,
// because a real Solari drum cannot reverse. A digit here takes the short path in
// whichever direction it needs, so a figure that falls visibly rolls DOWN. For a
// quantity that reads as more honest than a mechanical constraint.

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function Odometer({
  formatted,
  delayMs = 0,
}: {
  /** The already-formatted string, e.g. "+$20.38M". Digits roll; the rest is static. */
  formatted: string;
  /** Stagger for the first-paint roll, so the board fills top-down. */
  delayMs?: number;
}) {
  const reduce = useReducedMotion() ?? false;

  // The enter roll plays once per mount and is then switched off, so a later value
  // change transitions from where the digit actually is rather than snapping back to
  // zero and rolling up again.
  const [entering, setEntering] = useState(!reduce);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!entering) return;
    // Longest possible enter = the stagger plus the roll itself.
    timer.current = window.setTimeout(() => setEntering(false), delayMs + 900);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // Runs once: `entering` starts true and only ever goes false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="hl-odo">
      {/* The strips hold "0123456789" once per digit column. Handing that to a screen
          reader would be pure noise, so the accessible value is this single string and
          the visual track below is hidden from assistive tech entirely. */}
      <span className="sr-only">{formatted}</span>

      <span
        aria-hidden
        className="hl-odo-track"
        data-enter={entering && !reduce ? "true" : undefined}
        style={entering && !reduce ? { animationDelay: `${delayMs}ms` } : undefined}
      >
        {formatted.split("").map((ch, i) =>
          // The regex is the gate: only a matched digit reaches the custom property,
          // so nothing else can travel into a style attribute.
          ch >= "0" && ch <= "9" ? (
            <span key={i} className="hl-odo-digit">
              <span
                className="hl-odo-strip"
                style={{ "--d": ch } as React.CSSProperties}
              >
                {DIGITS.map((d) => (
                  <span key={d} className="hl-odo-cell">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span key={i} className="hl-odo-char">
              {ch}
            </span>
          )
        )}
      </span>
    </span>
  );
}
