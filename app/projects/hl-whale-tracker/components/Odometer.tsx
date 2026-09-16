"use client";

import { useEffect, useState } from "react";
import { useSurfaceTier } from "../hooks/useSurfaceTier";

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

// NOTE, not a defect to fix here: a period switch profiles as one ~56 ms long task, and
// it is React MOUNTING forty-nine rows each containing one of these — eleven digit
// columns of ten cells is ~110 spans per figure — not the commit engine, whose measured
// share of that task is 1.3 ms. It predates the engine and it is the cost of the drum
// being real DOM rather than a canvas, which is what lets it inherit the board's type,
// tabular numerals and theme tokens. Recorded so the next profile does not read the
// engine's 1.3 ms as the thing to optimise.
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export interface OdometerCell {
  /** Distance from the RIGHT end, so it survives a change of length. Always negative. */
  key: number;
  ch: string;
  /** Digits roll on a strip; every other character is a static span. */
  digit: boolean;
}

/**
 * One cell per character, keyed from the right.
 *
 * The columns used to be keyed by string index, which only holds identity while the
 * figure's LENGTH holds. On "$9.79M" -> "$10.06M" every column after the first was
 * re-keyed to a different character: the index that had held the decimal point now
 * held a digit, so React reused that node and a static '.' span became a digit strip,
 * while the strips either side rolled to whatever character had shifted into their
 * index. The "a figure that falls rolls DOWN" claim above only ever held for
 * same-length updates.
 *
 * From the right, a carry adds a drum on the LEFT and the units, tenths and hundredths
 * keep their identity — which is how a physical odometer behaves. See
 * tests/odometer.test.ts.
 */
export function odometerCells(formatted: string): OdometerCell[] {
  const chars = formatted.split("");
  return chars.map((ch, i) => ({
    key: i - chars.length,
    ch,
    // The gate: only a matched digit reaches the custom property below, so nothing
    // else can travel into a style attribute.
    digit: ch >= "0" && ch <= "9",
  }));
}

export default function Odometer({
  formatted,
  delayMs = 0,
}: {
  /** The already-formatted string, e.g. "+$20.38M". Digits roll; the rest is static. */
  formatted: string;
  /** Stagger for the first-paint roll, so the board fills top-down. */
  delayMs?: number;
}) {
  // THE decision, read at the source. This asked framer-motion's useReducedMotion,
  // which answers one of the surface tier's three questions and knows nothing about a
  // coarse pointer or a sub-sm window — so on a phone or a tablet the entrance state
  // machine still ran (a timer per odometer, fifty per board, plus a re-render each)
  // and only the stylesheet stopped the paint. That CSS gate stays as the backstop it
  // was written to be; this is the component agreeing with it.
  //
  // It also removes the last framer-motion import on this route (perf-bundle-11): the
  // page's own entrance is a CSS keyframe and the re-seat is Web Animations, so this
  // one hook was pulling the animation runtime into the board's chunk for a boolean.
  const rolls = useSurfaceTier() === "commit";

  // The enter roll plays once per mount and is then switched off, so a later value
  // change transitions from where the digit actually is rather than snapping back to
  // zero and rolling up again.
  //
  // `entered` rather than `entering`, because the tier is not knowable on the first
  // render: useSurfaceTier serves the "still" server snapshot through hydration, and
  // initialising state from it would have latched the roll off for good. So the flag
  // records only whether the enter WINDOW has elapsed, and the tier gates the paint
  // every render.
  const [entered, setEntered] = useState(false);
  const entering = rolls && !entered;

  useEffect(() => {
    if (!rolls || entered) return;
    // Longest possible enter = the stagger plus the roll itself.
    const timer = window.setTimeout(() => setEntered(true), delayMs + 900);
    return () => window.clearTimeout(timer);
  }, [rolls, entered, delayMs]);

  return (
    <span className="hl-odo">
      {/* The strips hold "0123456789" once per digit column. Handing that to a screen
          reader would be pure noise, so the accessible value is this single string and
          the visual track below is hidden from assistive tech entirely. */}
      <span className="sr-only">{formatted}</span>

      <span
        aria-hidden
        className="hl-odo-track"
        data-enter={entering ? "true" : undefined}
        style={entering ? { animationDelay: `${delayMs}ms` } : undefined}
      >
        {odometerCells(formatted).map(({ key, ch, digit }) =>
          digit ? (
            <span key={key} className="hl-odo-digit">
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
            <span key={key} className="hl-odo-char">
              {ch}
            </span>
          )
        )}
      </span>
    </span>
  );
}
