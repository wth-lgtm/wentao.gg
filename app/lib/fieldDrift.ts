// The jack field's idle drift. The owner (2026-09-17), on the glass build: the jacks "should be
// drifting ever slightly in its position so it appears not as rigid". Not a force on the bodies
// and not a shader wobble: each body's HOME wanders — a bounded, smooth, deterministic offset
// added to the solved target every frame (JackFieldScene.tsx) — and the body follows the
// wandering home through the pull with the dynamics' own lag. Two terms since the packs
// (fieldPacks.ts): the body's own, and its PACK's common-mode term shared by every member
// (packDriftOffset), so a jammed pack breathes as a whole. Pure and three-free (rand from
// seed.ts), so the bounds, the mean and the speed run in node.
//
// Response (a critic's numbers, unit jack, E = 0): mass 4.849, K/m 8.25 s⁻², ω_n 2.87 rad/s;
// the per-second velocity retention DAMP · SETTLE = 0.2 · 3e-4 is a decay rate of 9.72 s⁻¹ →
// ζ ≈ 1.7, overdamped, no overshoot; gain 0.90 at a 14 s period, 0.80 at 9 s, 0.72 at 7 s,
// 0.50 at 4 s, phase lag 30–60°. Touching pairs lose their relative drift to REST_FRICTION and
// sway common-mode. The tumble term gives ≈ 1°/s of roll: negligible.

import type { Vec3 } from "./jackDynamics";
import { rand } from "./seed";

export const DRIFT = {
  /**
   * the home's excursion in x and y, view units, PER TERM — the body's own term and its pack's
   * common-mode term are each bounded by this, so a home wanders within 2·AMP. A unit jack is
   * 2.2 u across. At E = 0 a lone body is heavily overdamped (DAMP · SETTLE) and follows at
   * ≈ 0.5–0.9 of an offset, so its visible sway is ≈ 0.09–0.16 u (6–11 px at 71 px/u). A JAMMED
   * PACK absorbs ≈ 70% of the per-body sway (p50 0.032 u/s ≈ 2 px/s, measured: the members'
   * offsets point every way and the contacts cancel most of them), so on top of it every member
   * of pack p takes the SAME offset, driftOffset(1000 + p, t, seed) — the whole pack breathes at
   * the owner's "ever slightly" (≈ 8 px) while its members jostle.
   *
   * Drift vs the keep-out band: a home solved AT the band's edge (fieldLayout.solveTargets puts
   * the lower pack's top row exactly there) sways into it — the band's K_KEEP · (d/1.5)² against
   * the pull's ≈ 8.25·d u/s² — a smooth, halved, asymmetric sway of a few tenths of a unit at
   * most with both terms, well inside the band's 1.5 u and the solve's 0.25 · D tolerance (0.40 u
   * for the smallest jack). Zero here and in AMP_Z restores rest → freeze (JackFieldScene.tsx).
   */
  AMP: 0.18,
  AMP_Z: 0.1,
  /** the two periods per axis, seconds: a slow swell and a faster ripple, seeded per body */
  T_SLOW: [9, 14] as const,
  T_FAST: [4, 7] as const,
  /** the idle cadence (frames/s) while nothing but the drift is moving */
  IDLE_HZ: 30,
  /**
   * faster than this (u/s, the frame's fastest body) the field is not idle: a click burst, a
   * kick or a band exit runs at full rate. The drifting bodies move ≤ ~0.2 u/s.
   */
  IDLE_V: 0.5,
} as const;

/** the swell's and the ripple's shares of the amplitude (they sum to 1, so the offset is bounded by A) */
const W_SLOW = 0.65;
const W_FAST = 0.35;
/**
 * The draws: rand(k, seed + n) for n ∈ FIRST_DRAW … FIRST_DRAW + 11, one per (axis × T1, T2,
 * φ1, φ2). Offsets 1–9, 11–12 and 51–52 are already the spawn, click, scale and pack draws
 * (jackDynamics.ts, fieldLayout.ts, fieldPacks.ts); reusing one would correlate the drift with them.
 */
const FIRST_DRAW = 31;
/** the pack terms' k: body indices run 0..n−1 (n ≤ 28), so 1000 + p never meets a body's own draw */
export const PACK_DRIFT_BASE = 1000;

function axisOffset(k: number, t: number, seed: number, axis: number, A: number): number {
  const n = FIRST_DRAW + axis * 4;
  const t1 = DRIFT.T_SLOW[0] + (DRIFT.T_SLOW[1] - DRIFT.T_SLOW[0]) * rand(k, seed + n);
  const t2 = DRIFT.T_FAST[0] + (DRIFT.T_FAST[1] - DRIFT.T_FAST[0]) * rand(k, seed + n + 1);
  const p1 = 2 * Math.PI * rand(k, seed + n + 2);
  const p2 = 2 * Math.PI * rand(k, seed + n + 3);
  return A * (W_SLOW * Math.sin((2 * Math.PI * t) / t1 + p1) + W_FAST * Math.sin((2 * Math.PI * t) / t2 + p2));
}

/**
 * The home's offset for body k at sim time t, written into `out` (no allocation): per axis
 * A·(0.65·sin(2πt/T1 + φ1) + 0.35·sin(2πt/T2 + φ2)), T1 ∈ T_SLOW, T2 ∈ T_FAST, φ ∈ [0, 2π),
 * all from rand(k, seed + n). Bounded by A, smooth, deterministic in (k, seed). Its per-axis
 * speed is at most A·2π·(0.65/T_SLOW[0] + 0.35/T_FAST[0]) — 0.18 u/s in x and y at these
 * numbers — a PER-AXIS bound; the 3-D speed can reach ≈ 0.27 u/s.
 */
export function driftOffset(k: number, t: number, seed: number, out: Vec3): Vec3 {
  out.x = axisOffset(k, t, seed, 0, DRIFT.AMP);
  out.y = axisOffset(k, t, seed, 1, DRIFT.AMP);
  out.z = axisOffset(k, t, seed, 2, DRIFT.AMP_Z);
  return out;
}

/**
 * Pack p's common-mode offset at sim time t — driftOffset at k = PACK_DRIFT_BASE + p, the same
 * for every member, added to each member's own term (JackFieldScene.applyDrift). Same bounds,
 * same periods, its own seeded phases.
 */
export function packDriftOffset(p: number, t: number, seed: number, out: Vec3): Vec3 {
  return driftOffset(PACK_DRIFT_BASE + p, t, seed, out);
}
