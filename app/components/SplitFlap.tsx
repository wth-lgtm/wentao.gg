"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

// A lifelike Solari / airport split-flap board that cycles through roles. Each cell riffles
// FORWARD through the charset (blank + A–Z) one physical flap at a time to its target — real
// drums can't reverse, so this rifles through every intermediate letter (no direct swap).
// Stepping is driven by a TIMER (the source of truth — it can't get stuck), staggered per
// column so the change ripples left-to-right; the CSS keyframe flip is purely the visual and
// replays each step via a keyed remount. framer-motion is used only for the emoji crossfade
// + reduced motion. See `.split-flap` in app/globals.css for the 4-layer flap mechanics.

const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // blank ("home") then A–Z
const NC = CHARSET.length;

function idxOf(c: string): number {
  const i = CHARSET.indexOf(c.toUpperCase());
  return i === -1 ? 0 : i;
}
function stepToward(cur: string, target: string): string {
  const c = idxOf(cur);
  const t = idxOf(target);
  return c === t ? cur : CHARSET[(c + 1) % NC];
}

const ROLES = [
  { emoji: "⚙️", word: "ENGINEER" },
  { emoji: "💻", word: "DEVELOPER" },
  { emoji: "📷", word: "PHOTOGRAPHER" },
  { emoji: "🏋️", word: "POWERLIFTER" },
];

const HOLD_MS = 4000; // dwell on a finished word before flipping to the next
const FLAP_MS = 120; // one physical flap — deliberately unhurried so the flip is legible

type Cell = { display: string; prev: string; step: number };

// One cell. A timer advances `display` one flap toward `target` every FLAP_MS. All cells
// start together (no per-column ripple), so the whole word resolves at once. Each advance
// bumps `step`, which re-keys the leaves so the CSS flip animation replays; the animation's
// end state already shows `display`, so a settled cell reads correctly with no cleanup.
function FlapCell({ target }: { target: string }) {
  const reduce = useReducedMotion() ?? false;
  const [c, setC] = useState<Cell>({ display: " ", prev: " ", step: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (reduce) {
      setC((s) => ({ display: target, prev: target, step: s.step }));
      return;
    }
    const interval = setInterval(() => {
      setC((s) =>
        s.display === targetRef.current
          ? s // settled — no-op (React bails out on same reference)
          : { display: stepToward(s.display, targetRef.current), prev: s.display, step: s.step + 1 }
      );
    }, FLAP_MS);
    return () => clearInterval(interval);
  }, [target, reduce]);

  if (reduce) {
    return (
      <div className="sf-cell">
        <div className="sf-flat">
          <span className="sf-glyph">{c.display}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sf-cell">
      {/* static layers: incoming (top) + outgoing (bottom) */}
      <div className="sf-half sf-top">
        <span className="sf-glyph">{c.display}</span>
      </div>
      <div className="sf-half sf-bottom">
        <span className="sf-glyph">{c.prev}</span>
      </div>
      {/* hinged leaves — re-keyed per step so the flip replays each flap */}
      <div key={`t${c.step}`} className="sf-leaf sf-top">
        <span className="sf-glyph">{c.prev}</span>
      </div>
      <div key={`b${c.step}`} className="sf-leaf sf-bottom">
        <span className="sf-glyph">{c.display}</span>
      </div>
    </div>
  );
}

export default function SplitFlap() {
  const reduce = useReducedMotion() ?? false;
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % ROLES.length), HOLD_MS);
    return () => clearInterval(t);
  }, []);

  const role = ROLES[i];
  const chars = role.word.split(""); // exact width — no blank padding, no empty cells

  return (
    <div className="split-flap flex items-center gap-3">
      <AnimatePresence mode="wait">
        <motion.span
          key={role.emoji}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="text-[length:var(--sf-emoji)] leading-none shrink-0"
        >
          {role.emoji}
        </motion.span>
      </AnimatePresence>

      <div className="sf-board" aria-hidden="true">
        {chars.map((ch, col) => (
          <FlapCell key={col} target={ch} />
        ))}
      </div>

      <span className="sr-only" aria-live="polite">
        {role.word}
      </span>
    </div>
  );
}
