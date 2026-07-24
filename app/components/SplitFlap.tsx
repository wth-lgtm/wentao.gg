"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

// A lifelike Solari / airport-departure split-flap board that cycles through a set of roles.
// Each character cell riffles FORWARD through the charset (blank + A–Z) one physical flap at
// a time until it lands on its target — never a direct swap, never reversing (real drums
// can't). The board hands each column its target on a per-column stagger so the change
// ripples left-to-right like real hardware. The flap itself is pure CSS keyframes (on the
// compositor); framer-motion is used only for the leading-emoji crossfade + reduced motion.
// See app/globals.css `.split-flap` for the 4-layer flap mechanics.

const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // blank (drum "home") then A–Z
const N = CHARSET.length;

function idxOf(c: string): number {
  const i = CHARSET.indexOf(c.toUpperCase());
  return i === -1 ? 0 : i; // unknown → blank
}
// One FORWARD hop toward the target, wrapping at the end of the drum.
function stepToward(cur: string, target: string): string {
  const c = idxOf(cur);
  const t = idxOf(target);
  return c === t ? cur : CHARSET[(c + 1) % N];
}

const ROLES = [
  { emoji: "⚙️", word: "ENGINEER" }, // ⚙️
  { emoji: "💻", word: "DEVELOPER" }, // 💻
  { emoji: "📷", word: "PHOTOGRAPHER" }, // 📷
  { emoji: "🏋️", word: "POWERLIFTER" }, // 🏋️
];

const WIDTH = 12; // fixed board width = "PHOTOGRAPHER"; shorter words pad with blank flaps
const HOLD_MS = 3400; // dwell on a finished word before flipping to the next
const STAGGER_MS = 45; // per-column ripple

const pad = (w: string) => w.padEnd(WIDTH, " ").slice(0, WIDTH);

// One split-flap cell. Given a target char it self-paces toward it, chaining each hop on the
// bottom leaf's "dropIn" animationend (the animation is the clock — no timer drift).
function FlapCell({ target }: { target: string }) {
  const reduce = useReducedMotion() ?? false;
  const [display, setDisplay] = useState(" "); // settled char (= the PREVIOUS char mid-flip)
  const [flipping, setFlipping] = useState(false);
  const next = flipping ? stepToward(display, target) : display;

  useEffect(() => {
    if (reduce) {
      setDisplay(target);
      setFlipping(false);
      return;
    }
    if (display !== target && !flipping) setFlipping(true); // arm the next hop
  }, [display, target, flipping, reduce]);

  const onEnd = (e: React.AnimationEvent) => {
    if (e.animationName !== "sfDrop") return; // bottom leaf (sfDrop) finishes last
    setDisplay(stepToward(display, target));
    setFlipping(false);
  };

  return (
    <div className={`sf-cell${flipping ? " flipping" : ""}`}>
      <div className="sf-half sf-top">
        <span className="sf-glyph">{next}</span>
      </div>
      <div className="sf-half sf-bottom">
        <span className="sf-glyph">{display}</span>
      </div>
      <div className="sf-leaf sf-top">
        <span className="sf-glyph">{display}</span>
      </div>
      <div className="sf-leaf sf-bottom" onAnimationEnd={onEnd}>
        <span className="sf-glyph">{next}</span>
      </div>
    </div>
  );
}

export default function SplitFlap() {
  const reduce = useReducedMotion() ?? false;
  const [i, setI] = useState(0);
  const [targets, setTargets] = useState<string[]>(() => pad(ROLES[0].word).split(""));

  // Cycle the roles.
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % ROLES.length), HOLD_MS);
    return () => clearInterval(t);
  }, []);

  // Hand each column its new target on a left-to-right stagger (the ripple lives here).
  useEffect(() => {
    const chars = pad(ROLES[i].word).split("");
    if (reduce) {
      setTargets(chars);
      return;
    }
    const timers = chars.map((c, col) =>
      setTimeout(() => {
        setTargets((prev) => {
          const nextT = [...prev];
          nextT[col] = c;
          return nextT;
        });
      }, col * STAGGER_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [i, reduce]);

  return (
    <div className="split-flap flex items-center gap-3">
      <AnimatePresence mode="wait">
        <motion.span
          key={ROLES[i].emoji}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="text-[length:var(--sf-emoji)] leading-none shrink-0"
        >
          {ROLES[i].emoji}
        </motion.span>
      </AnimatePresence>

      <div className="sf-board" aria-hidden="true">
        {targets.map((t, col) => (
          <FlapCell key={col} target={t} />
        ))}
      </div>

      {/* Announce the finished word (not every flap) to assistive tech. */}
      <span className="sr-only" aria-live="polite">
        {ROLES[i].word}
      </span>
    </div>
  );
}
