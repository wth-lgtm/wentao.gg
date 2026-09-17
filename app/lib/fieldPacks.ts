// The jack field's COMPOSITION: packs, not a lattice. The owner (2026-09-17, after PR #69): "on
// the GitHub page all those jacks have a sort of clustering effect. They wanted to be together,
// clustered in the middle, that type of feeling" — and the hero should look and feel the same.
// Why the card feels alive (measured in node against these modules): its createWorld gives body
// i the target ((i − 5.5)·0.6, 0, 0) — twelve targets on a 6.6 u line for bodies 1.8–2.5 u
// across. They can never all reach their targets, so they pack, press, bulge in y and z and
// regather after every push: mean body speed 0.113 u/s at E = 1 (max 1.98, 1.16 u of path per
// body per 10 s). The lattice gave every jack a 4.8 × 3.0 u cell, so nothing touched at rest:
// 0.002 u/s. What reaches the card's number is MEMBER COUNT UNDER COMPRESSION: seven bodies on
// a 0.9 u disc move at 0.025 u/s (4.5× quieter; a wider disc is quieter still), fourteen on a
// 0.9 u disc 0.077, fourteen on a 2.0 u disc 0.114 — the card; a seven with the swirl gained ×3
// reaches 0.074 (×4 breaks the jam and churns). So the composition is built around one
// fourteen-member pack, and small packs get a swirl gain (jackDynamics.ts Body.swirlGain).
//
// Where a pack can go: the hero's only pack-sized free area is BELOW the h1 on the left — 3.3 u
// of vertical room for body centres × ~9 u wide at 1440 × 900 (3.5 u at 1024 × 768, 2.3 u at
// 1440 × 700). Above the h1 there are 2.34 u (1.24 u at 1440 × 700) and the fixed nav (no
// background) occupies the top 80 px. The visitor card's half-strength band leaves 1.2 u above
// and below the card — less than one body: NO pack centre may fall inside the card's x-range
// (x 1.67..8.08 u at 1440 × 900) or the pack flattens into a row under the nav (measured: 7/7
// targets pushed to one line). A pack centre must sit ≥ 2.5 u beyond a full-strength box's band
// edge (band 1.5 + r + pad) or it becomes a row too (edge 1–1.5 u from C → a 3.7 × 0.36 u line,
// aspect 10:1; 2.5 u → a 2.7 × 2.05 blob).
//
// Pure — fieldLayout.solveTargets pushes these targets out of the keep-out bands and into the
// view, JackFieldScene.tsx sets the pivots (packCentroids) after the solve; every rule here runs
// in node (tests/field-packs.test.ts).

import type { Family } from "./connectorJacks";
import { FIELD, type Slot } from "./fieldLayout";
import type { Vec3 } from "./jackDynamics";
import { rand } from "./seed";

/** a pack: centre as fractions of the view's half-extents (x right, y up), member count, target-disc radius (u), swirl gain */
export interface Pack { cx: number; cy: number; n: number; r: number; swirlGain: number }

/**
 * ≥ 1280 × 800: the card's pack under the name (fourteen on a 2 u disc — the card's speed) and
 * seven above it (gained ×3) — 21. Measured placements at D_PER_FONT 1.4, 1440 × 900: the
 * fourteen rest at 144–602 × 575–890 px, their upper targets pushed to the h1's band edge so the
 * pack HUGS the name from below (the intent; nothing clipped; no disc over the h1, the card or
 * the split-flap); the seven above at 144–518 × −5..248 px — its top touches the viewport edge
 * and three or four of its discs sit behind the nav's text. The nav has no background, and the
 * lattice already put a jack under "INDEX": accepted. The lower pack's cy must stay ≥ −0.6 at
 * 1440 × 900 or the blob's bottom clips (−0.66 → 951 px).
 */
export const PACKS_WIDE: readonly Pack[] = [{ cx: -0.45, cy: -0.5, n: 14, r: 2.0, swirlGain: 1 }, { cx: -0.55, cy: 0.66, n: 7, r: 0.9, swirlGain: 3 }];
/** the left-side alternative behind ?jacksDebug=1&jacksPacks=quads: three sevens — 21 */
export const PACKS_QUADS: readonly Pack[] = [{ cx: -0.75, cy: -0.6, n: 7, r: 0.9, swirlGain: 3 }, { cx: -0.25, cy: -0.6, n: 7, r: 0.9, swirlGain: 3 }, { cx: -0.5, cy: 0.68, n: 7, r: 0.9, swirlGain: 3 }];
/** below 1280 × 800: one pack of ten under the name (1024 × 768: rests at 152–469 × 495–728 px, nothing clipped; 1440 × 700: 259–617 × 468–727 px, two discs clipped at the bottom) */
export const PACKS_NARROW: readonly Pack[] = [{ cx: -0.4, cy: -0.5, n: 10, r: 1.4, swirlGain: 1.9 }];
export const PACK_MAX_R = 2.0;

export type PackVariant = "quads";

/** the composition for a viewport: WIDE at or above FIELD.WIDE_W × WIDE_H (QUADS behind the debug override), NARROW below (the override does not apply there) */
export function fieldPacks(viewportW: number, viewportH: number, variant: PackVariant | null = null): readonly Pack[] {
  if (!(viewportW >= FIELD.WIDE_W && viewportH >= FIELD.WIDE_H)) return PACKS_NARROW;
  return variant === "quads" ? PACKS_QUADS : PACKS_WIDE;
}

/** the member sum */
export const packCount = (packs: readonly Pack[]): number => packs.reduce((n, p) => n + p.n, 0);

/** the field's body count for a viewport: 21 wide, 10 narrow */
export function fieldCount(viewportW: number, viewportH: number): number {
  return packCount(fieldPacks(viewportW, viewportH));
}

/** the debug override, from location.search: "quads" only with ?jacksDebug present AND jacksPacks=quads */
export function packVariantFromSearch(search: string): PackVariant | null {
  const q = new URLSearchParams(search);
  return q.has("jacksDebug") && q.get("jacksPacks") === "quads" ? "quads" : null;
}

/** body → pack index; bodies are numbered in pack order, members in spiral order */
export function packOf(packs: readonly Pack[]): number[] {
  const out: number[] = [];
  packs.forEach((p, i) => { for (let k = 0; k < p.n; k++) out.push(i); });
  return out;
}

/** the golden angle, so consecutive spiral members sit on opposite sides of the centre */
const GOLDEN = 2.39996;
/** the draws: seed offsets 51 (a pack's spiral phase) and 52 (its glossies). 1–9 are the dynamics', 11–12 the scales', 31–42 the drift's; 51+ is free. */
const DRAW_PHASE = 51;
const DRAW_GLOSSY = 52;

/**
 * Raw pull targets, one per member, in pack order: pack p's centre C = (cx·viewW/2, cy·viewH/2),
 * a Fermat spiral inside r — ρ_k = r·√((k + 0.5)/n), θ_k = k·GOLDEN + 2π·rand(p, seed + 51) —
 * and z_k = ±(0.35 + 0.9·((k >> 1) % 3)/2), the sign alternating with k. Every target is within
 * r of C and r is under a body's diameter, so the members can never all reach their targets:
 * they pack. Once jammed a pack stacks in DEPTH — body centres span ≈ 3.8 u (seven) / 4.1–4.8 u
 * (fourteen) of z, bodies to |z| 2.6, a column toward the camera three or four glass layers deep
 * at the core (why the scene's depth pre-pass matters); the resting blob is ≈ 4.5 u across for
 * seven, 4.4–5.5 u for fourteen.
 */
export function packTargets(fit: { viewW: number; viewH: number }, packs: readonly Pack[], seed: number): Vec3[] {
  const out: Vec3[] = [];
  packs.forEach((p, pi) => {
    const cx = (p.cx * fit.viewW) / 2, cy = (p.cy * fit.viewH) / 2;
    const phase = 2 * Math.PI * rand(pi, seed + DRAW_PHASE);
    for (let k = 0; k < p.n; k++) {
      const rho = p.r * Math.sqrt((k + 0.5) / p.n);
      const th = k * GOLDEN + phase;
      const z = (k % 2 ? -1 : 1) * (0.35 + (0.9 * ((k >> 1) % 3)) / 2);
      out.push({ x: cx + rho * Math.cos(th), y: cy + rho * Math.sin(th), z });
    }
  });
  return out;
}

/** the casting's cycle: 3 / 2 / 2 per seven, no two cyclic neighbours share a family */
export const CAST_CYCLE: readonly Family[] = ["white", "accent", "white", "black", "white", "accent", "black"];

/**
 * Which family and finish each member wears, per pack in spiral order, from CAST_CYCLE with the
 * phase advanced by one each round — member k wears CAST_CYCLE[(k + ⌊k/7⌋) % 7]: seven → white
 * 3 / accent 2 / black 2; fourteen → 6 / 4 / 4; ten (the first ten of two rounds) → 4 / 3 / 3
 * (the plain cycle would give ten 5 / 3 / 2) — and consecutive members never share a family,
 * the round boundary included (…black | accent…). Glossies (the card's clear glass): fourteen
 * gets one per family, seven and ten a white and a black, each at a seeded spiral position and
 * never adjacent to another glossy. WIDE totals: accent 6 (5 matte / 1 glossy), white 9 (7 / 2),
 * black 6 (4 / 2) — five glossies of twenty-one (the card is four of twelve). Never data.
 */
export function packCasting(packs: readonly Pack[], seed: number): Slot[] {
  const L = CAST_CYCLE.length;
  const out: Slot[] = [];
  packs.forEach((p, pi) => {
    const families: Family[] = [];
    for (let k = 0; k < p.n; k++) families.push(CAST_CYCLE[(k + Math.floor(k / L)) % L]);
    const glossyFamilies: readonly Family[] = p.n >= 14 ? ["white", "accent", "black"] : ["white", "black"];
    const glossyAt: number[] = [];
    glossyFamilies.forEach((f, fi) => {
      const members = families.map((g, k) => (g === f ? k : -1)).filter((k) => k >= 0);
      if (members.length === 0) return;
      let j = Math.floor(rand(pi * 8 + fi, seed + DRAW_GLOSSY) * members.length);
      for (let tries = 0; tries < members.length; tries++, j = (j + 1) % members.length) {
        const k = members[j];
        if (glossyAt.every((g) => Math.abs(g - k) > 1)) { glossyAt.push(k); break; }
      }
    });
    families.forEach((f, k) => out.push({ family: f, finish: glossyAt.includes(k) ? "glossy" : "matte" }));
  });
  return out;
}

/**
 * The swirl's pivots: the centroid of each pack's SOLVED targets (fieldLayout.solveTargets —
 * post-push), not the nominal C. The h1's band shifts a pack 0.45–1.1 u off C, and a swirl
 * about C would turn about a point outside the pack. Re-run on every relayout (the scene's
 * `repivot`).
 */
export function packCentroids(targets: readonly Vec3[], packs: readonly Pack[]): Vec3[] {
  const out: Vec3[] = [];
  let i = 0;
  for (const p of packs) {
    let x = 0, y = 0, z = 0, n = 0;
    for (let k = 0; k < p.n; k++, i++) {
      const t = targets[i];
      if (t) { x += t.x; y += t.y; z += t.z; n++; }
    }
    out.push(n ? { x: x / n, y: y / n, z: z / n } : { x: 0, y: 0, z: 0 });
  }
  return out;
}
