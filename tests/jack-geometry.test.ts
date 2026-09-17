import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { CORE, PROFILE, RADIAL_SEGMENTS, buildJackGeometry } from "../app/lib/jackGeometry";

test("the profile is Lusion's: arm r 0.333, bore r 0.10 to a floor at 0.667, rim at 1.0, flare 0.43 → 0.333 over 0.19 → 0.36", () => {
  const rim = PROFILE.find((p) => p.y === 1 && p.r > 0.3)!;
  assert.ok(rim && Math.abs(rim.r - 0.303) < 1e-9);
  assert.ok(PROFILE.filter((p) => p.r === 0.333).every((p) => p.y >= 0.36 && p.y <= 0.97));
  assert.ok(PROFILE.filter((p) => p.r === 0.1).every((p) => p.y >= 0.7 && p.y <= 0.97));
  assert.equal(PROFILE[PROFILE.length - 1].r, 0);
  assert.equal(PROFILE[PROFILE.length - 1].y, 0.667);
  assert.equal(PROFILE[0].r, 0.43);
  assert.equal(PROFILE[0].y, 0.19);
  // the flare sits inside the core, the fillet's end just outside it: the sphere is the junction
  assert.ok(Math.hypot(0.43, 0.19) < CORE.r && Math.hypot(0.333, 0.36) > CORE.r);
  // the bake: mouth 0.7 → floor 0.02, rim 1
  assert.equal(PROFILE.find((p) => p.r === 0.1 && p.y === 0.97)!.ao, 0.7);
  assert.equal(PROFILE[PROFILE.length - 1].ao, 0.02);
  assert.ok(PROFILE.some((p) => p.ao === 1));
});

test("the merged jack: six arms and a core, ~7k triangles, an `ao` attribute in [0.02, 1], analytic normals that agree with the winding", () => {
  const g = buildJackGeometry();
  const pos = g.attributes.position, nor = g.attributes.normal, ao = g.attributes.ao;
  assert.ok(pos && nor && ao, "position, normal and ao");
  const armVerts = (RADIAL_SEGMENTS + 1) * PROFILE.length;
  assert.equal(pos.count, 6 * armVerts + (CORE.widthSegments + 1) * (CORE.heightSegments + 1));
  const tris = g.index!.count / 3;
  assert.ok(tris > 6000 && tris < 8000, `${tris} triangles`);
  let lo = 1, hi = 0;
  for (let i = 0; i < ao.count; i++) { lo = Math.min(lo, ao.getX(i)); hi = Math.max(hi, ao.getX(i)); }
  assert.ok(Math.abs(lo - 0.02) < 1e-6 && Math.abs(hi - 1) < 1e-6, `ao range ${lo}..${hi}`);
  // arms reach 1.0 on every axis and nothing else does
  const bs = g.boundingSphere!;
  // the rim ring at (0.303, 1.0) is 1.045 from the centre — inside Lusion's 1.05 body radius
  assert.ok(Math.abs(bs.radius - Math.hypot(0.303, 1)) < 1e-3 && bs.radius < 1.05, `bounding radius ${bs.radius}`);
  // winding vs normals: the geometric normal of each non-degenerate triangle points the way
  // its vertices' analytic normals do (front faces are the visible ones — outer wall, tip
  // face, bore wall facing the axis, floor facing the mouth)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), vn = new THREE.Vector3();
  let agree = 0, checked = 0;
  const idx = g.index!;
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n.copy(b).sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) continue; // pole / degenerate
    vn.fromBufferAttribute(nor, i0).add(new THREE.Vector3().fromBufferAttribute(nor, i1)).add(new THREE.Vector3().fromBufferAttribute(nor, i2));
    checked++;
    if (n.dot(vn) > 0) agree++;
  }
  assert.ok(agree / checked > 0.99, `${agree}/${checked} triangles wind with their normals`);
  // the bore floor is a dark hole: every floor-centre vertex carries ao 0.02
  let floors = 0;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (Math.abs(r - 0.667) < 1e-6 && Math.abs(ao.getX(i) - 0.02) < 1e-6) floors++;
  }
  assert.equal(floors, 6 * (RADIAL_SEGMENTS + 1));
});
