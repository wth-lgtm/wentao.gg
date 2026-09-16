// How a piece looks, apart from its shape: the day-level shade it carries and the small
// per-piece variation that keeps 192 identical commits from reading as one extruded mass.
// Pure sRGB arithmetic (no three.js) so the ramp can be tested against the heatmap's own
// color-mix and the jitter's bounds asserted; the canvas converts at the edge.

import { rand } from "./commitPile";

export type Rgb = [number, number, number];

/** #rrggbb → sRGB components in 0..1. Anything else (an unread token) yields black. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The heatmap's LEVELS: `color-mix(in srgb, accent KEEP%, card)` — the same numbers, the
 *  same colour space, so a level-4 piece's albedo IS the level-4 cell's colour. (The old
 *  pile lerped in linear light, which is why its light-theme rest pieces were periwinkle
 *  foam next to the board's cells.) */
export const KEEP = [0.18, 0.45, 0.64, 0.82, 1] as const;

export function shadeFor(level: number, accentHex: string, cardHex: string): Rgb {
  const a = hexToRgb(accentHex);
  const c = hexToRgb(cardHex);
  const keep = KEEP[Math.max(0, Math.min(4, level))];
  return [c[0] + keep * (a[0] - c[0]), c[1] + keep * (a[1] - c[1]), c[2] + keep * (a[2] - c[2])];
}

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-12) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [clamp(r + m), clamp(g + m), clamp(b + m)];
}

/** Per-piece jitter: ±8% lightness (relative) and ±4° hue. ±5% on a luminance-0.24 blue is
 *  below the visible threshold in the dark theme; saturation is left alone so the ramp's
 *  level reading survives. Deterministic from the piece index, so a re-render, a theme flip
 *  or a hydration never re-rolls a piece's colour. */
export const JITTER = { lightness: 0.08, hueDeg: 4 } as const;

export function jitterShade(base: Rgb, i: number): Rgb {
  const [h, s, l] = rgbToHsl(base);
  const dh = (rand(i, 41) * 2 - 1) * JITTER.hueDeg;
  const dl = (rand(i, 43) * 2 - 1) * JITTER.lightness;
  return hslToRgb([h + dh, s, Math.min(1, Math.max(0, l * (1 + dl)))]);
}

/** Three finishes, one draw: matte / satin / glazed roughness, hashed per piece. The
 *  clearcoat is shared; only the base roughness differs, so the env's sheen breaks up piece
 *  to piece instead of tiling identically across a family. */
export const ROUGHNESS = [0.62, 0.45, 0.35] as const;

export function roughnessFor(i: number): number {
  const r = rand(i, 31);
  return ROUGHNESS[r < 1 / 3 ? 0 : r < 2 / 3 ? 1 : 2];
}
