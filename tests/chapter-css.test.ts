import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Regression guards for the reading chapters' CSS and markup contracts that no pure module holds (fix round 1 of
// PR 1): one mark per entry, marks that take no clicks, type a visitor's font size reaches, titles sized to their
// column, print as the static still. The browser-level proofs are verify-motion's checks; these hold the source.

const root = path.join(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(root, "app/chapter.css"), "utf8");
const chapterTsx = fs.readFileSync(path.join(root, "app/components/chapter/Chapter.tsx"), "utf8");

/** the declarations of the first rule whose selector text is exactly `selector` */
function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `no rule for ${selector}`);
  return css.slice(i, css.indexOf("}", i));
}

test("one mark per entry: every-entry-one-beat chapters say data-grain=\"entry\" and draw one tint and one bar, no tick", () => {
  assert.match(chapterTsx, /layout\.every\(\(n\) => n === 1\)/);
  assert.match(chapterTsx, /data-grain=\{entryGrain \? "entry" : undefined\}/);
  assert.match(css, /\.chapter\[data-grain="entry"\] \.ch-tick \{ display: none; \}/);
  assert.match(css, /\.chapter\[data-grain="entry"\]\[data-mode\] \.ch-head::before,\s*\.chapter\[data-grain="entry"\]\[data-mode\] \.ch-head::after,\s*\.chapter\[data-grain="entry"\]\[data-mode\] \.ch-sub::before \{ content: none; \}/);
  const tint = rule(`.chapter[data-grain="entry"]:is([data-mode="pinned"], [data-mode="flow"]) .ch-item::before`);
  assert.match(tint, /background: var\(--chapter-tint\)/);
  assert.match(tint, /opacity: 0/);
  const bar = rule(`.chapter[data-grain="entry"]:is([data-mode="pinned"], [data-mode="flow"]) .ch-item::after`);
  assert.match(bar, /transform: scaleY\(0\)/);
  assert.match(bar, /background: var\(--accent\)/);
});

test("the marks take no clicks: every decorative pseudo-element is pointer-events: none", () => {
  assert.match(css, /\.chapter \.ch-head::before, \.chapter \.ch-head::after, \.chapter \.ch-sub::before \{ pointer-events: none; \}/);
  for (const sel of [`.chapter[data-grain="entry"]:is([data-mode="pinned"], [data-mode="flow"]) .ch-item::before`, `.chapter[data-grain="entry"]:is([data-mode="pinned"], [data-mode="flow"]) .ch-item::after`]) {
    assert.match(rule(sel), /pointer-events: none/, sel);
  }
});

test("the list's type is rem (a visitor's default font size reaches it) and capped as it grows with the window", () => {
  for (const sel of [".ch-name", ".ch-role", ".ch-line", ".ch-index"]) {
    const r = rule(`  ${sel}`);
    const size = /font-size: ([^;]+);/.exec(r)?.[1] ?? "";
    assert.match(size, /^clamp\([\d.]+rem, [\d.]+vw, [\d.]+rem\)$/, `${sel} font-size ${size}`);
  }
});

test("display titles are capped by their column (cqi) and may wrap rather than overlap the panel", () => {
  assert.match(css, /\.ch-dial \{ container-type: inline-size; \}/);
  const t = rule("  .ch-title-text");
  assert.match(t, /font-size: min\(clamp\(2\.5rem, min\(9vw, 11svh\), 4\.5rem\), 19cqi\)/);
  assert.match(t, /overflow-wrap: anywhere/);
});

test("one title scale per window: the title's size keys on the window alone, never on a chapter's mode", () => {
  // Experience (pinned) and Education (flow) sit side by side on every desktop and tablet; a mode-keyed size gave
  // the lesser chapter the bigger title. Every rule that sizes the title is a bare .ch-title-text rule.
  const sizing = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*font-size:[^{}]*\}/g)].map((m) => m[1].trim()).filter((sel) => sel.includes("ch-title-text"));
  assert.ok(sizing.length >= 3, "the < 700, 700–1023 and ≥ 1024 sizes");
  for (const sel of sizing) assert.equal(sel, ".ch-title-text", `a title size keyed on more than the window: ${sel}`);
  // the 700–1023 size meets the ≥ 1024 size at the boundary: 5vw of 1023 px and 4.4vw of 1024 px both clamp to 3rem
  assert.ok(css.includes("font-size: min(clamp(2.25rem, 5vw, 3rem), 19cqi);"));
  assert.ok(css.includes("font-size: min(clamp(3rem, min(4.4vw, 8svh), 4rem), 19cqi);"));
});

test("the entries' <ol> keeps list semantics in WebKit (role=\"list\")", () => {
  assert.match(chapterTsx, /<ol className="ch-list" role="list">/);
});

test("print is the static still: the print block neutralises the marks in every mode", () => {
  const p = css.slice(css.indexOf("@media print {"));
  for (const want of [".chapter .ch-sub { color: var(--legend) !important; }", ".chapter .ch-tick { background: var(--border) !important; }", ".chapter .yw-window { display: none !important; }", ".chapter .yw-range { display: inline !important; }", ".chapter .ch-item::before, .chapter .ch-item::after { display: none !important; }"]) {
    assert.ok(p.includes(want), `print block lacks ${want}`);
  }
});
