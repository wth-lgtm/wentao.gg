// The card's second reading of its own data: what the physics pile beside the activity
// grid is allowed to claim, how big its pieces may be for the tray they land in, and the
// order they pour in. Kept pure so every rule can be tested without a DOM or a WebGL
// context — and so the DOM side can decide whether the tray fits BEFORE mounting a canvas
// that would have to unmount itself.

import type { CommitDay } from "./githubStats";

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
 * token); Task 12's idle/re-lay/swipe numbers were taken at 200 bodies. The cap also has to
 * fit the legibility rule: 200 level-4 pieces (the busiest kind of quarter) solve to a
 * scale of 0.76 on a 1024 px viewport's tray and 0.80 at 1440, both above TRAY.kLegible,
 * whereas 240 came out at 0.72 even at 1440 — the tray would have hidden itself for exactly
 * the quarters with the most to show. The newest commits survive the cut (the input is
 * oldest first), and the legend says how many are shown — never fewer commits than the
 * payload knows, silently.
 */
export const PIECE_CAP = 200;

export function capPieces(pieces: readonly Piece[], cap = PIECE_CAP): { shown: Piece[]; total: number } {
  return { shown: pieces.length > cap ? pieces.slice(pieces.length - cap) : [...pieces], total: pieces.length };
}

// Deterministic pseudo-random (stable across renders → no hydration drift).
export function rand(i: number, seed: number): number {
  return Math.abs(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1;
}

// "Lego land" — a mixed pile of geometric primitives instead of only bars. The box brick
// is the most common (three picks in nine) so it still reads as a heatmap pile.
// Not exported: nothing outside this file names it, and the type below is what callers
// actually want (FloatingBackground keys its material and collider maps on ShapeKey).
const SHAPES = ["box", "sphere", "cone", "octa", "tetra", "torus", "ico"] as const;
export type ShapeKey = (typeof SHAPES)[number];
const PICK = [0, 0, 0, 1, 2, 3, 4, 5, 6];

export function shapeOf(i: number): ShapeKey {
  return SHAPES[PICK[Math.floor(rand(i, 7) * PICK.length)]];
}

// A box's height is the heatmap's own extrusion for its level; every other shape is a
// uniform scale so it keeps its silhouette. AREA is each unit primitive's camera-facing
// cross-section (× s²), for the fill rule.
// Not exported either: only sizeOf reads it, and a bar height is not a number a caller
// can do anything with on its own.
const HEIGHTS = [0.34, 0.62, 0.96, 1.35, 1.85];
// `box` is deliberately absent rather than 0. A box returns from sizeOf before AREA is
// read — its area is w × h, from its own random dimensions — so the 0 that used to sit
// here was a value nothing could consume and a reader had to rule out. Omitting it makes
// the type say so: a lookup for "box" is a compile error, which is the correct answer.
const AREA: Record<Exclude<ShapeKey, "box">, number> = {
  sphere: 0.79, cone: 0.52, octa: 0.77, tetra: 0.55, torus: 0.72, ico: 0.8,
};

/** Unit-scale size and face area of piece `i` — shape, size and spin are texture, not data. */
export function sizeOf(i: number, key: ShapeKey, level: number): { scale: [number, number, number]; area: number } {
  if (key === "box") {
    const w = 0.42 + rand(i, 1) * 0.14;
    const d = w * (0.9 + rand(i, 2) * 0.2);
    const h = HEIGHTS[level] * (0.9 + rand(i, 12) * 0.22);
    return { scale: [w, h, d], area: w * h };
  }
  const s = 0.5 + rand(i, 1) * 0.62; // uniform → keeps each primitive's shape, varied sizes
  return { scale: [s, s, s], area: AREA[key] * s * s };
  // `key` is narrowed to Exclude<ShapeKey, "box"> by the early return above.
}

/**
 * The tray in world units, shared by the canvas (which builds it) and the DOM (which
 * decides whether to show it). `crest` is where the topmost piece's centre should settle as
 * a fraction of the tray's height; `density` is how densely this shape mix packs, measured
 * on the live 165 level-4 commits (coverage 0.68 of the tray settled to a crest of 0.89).
 * `kLegible` is the piece scale below which a block is under ~10 px on the 273 px tray —
 * a tray that would need smaller pieces is hidden, never overfilled.
 */
export const TRAY = { inset: 1.0, floorLift: 0.7, crest: 0.55, density: 0.76, kMax: 1.6, kLegible: 0.7 };

/**
 * Fill rule: the count follows the quarter and so does the mass (a level-4 box is four times
 * the face of a level-0 one), so the pieces are scaled so that their summed cross-section,
 * packed at `density`, puts the crest at `crest` of the tray. Solved from the tray every
 * time, with no floor: a floor of 0.75 left today's 165 pieces cresting at 0.93 of a 720 px
 * tray and 1.29 at 640, through the ceiling and into the overflow clip. Only the top is
 * clamped — a handful of commits become a few big blocks, not boulders.
 */
export function fillScale(hw: number, hh: number, pieces: readonly Piece[]): number {
  let sum = 0;
  for (let i = 0; i < pieces.length; i++) sum += sizeOf(i, shapeOf(i), pieces[i].level).area;
  if (sum === 0) return 1;
  const tray = 2 * (hw - TRAY.inset) * (2 * hh - TRAY.floorLift);
  return Math.min(TRAY.kMax, Math.sqrt((TRAY.crest * TRAY.density * tray) / sum));
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
