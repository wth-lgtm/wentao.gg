// The stones' colours are the site's own matte ramp, computed from the theme tokens at mount
// so both themes are first-class by construction: four neutrals lerped from --card toward
// --foreground (in sRGB, as color-mix(in srgb) would — the same space the heatmap's face
// ramp mixes in) plus ONE muted accent, --accent mixed into --card. No glossy family, no
// product palette: the stones are a step or two off the page, texture the eye reads past.
// Pure — the scene reads the tokens and hands them in; every number here runs in node.

import { rand } from "./seed";

export interface StoneTokens {
  background: string;
  card: string;
  foreground: string;
  accent: string;
}

export interface StoneRecipe {
  /** #rrggbb */
  color: string;
  roughness: number;
}

/**
 * Lerp fractions from --card toward --foreground per theme. The light set is the brief's
 * (10/20/32/46% of #f4f4f5 → #0a0a0b compute to #dcdcde #c5c5c6 #a9a9aa #888889, its own
 * target hexes). The brief's DARK fractions were 12/22/34/48%, which of #18181b → #e8e8e2
 * compute to #313130 #464645 #5f5f5e #7c7c7a — the top two at the luminance of --muted
 * (#8b8b94), i.e. body-text grey, content not texture — while its own dark target hexes
 * (#26262a #33333a #45454c #5e5e66) sit at 7/13/22/34% of the same lerp. The targets are what
 * the panel saw; those fractions ship for dark, and the comment is the record.
 */
export const RAMP = {
  DARK: [0.07, 0.13, 0.22, 0.34],
  LIGHT: [0.1, 0.2, 0.32, 0.46],
  /** --accent mixed this far into --card: #3b82f6 → #28487e on dark, #2563eb → #97b3f0 on light */
  ACCENT_MIX: 0.45,
  /** matte everywhere, 0.78–0.9; the darkest neutral roughest, the lightest least, so the lit face reads the same step on each */
  ROUGHNESS: [0.9, 0.86, 0.82, 0.78],
  ACCENT_ROUGHNESS: 0.8,
} as const;

/** the casting's multiset for sixteen: neutral 1 ×3, neutral 2 ×4, neutral 3 ×4, neutral 4 ×3, accent ×2 */
export const SHARES: readonly number[] = [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4];

function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n) || s.length < 6) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** WCAG relative luminance of an sRGB hex, for the theme test only */
export function luminance(hex: string): number {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** dark when the page is darker than its text — the tokens decide, not a class name */
export function isDarkTheme(tokens: StoneTokens): boolean {
  return luminance(tokens.background) < luminance(tokens.foreground);
}

/** The five families in casting order: neutral 1..4 (darkest-to-lightest step off --card), then the muted accent. */
export function stonePalette(tokens: StoneTokens): StoneRecipe[] {
  const card = parseHex(tokens.card), fg = parseHex(tokens.foreground), accent = parseHex(tokens.accent);
  const steps = isDarkTheme(tokens) ? RAMP.DARK : RAMP.LIGHT;
  const out: StoneRecipe[] = steps.map((t, i) => ({ color: toHex(mix(card, fg, t)), roughness: RAMP.ROUGHNESS[i] }));
  out.push({ color: toHex(mix(card, accent, RAMP.ACCENT_MIX)), roughness: RAMP.ACCENT_ROUGHNESS });
  return out;
}

/**
 * Family index per stone: the sixteen shares shuffled once with the seed (Fisher–Yates, the
 * swap partner drawn per position, as the card's casting), and the first `count` of them —
 * so ten stones are a prefix of the sixteen, not a different set. Never data.
 */
export function stoneCasting(count: number, seed: number): number[] {
  const cast = SHARES.slice();
  for (let i = cast.length - 1; i > 0; i--) {
    const j = Math.floor(rand(i, seed) * (i + 1));
    [cast[i], cast[j]] = [cast[j], cast[i]];
  }
  return cast.slice(0, Math.max(0, Math.min(count, cast.length)));
}
