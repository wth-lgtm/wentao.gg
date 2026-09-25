import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PIN_MIN, PIN_QUERY, READING_LINE, STAGE_CLEAR } from "../app/lib/chapterList";

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
