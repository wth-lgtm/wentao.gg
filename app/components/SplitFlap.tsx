"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

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
const EMOJIS = ROLES.map((r) => r.emoji);

const HOLD_MS = 4000; // dwell on a finished word before flipping to the next
const FLAP_MS = 100; // one physical flap — legible but a touch quicker to settle

type Cell = { display: string; prev: string; step: number };

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
      <div key={`b${cell.step}`} className="sf-leaf sf-bottom">
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

  // Refs so the riffle effect can read the current state without re-running on each tick.
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const emojiRef = useRef(emojiCell);
  emojiRef.current = emojiCell;

  // Cycle the roles.
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % ROLES.length), HOLD_MS);
    return () => clearInterval(t);
  }, []);

  // Run the riffle to the current role. One clock; stops after `maxSteps` so the emoji and
  // the slowest letter land together.
  useEffect(() => {
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
    const startEmoji = emojiRef.current;

    if (reduce) {
      setCells(targetWord.map((ch) => ({ display: ch, prev: ch, step: 0 })));
      setEmojiCell((e) => ({ display: targetEmoji, prev: targetEmoji, step: e.step }));
      return;
    }

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
          return { display: stepToward(cell.display, t), prev: cell.display, step: cell.step + 1 };
        })
      );
      setEmojiCell((e) => {
        const nextEmoji =
          step >= maxSteps
            ? targetEmoji // land on the correct emoji exactly as the last letter lands
            : EMOJIS[(EMOJIS.indexOf(e.display) + 1) % EMOJIS.length];
        return nextEmoji === e.display
          ? e
          : { display: nextEmoji, prev: e.display, step: e.step + 1 };
      });
      if (step >= maxSteps) clearInterval(id);
    }, FLAP_MS);

    return () => clearInterval(id);
  }, [i, reduce]);

  return (
    <div className="split-flap">
      <div className="sf-board" aria-hidden="true">
        <FlapCell cell={emojiCell} emoji />
        {cells.map((c, k) => (
          <FlapCell key={k} cell={c} />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {ROLES[i].word}
      </span>
    </div>
  );
}
