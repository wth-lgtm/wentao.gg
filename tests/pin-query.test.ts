import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DIAL_ROW_PX, PIN_MIN, PIN_QUERY, READING_LINE, STAGE_CLEAR, TWO_COLUMN_MIN } from "../app/lib/chapterList";

const css = fs.readFileSync(path.join(import.meta.dirname, "..", "app/chapter.css"), "utf8");

test("PIN_QUERY is the ONE media text: chapter.css's first-paint block is written with exactly it", () => {
  assert.ok(css.includes(`@media ${PIN_QUERY} {`), "the first-paint @media block uses PIN_QUERY verbatim");
  assert.match(PIN_QUERY, new RegExp(`min-width: ${PIN_MIN.width}px`));
  assert.match(PIN_QUERY, new RegExp(`min-height: ${PIN_MIN.height}px`));
  assert.match(PIN_QUERY, /prefers-reduced-motion: no-preference/);
  assert.match(PIN_QUERY, /forced-colors: none/);
});

test("the first-paint pinned rules apply only before the director writes data-mode, and only with motion on", () => {
  const block = css.slice(css.indexOf(`@media ${PIN_QUERY} {`));
  assert.match(block, /html\[data-site-motion="on"\] \.chapter\[data-pin-default\]:not\(\[data-mode\]\)/);
  // after hydration every pinned rule keys on data-mode alone (never on a media query that flips by itself)
  assert.match(css, /\.chapter\[data-mode="pinned"\] \{\s*height: calc\(var\(--chapter-vh\) \* 1vh\);\s*height: calc\(var\(--chapter-vh\) \* 1svh\);/);
});

test("the CSS twins of the engine's constants: the stage's clear band and the reading line", () => {
  assert.ok(css.includes(`padding: ${STAGE_CLEAR.top}px 0 ${STAGE_CLEAR.bottom}px;`));
  assert.ok(css.includes(`top: ${Math.round(READING_LINE * 100)}svh;`));
});

// EVERY first-paint and pin-gate prelude, not only the one written as PIN_QUERY (review round 3): chapter.css restates
// the gate for the two-column and one-column first paints, the flow-fill "not" twins and the jack field's corridor
// gate. Each must be PIN_QUERY itself or one of these variants, BUILT from the engine's constants — so changing
// PIN_MIN or TWO_COLUMN_MIN without the CSS fails here instead of drifting the first paint silently.
const MIN_W = `(min-width: ${PIN_MIN.width}px)`;
const MIN_H = `(min-height: ${PIN_MIN.height}px)`;
const TWO = `(min-width: ${TWO_COLUMN_MIN}px)`;
const ONE = `(max-width: ${TWO_COLUMN_MIN - 0.02}px)`;
const VARIANTS: Record<string, string> = {
  "PIN_QUERY (the first paint)": PIN_QUERY,
  "not PIN_QUERY (a pin-set chapter that will flow)": `not ${PIN_QUERY}`,
  "PIN_QUERY at two columns": PIN_QUERY.replace(MIN_W, TWO),
  "PIN_QUERY at one column (700–1023)": PIN_QUERY.replace(MIN_W, `${MIN_W} and ${ONE}`),
  "the jack field's gate at two columns (the corridor: dials held unseen, the flow reservation)": PIN_QUERY.replace(`${MIN_W} and ${MIN_H}`, `${TWO} and (hover: hover) and (pointer: fine)`),
};

test("every @media prelude that gates on motion is PIN_QUERY or a variant built from PIN_MIN and TWO_COLUMN_MIN", () => {
  const preludes = [...css.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim()).filter((p) => p.includes("prefers-reduced-motion: no-preference"));
  assert.ok(preludes.length >= 6, `found ${preludes.length} gated preludes`);
  const known = new Set(Object.values(VARIANTS));
  for (const p of preludes) assert.ok(known.has(p), `an unheld restatement of the pin gate: @media ${p}`);
  // and every variant is in use (the list is not stale)
  for (const [name, v] of Object.entries(VARIANTS)) assert.ok(preludes.includes(v), `${name} is no longer used`);
});

test("the CSS twins of TWO_COLUMN_MIN and DIAL_ROW_PX", () => {
  // the two-column breakpoint: every min-width / max-width in chapter.css is a site breakpoint, PIN_MIN.width or
  // TWO_COLUMN_MIN, and every max-width is TWO_COLUMN_MIN's one-column side
  const mins = [...css.matchAll(/\(min-width: ([\d.]+)px\)/g)].map((m) => Number(m[1]));
  for (const v of mins) assert.ok([640, 768, PIN_MIN.width, TWO_COLUMN_MIN].includes(v), `min-width ${v}px`);
  assert.ok(mins.filter((v) => v === TWO_COLUMN_MIN).length >= 5, "the two-column rules use TWO_COLUMN_MIN");
  const maxes = [...css.matchAll(/\(max-width: ([\d.]+)px\)/g)].map((m) => Number(m[1]));
  assert.ok(maxes.length >= 3);
  for (const v of maxes) assert.equal(v, TWO_COLUMN_MIN - 0.02, `max-width ${v}px`);
  // the compact dial row: DIAL_ROW_PX is its 72 px min-height + its 16 px gap, pinned and at the first paint
  const rows = css.match(new RegExp(`min-height: ${DIAL_ROW_PX - 16}px`, "g")) ?? [];
  assert.equal(rows.length, 2, "the pinned compact row and its first-paint twin");
});
