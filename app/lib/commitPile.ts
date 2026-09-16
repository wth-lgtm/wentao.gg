// The card's second reading of its own data: what the physics pile beside the activity
// grid is allowed to claim, how big its pieces may be for the tray they land in, and the
// order they pour in. Kept pure so every rule can be tested without a DOM or a WebGL
// context — and so the DOM side can decide whether the tray fits BEFORE mounting a canvas
// that would have to unmount itself.

import type { CommitDay } from "./githubStats";
import { WORLD, fitCamera, type CameraFit } from "./pileScene";

export interface Piece {
  /** The grid's five-step level of the day this commit landed on. */
  level: number;
}

/** The activity grid's ramp; the pile colours its pieces with the same function. */
export function levelFor(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

/**
 * One piece per commit the payload DATES, coloured by its day's level, oldest day first
 * so the pour lays the quarter down as sediment. Never padded to the repo's commit total:
 * the route only dates the commits inside the window, and level 0 means "a day with no
 * commits" in the legend under the grid — a commit cannot sit on one of those, so a
 * padding piece would contradict the legend and assert a count the data does not know.
 */
export function piecesForDays(days: readonly CommitDay[]): Piece[] {
  const pieces: Piece[] = [];
  for (const day of days) {
    const level = levelFor(day.count);
    for (let i = 0; i < day.count; i++) pieces.push({ level });
  }
  return pieces;
}

/**
 * The most bodies the pile will simulate. The route pages to 300 dated commits (500 with a
 * token); Task 12's idle/swipe numbers were taken at 200 bodies, and 200 convex bodies is
 * about where rapier's step stops being free on an iGPU laptop's CPU. The cap also has to
 * fit the legibility rule: 200 level-4 pieces (the busiest kind of quarter) solve to k 0.46
 * under the coverage rule, a 14 px narrowest box at the 691 px tray's 72 px/u and 10.6 px
 * at a 520 px one — legible down to a 489 px tray column. The newest commits survive the cut
 * (the input is oldest first), and the legend says how many are shown — never fewer
 * commits than the payload knows, silently.
 */
export const PIECE_CAP = 200;

export function capPieces(pieces: readonly Piece[], cap = PIECE_CAP): { shown: Piece[]; total: number } {
  return { shown: pieces.length > cap ? pieces.slice(pieces.length - cap) : [...pieces], total: pieces.length };
}

// Deterministic pseudo-random (stable across renders → no hydration drift).
export function rand(i: number, seed: number): number {
  return Math.abs(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1;
}

// A tray of objects, not a zoo of primitives. The box brick is the most common (three picks
// in nine) so it still reads as a heatmap pile; the other six are things a desk tray holds
// — a die, a domino, a puck, a capsule, a sphere, a ring. Cones, tetrahedra and icosahedra
// were the largest "game asset" tell: knife edges no real tray ever held. Shape is texture,
// not data: only the level (and a box's height) is the commit's.
// Not exported: nothing outside this file names it, and the type below is what callers
// actually want (FloatingBackground keys its geometry and collider maps on ShapeKey).
const SHAPES = ["box", "die", "domino", "puck", "capsule", "sphere", "torus"] as const;
export type ShapeKey = (typeof SHAPES)[number];
const PICK = [0, 0, 0, 1, 2, 3, 4, 5, 6];

export function shapeOf(i: number): ShapeKey {
  return SHAPES[PICK[Math.floor(rand(i, 7) * PICK.length)]];
}

// A box's height is the heatmap's own extrusion for its level; every other shape is a
// uniform scale so it keeps its silhouette. Exported because the canvas bakes one rounded
// box geometry per LEVEL with this height in it: a unit cube scaled 1 : 4 per instance
// would stretch its bevel 4 : 1 with it.
export const HEIGHTS = [0.34, 0.62, 0.96, 1.35, 1.85] as const;

/**
 * Each unit shape's RESTING footprint — the x·z extent it covers once it has come to lie on
 * the floor (× s²) — for the coverage rule. The unit geometries the canvas builds are sized
 * to these: die edge 1; domino 0.5 × 0.175 × 1.0 (1 : 0.35 : 2); puck r 0.32; capsule
 * r 0.16 + 0.3 long; sphere r 0.5; torus R 0.36 r 0.16 (outer r 0.52).
 * `box` is deliberately absent rather than 0: a box returns from sizeOf before this is
 * read — its footprint is its own largest face — so a lookup for "box" is a compile error,
 * which is the correct answer.
 */
const FOOTPRINT: Record<Exclude<ShapeKey, "box">, number> = {
  die: 1,
  domino: 0.5,
  puck: Math.PI * 0.32 * 0.32,
  capsule: 0.32 * 0.62,
  sphere: Math.PI * 0.25,
  torus: Math.PI * 0.52 * 0.52,
};

/** Unit-scale size and resting footprint of piece `i` — shape, size and spin are texture,
 *  not data. A box rests on its largest face: a level-4 stick lies down. */
export function sizeOf(i: number, key: ShapeKey, level: number): { scale: [number, number, number]; footprint: number } {
  if (key === "box") {
    const w = 0.42 + rand(i, 1) * 0.14;
    const d = w * (0.9 + rand(i, 2) * 0.2);
    const h = HEIGHTS[level] * (0.9 + rand(i, 12) * 0.22);
    const sorted = [w, h, d].sort((a, b) => b - a);
    return { scale: [w, h, d], footprint: sorted[0] * sorted[1] };
  }
  const s = 0.5 + rand(i, 1) * 0.62; // uniform → keeps each primitive's shape, varied sizes
  return { scale: [s, s, s], footprint: FOOTPRINT[key] * s * s };
  // `key` is narrowed to Exclude<ShapeKey, "box"> by the early return above.
}

/**
 * The fill rule's constants. `coverage` is the summed resting footprint as a multiple of the
 * inner floor. Re-keyed by measurement: the design's 1.8 ("two flat layers") crested at
 * 1.5 u on the live 192 — tumbled mixed shapes pack at ~0.5, not flat — and ran the heap
 * into the legend; 1.3 puts the crest near WORLD.CREST (0.9 u), the height the camera
 * budget and the shove caps are solved for. `minBox` is
 * the narrowest unit box sizeOf makes and `minPx` the width under which three faces stop
 * reading; together they decide whether a tray is legible at a given px/u. `kMax` keeps a
 * handful of commits from becoming boulders (a die at k 0.9 is up to 1 u — a third of the
 * tray's depth).
 */
export const TRAY = { coverage: 1.3, kMax: 0.9, minBox: 0.42, minPx: 10 } as const;

export interface TrayFit {
  /** piece scale: Σ footprint_i(k) = coverage × W × D */
  k: number;
  /** the fitted camera's pixels per world unit at the look-at plane */
  pxPerUnit: number;
  /** the k under which the narrowest box is below minPx at this px/u */
  kLegible: number;
  /** the narrowest box's width on this tray, in px — what the DOM's hysteresis is on */
  boxPx: number;
  legible: boolean;
  /** the camera's height budget did not squeeze the tray into a strip (see fitCamera) */
  headroomOk: boolean;
  camera: CameraFit;
}

/**
 * Fill rule, now a COVERAGE rule on a world-fixed tray. The count follows the quarter and so
 * does the mass, so the pieces are scaled so that their resting footprints sum to `coverage`
 * floors: k = √(coverage · W · D / Σ footprint). k depends on the pieces alone — the canvas
 * only moves the camera — and legibility is then a separate question of pixels: the DOM
 * runs the same camera fit on the tray the grid WOULD give and mounts nothing under
 * `minPx`. (The old 2-D rule solved k from a viewport-sized tray, so every height in the
 * scene was a screen quantity that a tilted camera made false.)
 */
export function coverageScale(pieces: readonly Piece[]): number {
  let sum = 0;
  for (let i = 0; i < pieces.length; i++) sum += sizeOf(i, shapeOf(i), pieces[i].level).footprint;
  return sum === 0 ? 1 : Math.min(TRAY.kMax, Math.sqrt((TRAY.coverage * WORLD.W * WORLD.D) / sum));
}

export function trayFit(trayWpx: number, trayHpx: number, pieces: readonly Piece[]): TrayFit {
  const k = coverageScale(pieces);
  const camera = fitCamera(trayWpx / trayHpx, trayHpx);
  const kLegible = TRAY.minPx / (TRAY.minBox * camera.pxPerUnit);
  const boxPx = k * TRAY.minBox * camera.pxPerUnit;
  return { k, pxPerUnit: camera.pxPerUnit, kLegible, boxPx, legible: boxPx >= TRAY.minPx, headroomOk: camera.headroomOk, camera };
}

/**
 * The pour's metre. Each 100 ms beat opens every `phases`-th mouth slot, the phase advancing
 * one slot per beat so the pattern ripples left → right; a slot is reopened only every
 * `phases` beats, by which time the previous train has fallen clear. A train stacks up to
 * `trainMax` pieces a slot apart above one mouth slot and is released as one.
 */
export const POUR = { phases: 3, maxBeats: 24, trainMax: 5 };

/**
 * Pieces per slot per beat so that `n` pieces pour within `maxBeats` — up to `trainMax`.
 * Past that the budget cannot hold and the pour simply takes longer: 240 pieces need at
 * least six slots (two per phase) to fit 24 beats, which every tray this card shows has.
 */
export function trainFor(n: number, slots: number): number {
  const perBeat = Math.max(1, Math.floor(slots / POUR.phases));
  return Math.min(POUR.trainMax, Math.max(1, Math.ceil(n / (perBeat * POUR.maxBeats))));
}

export interface PourStop {
  /** the beat (100 ms) the piece is released on */
  beat: number;
  /** the mouth slot, left to right */
  slot: number;
  /** its position in the slot's train, 0 = lowest */
  rung: number;
}

/** Piece `i` (oldest first) → when and where it enters. */
export function pourSchedule(n: number, slots: number, train: number, phases = POUR.phases): PourStop[] {
  const out: PourStop[] = [];
  let beat = 0;
  while (out.length < n) {
    for (let slot = beat % phases; slot < slots && out.length < n; slot += phases) {
      for (let rung = 0; rung < train && out.length < n; rung++) out.push({ beat, slot, rung });
    }
    beat++;
  }
  return out;
}
