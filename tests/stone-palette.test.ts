import { test } from "node:test";
import assert from "node:assert/strict";

import { RAMP, SHARES, isDarkTheme, luminance, stoneCasting, stonePalette, type StoneTokens } from "../app/lib/stonePalette";

// globals.css: the two token sets the palette is computed from
const DARK: StoneTokens = { background: "#0a0a0b", card: "#18181b", foreground: "#e8e8e2", accent: "#3b82f6" };
const LIGHT: StoneTokens = { background: "#ffffff", card: "#f4f4f5", foreground: "#0a0a0b", accent: "#2563eb" };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (hex: string, want: number[], tol = 1) => rgb(hex).every((v, i) => Math.abs(v - want[i]) <= tol);
const lerp = (a: string, b: string, t: number) => rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t);

test("the theme is read off the tokens: the page darker than its text is dark", () => {
  assert.equal(isDarkTheme(DARK), true);
  assert.equal(isDarkTheme(LIGHT), false);
  assert.ok(luminance("#ffffff") > 0.99 && luminance("#000000") === 0);
});

test("dark: four neutrals at 7/13/22/34% of --card → --foreground (the brief's target hexes, not its 12–48% which reach body-text grey) and the accent 45% into --card", () => {
  const p = stonePalette(DARK);
  assert.equal(p.length, 5);
  RAMP.DARK.forEach((t, i) => assert.ok(near(p[i].color, lerp(DARK.card, DARK.foreground, t)), `neutral ${i + 1} ${p[i].color}`));
  assert.ok(near(p[0].color, rgb("#272729")) && near(p[1].color, rgb("#333335")) && near(p[2].color, rgb("#464647")) && near(p[3].color, rgb("#5f5f5f")), p.map((r) => r.color).join(" "));
  assert.ok(near(p[4].color, lerp(DARK.card, DARK.accent, RAMP.ACCENT_MIX)) && near(p[4].color, rgb("#28487e")), p[4].color);
  // a step or two off the page: every neutral darker than --muted #8b8b94 (body text), lighter than --card
  p.slice(0, 4).forEach((r) => assert.ok(luminance(r.color) < luminance("#8b8b94") && luminance(r.color) > luminance(DARK.card), r.color));
});

test("light: 10/20/32/46% of --card → --foreground (its own target hexes) and the accent 45% into --card", () => {
  const p = stonePalette(LIGHT);
  RAMP.LIGHT.forEach((t, i) => assert.ok(near(p[i].color, lerp(LIGHT.card, LIGHT.foreground, t)), `neutral ${i + 1} ${p[i].color}`));
  assert.ok(near(p[0].color, rgb("#dddddd"), 2) && near(p[1].color, rgb("#c5c5c6"), 2) && near(p[2].color, rgb("#a9a9aa"), 2) && near(p[3].color, rgb("#888889"), 2), p.map((r) => r.color).join(" "));
  assert.ok(near(p[4].color, rgb("#97b3f0"), 2), p[4].color);
  p.slice(0, 4).forEach((r) => assert.ok(luminance(r.color) < luminance(LIGHT.card), r.color));
});

test("matte everywhere: roughness 0.78–0.9 by family, the accent 0.8; nothing else about a recipe", () => {
  for (const tokens of [DARK, LIGHT]) {
    const p = stonePalette(tokens);
    assert.deepEqual(p.map((r) => r.roughness), [...RAMP.ROUGHNESS, RAMP.ACCENT_ROUGHNESS]);
    p.forEach((r) => { assert.ok(r.roughness >= 0.78 && r.roughness <= 0.9); assert.deepEqual(Object.keys(r).sort(), ["color", "roughness"]); });
  }
});

test("casting: sixteen shares 3/4/4/3/2 shuffled once by the seed, ten a prefix of them, deterministic", () => {
  assert.equal(SHARES.length, 16);
  const c16 = stoneCasting(16, 17);
  const counts = [0, 1, 2, 3, 4].map((f) => c16.filter((x) => x === f).length);
  assert.deepEqual(counts, [3, 4, 4, 3, 2]);
  assert.notDeepEqual(c16, [...SHARES], "it is shuffled");
  assert.deepEqual(stoneCasting(10, 17), c16.slice(0, 10));
  assert.deepEqual(stoneCasting(16, 17), c16);
  assert.notDeepEqual(stoneCasting(16, 9), c16, "another seed, another order");
});
