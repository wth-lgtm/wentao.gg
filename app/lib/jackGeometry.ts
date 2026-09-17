// The jack: Lusion's six-way pipe connector, rebuilt from the profile measured on its
// cross.buf (positions quantised to ±1, 4,940 verts) — arm outer r 0.333, bore r 0.10 to a
// floor at 0.667, a 0.03 round on the rim and the bore mouth, a base flare from r 0.43 at
// 0.19 to 0.333 at 0.36 — as ONE lathe arm cloned onto ±x/±y/±z around a core sphere of
// r 0.48, which protrudes 0.0–0.03 between two arms and 0.06–0.09 in the three-arm crotch:
// the rounded junction. The v1 recipe (arms 0.42, bore 0.24, sphere hidden inside the arm
// union) was 26% fatter than the reference with a 2.4× bore.
//
// Per-vertex `ao` is Lusion's baked occlusion (cross.buf's ao attribute, mean 0.63): the
// bore floor 0.01–0.02, the wall ~0.2, the mouth 0.70, the rim 0.99, arm mid 0.78–0.82,
// the base fillet 0.68, the gap between two arms 0.70, the crotch 0.65. The shader applies
// it to indirect diffuse, indirect specular and the clearcoat's indirect term — the
// reference's bores are black holes, not shiny tubes.
//
// Lives under lib so the profile and the bake can be checked in node (three's geometry
// classes need no WebGL); only ConnectorField imports it.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** the arm's lathe profile (radius, height along the arm, baked ao), base → rim → bore floor */
export const PROFILE: readonly { r: number; y: number; ao: number }[] = [
  { r: 0.43, y: 0.19, ao: 0.68 }, // base flare — 0.470 from the centre, inside the core
  { r: 0.395, y: 0.25, ao: 0.7 },
  { r: 0.355, y: 0.31, ao: 0.74 },
  { r: 0.333, y: 0.36, ao: 0.78 }, // the fillet meets the arm, 0.490 from the centre
  { r: 0.333, y: 0.65, ao: 0.8 }, // arm mid
  { r: 0.333, y: 0.97, ao: 0.95 },
  { r: 0.325, y: 0.991, ao: 1.0 }, // the 0.03 tip round
  { r: 0.303, y: 1.0, ao: 1.0 }, // rim
  { r: 0.13, y: 1.0, ao: 0.85 }, // tip face
  { r: 0.109, y: 0.991, ao: 0.75 }, // the 0.03 mouth round
  { r: 0.1, y: 0.97, ao: 0.7 }, // bore mouth
  { r: 0.1, y: 0.9, ao: 0.45 },
  { r: 0.1, y: 0.8, ao: 0.25 },
  { r: 0.1, y: 0.7, ao: 0.12 },
  { r: 0.08, y: 0.675, ao: 0.05 }, // floor fillet
  { r: 0, y: 0.667, ao: 0.02 }, // floor
];

export const RADIAL_SEGMENTS = 36;
export const CORE = { r: 0.48, widthSegments: 24, heightSegments: 16 } as const;

/** the six arm directions, as rotations of the lathe's +y axis */
const ARMS: ((g: THREE.BufferGeometry) => void)[] = [
  () => {},
  (g) => g.rotateX(Math.PI),
  (g) => g.rotateZ(-Math.PI / 2),
  (g) => g.rotateZ(Math.PI / 2),
  (g) => g.rotateX(Math.PI / 2),
  (g) => g.rotateX(-Math.PI / 2),
];

function arm(): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(PROFILE.map((p) => new THREE.Vector2(p.r, p.y)), RADIAL_SEGMENTS);
  // LatheGeometry lays vertices out segment-major: index = segment · points + point
  const n = g.attributes.position.count;
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) ao[i] = PROFILE[i % PROFILE.length].ao;
  g.setAttribute("ao", new THREE.BufferAttribute(ao, 1));
  return g;
}

function core(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(CORE.r, CORE.widthSegments, CORE.heightSegments);
  const pos = g.attributes.position;
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    // how close the surface point sits to the nearest arm: 0.577 in a three-arm crotch,
    // 0.707 exactly between two arms, → 1 under an arm (hidden)
    const x = pos.getX(i) / CORE.r, y = pos.getY(i) / CORE.r, z = pos.getZ(i) / CORE.r;
    const s = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
    ao[i] = 0.65 + 0.05 * Math.min(1, Math.max(0, (s - 0.577) / (0.707 - 0.577)));
  }
  g.setAttribute("ao", new THREE.BufferAttribute(ao, 1));
  return g;
}

/**
 * One shared geometry for all twelve meshes (~7.2k triangles: 6 × 15 × 36 × 2 for the
 * arms plus the sphere), analytic normals kept — the only creases are the arm/core
 * intersections, which the bake darkens anyway.
 */
export function buildJackGeometry(): THREE.BufferGeometry {
  const parts = ARMS.map((turn) => {
    const g = arm();
    turn(g);
    return g;
  });
  parts.push(core());
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("jack geometry failed to merge");
  merged.computeBoundingSphere();
  return merged;
}
