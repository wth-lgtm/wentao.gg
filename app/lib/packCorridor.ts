// The title corridor (DESIGN §4.2.4, O3): legibility by LAYOUT, not by dimming the jacks. The jack field is a
// fixed layer, so the packs' on-screen boxes are the same at every scroll position; a pinned chapter's dial
// (folio, display title, year wheel) sits in the tallest vertical gap between them inside the dial's x-range —
// at 1440 × 900 between the seven above the name and the fourteen below it, where "02 Experience" already sat.
//
// Pure and three-free: it runs the scene's own solve (fieldCamera → fieldScales → packTargets → solveTargets
// against the hero's h1 and visitor card at their page-top position, exactly as JackFieldScene.layout() does)
// and pads every solved target's disc by the body's radius plus CORRIDOR_PAD_U — the drift's reach (2 × AMP =
// 0.36 u) plus the jam: a pack's members can never all reach their targets, and at rest they spill up to
// ≈ 0.15 u past the target discs toward a neighbouring gap (measured in node over 45 s of the scene's own step,
// drift on, at the four fixture viewports; tests/pack-corridor.test.ts holds the corridor clear of every
// settled body there). The harness check `titleClearOfPacks` holds the live title against the live bodies.

import { SEED_FIELD, fieldCamera, fieldScales, keepOutFor, onScreen, solveTargets, type Rect } from "./fieldLayout";
import { packCount, packOf, packTargets, type Pack } from "./fieldPacks";
import { DYN, type KeepOut } from "./jackDynamics";

/** world units added to each target disc (beyond the body's radius) before the gaps are measured */
export const CORRIDOR_PAD_U = 0.5;
/** a gap shorter than this is no corridor: the dial then sits at the stage's top */
export const CORRIDOR_MIN_PX = 200;
/** the scene's visitor-card strength (JackFieldScene CARD_STRENGTH) */
const CARD_STRENGTH = 0.5;
const TAN = Math.tan((12.5 * Math.PI) / 180);

export interface CorridorInput {
  width: number;
  height: number;
  /** the h1 wordmark's computed font size (the camera's size rule), null when there is no h1 */
  h1FontPx: number | null;
  /** the h1 and the visitor card at their PAGE-TOP position (fieldLayout.atPageTop), as the scene solves them */
  hero: { h1: Rect | null; card: Rect | null };
  /** the composition the field was born with (fieldPacks) */
  packs: readonly Pack[];
  /** the dial column's x-range in viewport px */
  x: readonly [number, number];
  /** the stage's clear band: the corridor never reaches above `top` or below `height − bottom` */
  clear: { top: number; bottom: number };
}

export interface Corridor {
  top: number;
  bottom: number;
  /** every pack's padded on-screen box, viewport px (for the harness and the tests) */
  boxes: Rect[];
}

/** a solved target on screen: its centre and radius in viewport px, and the pack it belongs to */
export interface Disc { cx: number; cy: number; r: number; pack: number }

/** every solved target as a disc on screen (the scene's solve), its radius the body's plus `padU` world units */
export function packDiscs(input: Omit<CorridorInput, "x" | "clear">, padU = 0): Disc[] {
  const { width: w, height: h, packs } = input;
  const fit = fieldCamera(w, h, input.h1FontPx);
  const scales = fieldScales(packCount(packs), SEED_FIELD);
  const avoid: KeepOut[] = [];
  if (input.hero.h1 && onScreen(input.hero.h1, w, h)) avoid.push(keepOutFor(input.hero.h1, fit, 1));
  if (input.hero.card && onScreen(input.hero.card, w, h)) avoid.push(keepOutFor(input.hero.card, fit, CARD_STRENGTH));
  const { targets } = solveTargets(fit, packTargets(fit, packs, SEED_FIELD), scales, avoid);
  const owners = packOf(packs);
  return targets.map((t, i) => {
    const ppu = h / 2 / ((fit.z - t.z) * TAN);
    return { cx: w / 2 + t.x * ppu, cy: h / 2 - t.y * ppu, r: (DYN.BODY_R * (scales[i] ?? 1) + padU) * ppu, pack: owners[i] };
  });
}

/** each pack's on-screen box, padded, from the scene's solve */
export function packBoxes(input: Omit<CorridorInput, "x" | "clear">): Rect[] {
  const boxes: Rect[] = input.packs.map(() => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }));
  for (const d of packDiscs(input, CORRIDOR_PAD_U)) {
    const b = boxes[d.pack];
    b.left = Math.min(b.left, d.cx - d.r); b.right = Math.max(b.right, d.cx + d.r);
    b.top = Math.min(b.top, d.cy - d.r); b.bottom = Math.max(b.bottom, d.cy + d.r);
  }
  return boxes.filter((b) => Number.isFinite(b.top));
}

// ---------------------------------------------------------------------------------------------------------------
// THE FIELD UNDER A PANEL (OC-T, keyed on what causes it). The chapter panels are glass over the fixed jack field;
// where a pack sits under a list's text, a jack's glossy black (light theme) or its highlights (dark) come through
// the blur behind the numerals and lines, and the site's 24 % / 40 % fill measured below 4.5:1 there (1024–1280 px
// two-column, 820 × 1180 and 1000 × 800 one-column). A width breakpoint also raised the fill on touch iPads, where
// the field never mounts. So the ChapterDirector asks the scene's own solve: does a solved jack's own disc (the
// body's radius, no drift pad) reach FIELD_UNDER_PX into the list's box — a pinned list where its stage docks, a
// flow list anywhere in its column (it passes over the whole field) — and writes data-over-field; app/chapter.css
// raises that panel's fill (--chapter-field-tint).
//
// FIELD_UNDER_PX IS NEGATIVE: a disc that stops short of the list still darkens it. The panel's 16 px backdrop blur
// spreads a jack's glossy black past the disc, and the drift and the pointer carry the bodies further. At the
// reference 1440 × 900 (reach −18 px) the light theme's grey smudges behind the index column failed 3 runs of 6 on
// the site's glass (a numeral 3.14, Education's "02" 4.39–4.44, a date line 4.39–4.43; box p90 4.48–4.81), and
// 1470 × 832 (−25 px) measured 4.57–4.97. So reach alone does not predict contrast near 0. Measured, five fresh runs
// each in the light theme on the site's glass: 1728 × 1117 (−83 px) still failed its numerals in 3 of 5 (3.90–4.16),
// and 1920 × 1080 (−125 px) passed all five (numerals 6.48). So from −100 px the panel is raised: 1440 × 789 (−4),
// 1440 × 900 (−18), 1470 × 832 (−25), 1512 × 982 (−34) and 1728 × 1117 (−83) take --chapter-field-tint, and
// 1920 × 1080, 2560 × 1440 (−250) and any larger desktop keep the site's glass. The reach along the way: 25 px at
// 1100 × 800, 17–18 px at 1024 × 768 and 1280 × 720, 10 px at 1366 × 768. verify-motion contrastRows holds every
// one of these windows at five fresh runs in both themes (CONTRAST_RUNS).

/** px: a solved jack disc reaching this far into a list's box (negative: stopping this short of it) puts the field
 *  under its text */
export const FIELD_UNDER_PX = -100;

/** px: how far the deepest disc reaches into `rect` (its radius less the centre's signed distance to the box; ≤ 0: clear) */
export function discReach(discs: readonly Disc[], rect: Rect): number {
  let best = -Infinity;
  for (const d of discs) {
    const dx = Math.max(rect.left - d.cx, 0, d.cx - rect.right), dy = Math.max(rect.top - d.cy, 0, d.cy - rect.bottom);
    // inside the box the centre's distance is negative: to its nearest edge
    const dist = dx > 0 || dy > 0 ? Math.hypot(dx, dy) : -Math.min(d.cx - rect.left, rect.right - d.cx, d.cy - rect.top, rect.bottom - d.cy);
    best = Math.max(best, d.r - dist);
  }
  return best;
}

/** A FLOW dial's top beside a jack field, and its panel's (app/chapter.css, CSS alone): svh % of the stage plus px.
 *  `33svh + 8px` lies inside the corridor at every desktop of the owner's matrix (its top measured 0.28–0.32 of the
 *  height); tests/pack-corridor.test.ts holds it inside the corridor at the fixture viewports, and
 *  tests/pin-query.test.ts holds the CSS twin. */
export const FLOW_DIAL_TOP = { svh: 33, px: 8 } as const;

/** The tallest vertical gap between the packs inside the dial's x-range, or null when none is ≥ CORRIDOR_MIN_PX. */
export function packCorridor(input: CorridorInput): Corridor | null {
  const boxes = packBoxes(input);
  const [x0, x1] = input.x;
  const lo = input.clear.top, hi = input.height - input.clear.bottom;
  const inColumn = boxes.filter((b) => b.right > x0 && b.left < x1).sort((a, b) => a.top - b.top);
  let best: { top: number; bottom: number } | null = null;
  let edge = lo;
  for (const b of [...inColumn, { left: 0, right: 0, top: hi, bottom: hi }]) {
    const top = Math.max(lo, edge), bottom = Math.min(hi, b.top);
    if (bottom - top > (best ? best.bottom - best.top : 0)) best = { top, bottom };
    edge = Math.max(edge, b.bottom);
  }
  if (!best || best.bottom - best.top < CORRIDOR_MIN_PX) return null;
  return { top: Math.round(best.top), bottom: Math.round(best.bottom), boxes };
}
