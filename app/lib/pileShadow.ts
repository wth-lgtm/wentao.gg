// The key light's shadow frustum, fitted in LIGHT space. The obvious box — the tray's own
// half-extents, ±3.9 × ±1.5 — is its footprint as if the light stood overhead and axis-
// aligned; for a key at [6, 8, 2.5] three's shadow camera looks along (−0.58, −0.78, −0.24)
// with its up vector derived from world +y, so the tray's 7.0 × 2.6 floor projects to a
// nearly square ~8 × 7 u box and the naive frustum covered under half of it. Fragments
// outside the shadow frustum render LIT, so an under-fitted map fails silently: the far
// ends of the tray simply cast nothing. Pure, so the fit is tested rather than eyeballed.

import { WORLD } from "./pileScene";

export type Vec = [number, number, number];

export interface Aabb {
  min: Vec;
  max: Vec;
}

/** Where the one key light sits: up and to the RIGHT, the direction the heatmap's bars and
 *  the hero's caustic are painted for. [3, 7, 4] would have lit the front brighter than the
 *  right face and reversed the board's FACE_LIT / FACE_SHADE order. */
export const KEY_POSITION: Vec = [6, 8, 2.5];

/** Everything that casts or receives: the tray with its lips and the heap plus ~2 u of fall
 *  above it — a piece still higher than that throws its shadow outside the floor (the mouth
 *  itself sits at 4.1–5.4, off-frame). */
export const SHADOW_AABB: Aabb = {
  min: [-(WORLD.W / 2 + WORLD.LIP), -WORLD.SLAB_T, -(WORLD.D / 2 + WORLD.LIP)],
  max: [WORLD.W / 2 + WORLD.LIP, 2.9, WORLD.D / 2 + WORLD.LIP],
};

export interface ShadowBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/**
 * A world point in the shadow camera's frame: the camera sits at `lightPos` and looks at the
 * origin (the light's default target) with three's Matrix4.lookAt convention — z toward the
 * camera, x = up × z, y = z × x. `depth` is distance along the view, positive in front.
 */
export function lightSpace(p: Vec, lightPos: Vec): { x: number; y: number; depth: number } {
  const len = Math.hypot(lightPos[0], lightPos[1], lightPos[2]);
  const z: Vec = [lightPos[0] / len, lightPos[1] / len, lightPos[2] / len];
  // x = normalize(up × z) with up = (0, 1, 0) → (z.z, 0, −z.x)
  const xl = Math.hypot(z[2], z[0]);
  const x: Vec = [z[2] / xl, 0, -z[0] / xl];
  // y = z × x
  const y: Vec = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const v: Vec = [p[0] - lightPos[0], p[1] - lightPos[1], p[2] - lightPos[2]];
  const d = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { x: d(v, x), y: d(v, y), depth: -d(v, z) };
}

/** Orthographic bounds enclosing every corner of `aabb` in light space, plus `margin`. */
export function shadowBoundsFor(lightPos: Vec, aabb: Aabb, margin = 0.2): ShadowBounds {
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  let near = Infinity;
  let far = -Infinity;
  for (const px of [aabb.min[0], aabb.max[0]]) {
    for (const py of [aabb.min[1], aabb.max[1]]) {
      for (const pz of [aabb.min[2], aabb.max[2]]) {
        const l = lightSpace([px, py, pz], lightPos);
        left = Math.min(left, l.x);
        right = Math.max(right, l.x);
        bottom = Math.min(bottom, l.y);
        top = Math.max(top, l.y);
        near = Math.min(near, l.depth);
        far = Math.max(far, l.depth);
      }
    }
  }
  return { left: left - margin, right: right + margin, top: top + margin, bottom: bottom - margin, near: near - margin, far: far + margin };
}
