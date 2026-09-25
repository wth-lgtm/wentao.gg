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

/** each pack's on-screen box, padded, from the scene's solve */
export function packBoxes(input: Omit<CorridorInput, "x" | "clear">): Rect[] {
  const { width: w, height: h, packs } = input;
  const fit = fieldCamera(w, h, input.h1FontPx);
  const scales = fieldScales(packCount(packs), SEED_FIELD);
  const avoid: KeepOut[] = [];
  if (input.hero.h1 && onScreen(input.hero.h1, w, h)) avoid.push(keepOutFor(input.hero.h1, fit, 1));
  if (input.hero.card && onScreen(input.hero.card, w, h)) avoid.push(keepOutFor(input.hero.card, fit, CARD_STRENGTH));
  const { targets } = solveTargets(fit, packTargets(fit, packs, SEED_FIELD), scales, avoid);
  const owners = packOf(packs);
  const boxes: Rect[] = packs.map(() => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }));
  targets.forEach((t, i) => {
    const ppu = h / 2 / ((fit.z - t.z) * TAN);
    const cx = w / 2 + t.x * ppu, cy = h / 2 - t.y * ppu;
    const r = (DYN.BODY_R * (scales[i] ?? 1) + CORRIDOR_PAD_U) * ppu;
    const b = boxes[owners[i]];
    b.left = Math.min(b.left, cx - r); b.right = Math.max(b.right, cx + r);
    b.top = Math.min(b.top, cy - r); b.bottom = Math.max(b.bottom, cy + r);
  });
  return boxes.filter((b) => Number.isFinite(b.top));
}

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
