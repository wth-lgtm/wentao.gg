import { test } from "node:test";
import assert from "node:assert/strict";

import { ROUGHNESS, hexToRgb, jitterShade, rgbToHsl, roughnessFor, shadeFor } from "../app/lib/pileLook";

test("shadeFor is the heatmap's color-mix ramp in sRGB: level 4 is the accent, level 0 is 18% of it in the card", () => {
  const accent = "#3b82f6";
  const card = "#18181b";
  assert.deepEqual(shadeFor(4, accent, card), hexToRgb(accent));
  const a = hexToRgb(accent);
  const c = hexToRgb(card);
  const l0 = shadeFor(0, accent, card);
  for (let ch = 0; ch < 3; ch++) assert.ok(Math.abs(l0[ch] - (c[ch] + 0.18 * (a[ch] - c[ch]))) < 1e-9);
  // ordered: more accent at every step
  const dist = (rgb: number[]) => Math.hypot(rgb[0] - a[0], rgb[1] - a[1], rgb[2] - a[2]);
  for (let lvl = 0; lvl < 4; lvl++) assert.ok(dist(shadeFor(lvl, accent, card)) > dist(shadeFor(lvl + 1, accent, card)));
});

test("jitterShade stays within ±8% lightness and ±4° hue, keeps saturation, and is deterministic", () => {
  const base = hexToRgb("#3b82f6");
  const [h0, s0, l0] = rgbToHsl(base);
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const j = jitterShade(base, i);
    assert.deepEqual(j, jitterShade(base, i), "same piece, same colour");
    const [h, s, l] = rgbToHsl(j);
    let dh = Math.abs(h - h0);
    if (dh > 180) dh = 360 - dh;
    assert.ok(dh <= 4 + 1e-6, `piece ${i}: hue drift ${dh}`);
    assert.ok(Math.abs(l / l0 - 1) <= 0.08 + 1e-6, `piece ${i}: lightness ${l} vs ${l0}`);
    assert.ok(Math.abs(s - s0) < 1e-6, `piece ${i}: saturation ${s} vs ${s0}`);
    for (const ch of j) assert.ok(ch >= 0 && ch <= 1);
    seen.add(j.map((v) => v.toFixed(4)).join(","));
  }
  assert.ok(seen.size > 900, `${seen.size} distinct shades of 1000`);
});

test("roughnessFor buckets pieces matte / satin / glazed in roughly equal thirds", () => {
  const counts = new Map<number, number>();
  for (let i = 0; i < 3000; i++) {
    const r = roughnessFor(i);
    assert.equal(r, roughnessFor(i));
    assert.ok((ROUGHNESS as readonly number[]).includes(r), `${r}`);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  assert.equal(counts.size, 3);
  for (const n of counts.values()) assert.ok(n > 800 && n < 1200, `${n} of 3000`);
});
