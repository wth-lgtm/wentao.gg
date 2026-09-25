"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { FLAP_MS, HOLD_MS } from "../lib/mechanism";

// A lifelike Solari / airport split-flap board that cycles roles. The leading EMOJI is a
// flap too — it spins through the role emojis and lands on the correct one at the SAME
// instant the word finishes. One central clock drives everything: every FLAP_MS each cell
// riffles FORWARD one card toward its target (real drums can't reverse); the run lasts
// exactly `maxSteps` = the longest letter's distance, so the emoji + the slowest letter
// resolve together. The CSS flip (see `.split-flap` in globals.css) is purely visual and
// replays via a keyed leaf remount each step.

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
const charDist = (c: string, t: string) => (idxOf(t) - idxOf(c) + NC) % NC;

const ROLES = [
  { emoji: "⚙️", word: "ENGINEER" },
  { emoji: "💻", word: "DEVELOPER" },
  { emoji: "📷", word: "PHOTOGRAPHER" },
  { emoji: "🏋️", word: "POWERLIFTER" },
];
// The emoji flap riffles through a big pool for variety (like the 26-letter charset), then
// is forced onto the correct role emoji on the final step.
const EMOJI_POOL = [
  "💻", "⚙️", "📷", "🏋️", "🚀", "🌟", "🎯", "🔧", "🧠", "☕", "🎧", "📈", "🌙",
  "⚡", "🔥", "📸", "💪", "🏔️", "🎨", "🔬", "📊", "🧩", "🎮", "🌐", "💡", "🎸",
];

// HOLD_MS (4000, the dwell on a finished word) and FLAP_MS (100, one physical flap) come from
// app/lib/mechanism.ts: FLAP_MS IS the site's beat, and HOLD_MS is forty of them. Values unchanged.

// `settle` marks the single step on which this cell reaches its target letter — the
// CSS rake holds the light longer on that flap, so a letter arriving and a letter
// glinting are the same event.
type Cell = { display: string; prev: string; step: number; settle?: boolean };

// Presentational flap cell (4-layer). The leaves are re-keyed by `step`, so the flip
// replays each hop; the animation's end state shows the new glyph, so a settled cell reads
// correctly with no cleanup.
function FlapCell({ cell, emoji = false }: { cell: Cell; emoji?: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const cls = `sf-cell${emoji ? " sf-em" : ""}`;
  if (reduce) {
    return (
      <div className={cls}>
        <div className="sf-flat">
          <span className="sf-glyph">{cell.display}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={cls}>
      <div className="sf-half sf-top">
        <span className="sf-glyph">{cell.display}</span>
      </div>
      <div className="sf-half sf-bottom">
        <span className="sf-glyph">{cell.prev}</span>
      </div>
      <div key={`t${cell.step}`} className="sf-leaf sf-top">
        <span className="sf-glyph">{cell.prev}</span>
      </div>
      <div
        key={`b${cell.step}`}
        className="sf-leaf sf-bottom"
        data-settle={cell.settle ? "" : undefined}
      >
        <span className="sf-glyph">{cell.display}</span>
      </div>
    </div>
  );
}

export default function SplitFlap() {
  const reduce = useReducedMotion() ?? false;
  const [i, setI] = useState(0);
  const [cells, setCells] = useState<Cell[]>([]);
  const [emojiCell, setEmojiCell] = useState<Cell>(() => ({
    display: ROLES[0].emoji,
    prev: ROLES[0].emoji,
    step: 0,
  }));

  // Refs so the riffle effect can read the current state without listing it as a
  // dependency — which would tear down and restart the flap interval on every tick.
  //
  // Written from effects, NOT during render. The previous `cellsRef.current = cells`
  // in the render body is unsafe under concurrent rendering and runs twice under
  // StrictMode. These are declared BEFORE the riffle effect on purpose: effects run
  // in declaration order after commit, so on the render where `i` changes these have
  // already synced by the time the riffle reads them.
  const cellsRef = useRef(cells);
  const emojiRef = useRef(emojiCell);
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);
  useEffect(() => {
    emojiRef.current = emojiCell;
  }, [emojiCell]);

  // Cycle the roles.
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % ROLES.length), HOLD_MS);
    return () => clearInterval(t);
  }, []);

  // Run the riffle to the current role. One clock; stops after `maxSteps` so the emoji and
  // the slowest letter land together.
  useEffect(() => {
    // A reduced-motion visitor never riffles, so this effect has nothing to drive and
    // — importantly — writes no state. It used to setCells/setEmojiCell synchronously
    // here, which is a cascading render on mount; the board is now DERIVED for that
    // case below, which is where a pure function of `i` belonged all along.
    if (reduce) return;

    const targetWord = ROLES[i].word.split("");
    const targetEmoji = ROLES[i].emoji;
    const len = targetWord.length;

    const prevCells = cellsRef.current;
    // Start from the current chars, resized to the new word (preserve step → no dummy flip).
    const start: Cell[] = Array.from({ length: len }, (_, k) => {
      const p = prevCells[k];
      const display = p?.display ?? " ";
      return { display, prev: display, step: p?.step ?? 0 };
    });

    const maxSteps = Math.max(1, ...start.map((c, k) => charDist(c.display, targetWord[k])));

    setCells(start);
    setEmojiCell((e) => ({ display: e.display, prev: e.display, step: e.step }));

    let step = 0;
    const id = setInterval(() => {
      step += 1;
      setCells((prev) =>
        prev.map((cell, k) => {
          const t = targetWord[k];
          if (cell.display === t) return cell; // settled — no re-key, no re-flip
          const next = stepToward(cell.display, t);
          return { display: next, prev: cell.display, step: cell.step + 1, settle: next === t };
        })
      );
      setEmojiCell((e) => {
        const nextEmoji =
          step >= maxSteps
            ? targetEmoji // land on the correct emoji exactly as the last letter lands
            : EMOJI_POOL[step % EMOJI_POOL.length]; // riffle through the varied pool
        return nextEmoji === e.display
          ? e
          : { display: nextEmoji, prev: e.display, step: e.step + 1 };
      });
      if (step >= maxSteps) clearInterval(id);
    }, FLAP_MS);

    return () => clearInterval(id);
  }, [i, reduce]);

  // Under reduced motion the board is a pure function of `i` — the current word, no
  // riffle, no intermediate letters — so it is derived here rather than pushed into
  // state by an effect. The riffling path keeps using state, because there the cells
  // are genuinely driven by a clock and cannot be computed from a render.
  const boardCells = reduce
    ? ROLES[i].word.split("").map((ch) => ({ display: ch, prev: ch, step: 0 }))
    : cells;
  const boardEmoji = reduce
    ? { display: ROLES[i].emoji, prev: ROLES[i].emoji, step: 0 }
    : emojiCell;

  return (
    <div className="split-flap">
      <div className="sf-board" aria-hidden="true">
        <FlapCell cell={boardEmoji} emoji />
        {boardCells.map((c, k) => (
          <FlapCell key={k} cell={c} />
        ))}
      </div>
      {/* Stated once, statically. This was an aria-live="polite" region holding the
          CURRENT role, and `i` advances every HOLD_MS forever with no stop control —
          so a screen reader was interrupted with a new word every four seconds for
          as long as the page stayed open. That fails WCAG 2.2.2 (Pause, Stop, Hide).

          The four roles are all true at once and the cycling is decoration, so the
          honest equivalent is the whole set, announced once. It says strictly more
          than the live region did: that only ever read out whichever role the board
          happened to be showing. The board itself is already aria-hidden. */}
      <span className="sr-only">
        {ROLES.map((r) => r.word.charAt(0) + r.word.slice(1).toLowerCase()).join(", ")}
      </span>
    </div>
  );
}
