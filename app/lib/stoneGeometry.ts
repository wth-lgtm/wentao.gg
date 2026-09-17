// The stone: a soft octahedron — not Lusion's jack (the owner: "use a different object
// shape"), and not a sphere. Eight matte faces that each catch the one key differently as it
// tumbles, puffed toward the sphere so the edges are soft and the silhouette near-round; no
// bores, no arms, no per-vertex bake (convex). One shared geometry behind one import, so the
// shape can be flipped later without the scene knowing.
//
// three's OctahedronGeometry (PolyhedronGeometry) projects every subdivided vertex onto the
// unit sphere, so "blend toward the sphere" is done from the FLAT octahedron point, recovered
// as p̂ / (|x| + |y| + |z|) (the octahedron is the L1 unit ball): p' = mix(flat, p̂, BLEND). A
// face centre sits at 1/√3 = 0.577 and lands at 0.58·0.577 + 0.42 = 0.757; the six apices stay
// at 1, so the body sphere for the dynamics is R 1.0·scale and a contact shows at most 0.17 u
// of air in the worst orientation (an edge midpoint, 0.707 → 0.83).
//
// Detail: the brief wrote `OctahedronGeometry(1, 4)` AND "~1.3k triangles"; the two disagree
// (detail 4 is 200 triangles, 117 shared vertices — a visibly polygonal silhouette at the
// 150 px these stones reach). Detail 12 is 1352 triangles on 678 shared vertices, the ~1.3k, and is
// what ships. Vertices are welded (mergeVertices) before computeVertexNormals so the shading
// is smooth across a face and the eight edges read as soft creases, not 1352 flat facets —
// with the uv attribute dropped first: mergeVertices hashes every attribute, and the
// polyhedron's uv seams kept 31 duplicates (an apex as four vertices, 13 "apices" of 6) that
// would have shown as a normal seam down the stone. 678 shared vertices, none of them a seam.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const STONE = {
  /** OctahedronGeometry's subdivision: 8·(DETAIL + 1)² triangles */
  DETAIL: 12,
  /** how far the flat octahedron is pulled toward the unit sphere */
  BLEND: 0.42,
  /** the unit stone's collision radius — its apices lie on this sphere */
  R: 1.0,
} as const;

export function buildStoneGeometry(): THREE.BufferGeometry {
  const raw = new THREE.OctahedronGeometry(1, STONE.DETAIL);
  const pos = raw.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
    const fx = x / l1, fy = y / l1, fz = z / l1;
    pos.setXYZ(i, fx + (x - fx) * STONE.BLEND, fy + (y - fy) * STONE.BLEND, fz + (z - fz) * STONE.BLEND);
  }
  // weld the per-face duplicates (PolyhedronGeometry is non-indexed) so the normals average
  raw.deleteAttribute("uv");
  raw.deleteAttribute("normal");
  const g = mergeVertices(raw, 1e-4);
  raw.dispose();
  g.computeVertexNormals();
  return g;
}
