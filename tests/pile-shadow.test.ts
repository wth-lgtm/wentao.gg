import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { KEY_POSITION, SHADOW_AABB, lightSpace, shadowBoundsFor } from "../app/lib/pileShadow";

const corners = (aabb: { min: [number, number, number]; max: [number, number, number] }) => {
  const out: [number, number, number][] = [];
  for (const x of [aabb.min[0], aabb.max[0]]) for (const y of [aabb.min[1], aabb.max[1]]) for (const z of [aabb.min[2], aabb.max[2]]) out.push([x, y, z]);
  return out;
};

test("lightSpace matches three's shadow-camera lookAt convention", () => {
  const cam = new THREE.OrthographicCamera();
  cam.position.set(...KEY_POSITION);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  for (const c of corners(SHADOW_AABB)) {
    const t = new THREE.Vector3(...c).applyMatrix4(inv);
    const l = lightSpace(c, KEY_POSITION);
    assert.ok(Math.abs(l.x - t.x) < 1e-9 && Math.abs(l.y - t.y) < 1e-9 && Math.abs(l.depth + t.z) < 1e-9, `${c}: ${JSON.stringify(l)} vs ${t.toArray()}`);
  }
});

test("shadowBoundsFor encloses every AABB corner with the margin, and no more", () => {
  const b = shadowBoundsFor(KEY_POSITION, SHADOW_AABB, 0.2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minD = Infinity, maxD = -Infinity;
  for (const c of corners(SHADOW_AABB)) {
    const l = lightSpace(c, KEY_POSITION);
    assert.ok(l.x >= b.left && l.x <= b.right && l.y >= b.bottom && l.y <= b.top, `${c} outside the frustum: ${JSON.stringify(l)} in ${JSON.stringify(b)}`);
    assert.ok(l.depth >= b.near && l.depth <= b.far, `${c} outside near/far`);
    minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x);
    minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y);
    minD = Math.min(minD, l.depth); maxD = Math.max(maxD, l.depth);
  }
  assert.ok(Math.abs(b.left - (minX - 0.2)) < 1e-9 && Math.abs(b.right - (maxX + 0.2)) < 1e-9);
  assert.ok(Math.abs(b.bottom - (minY - 0.2)) < 1e-9 && Math.abs(b.top - (maxY + 0.2)) < 1e-9);
  assert.ok(Math.abs(b.near - (minD - 0.2)) < 1e-9 && Math.abs(b.far - (maxD + 0.2)) < 1e-9);
  // Measured for this key: x ±3.07, y −3.42..+5.18, depth 5.3..13.2 — a 6.2 × 8.6 u box on
  // a 1024² map is 166 × 119 texels/u. The tray's WORLD footprint (±3.9 × ±1.5) would have
  // left the far corners outside the map, rendering them unshadowed.
  const naiveMisses = corners(SHADOW_AABB).filter((c) => Math.abs(lightSpace(c, KEY_POSITION).y) > 1.5).length;
  assert.ok(naiveMisses >= 4, `${naiveMisses} corners outside the naive ±1.5 frustum`);
  assert.ok(b.top - b.bottom > b.right - b.left, "the light-space box is taller than wide, not 2.6:1");
  assert.ok(b.near > 0, "near must be positive for an orthographic depth camera");
});
