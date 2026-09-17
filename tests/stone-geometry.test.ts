import { test } from "node:test";
import assert from "node:assert/strict";

import { STONE, buildStoneGeometry } from "../app/lib/stoneGeometry";

test("the stone: 1352 triangles on 678 welded vertices at detail 12 — the brief's ~1.3k, smooth across a face, no uv seam", () => {
  const g = buildStoneGeometry();
  assert.ok(g.index, "indexed: the per-face duplicates are welded so normals average");
  assert.equal(g.index!.count / 3, 8 * (STONE.DETAIL + 1) ** 2);
  assert.equal(g.index!.count / 3, 1352);
  // 4·(DETAIL + 1)² + 2 unique vertices of a subdivided octahedron; a uv seam would leave 709
  assert.equal(g.getAttribute("position").count, 4 * (STONE.DETAIL + 1) ** 2 + 2);
  assert.equal(g.getAttribute("position").count, 678);
  assert.equal(g.getAttribute("uv"), undefined, "no uvs: nothing textures a stone");
});

test("radii: the six apices on the unit sphere, a face centre pulled to 0.757 by the 0.42 blend, everything within [0.75, 1]", () => {
  const g = buildStoneGeometry();
  const pos = g.getAttribute("position");
  let minR = Infinity, maxR = 0, apices = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, y, z);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    if ([x, y, z].filter((v) => Math.abs(v) > 1e-6).length === 1) apices++;
  }
  // the brief's [0.86, 1.0] assumed a smaller pull than its own 0.42 blend delivers: 1/√3 → 0.58·0.577 + 0.42 = 0.757
  assert.ok(minR >= 0.75 && minR <= 0.76, `min radius ${minR}`);
  assert.ok(Math.abs(maxR - 1) < 1e-6, `max radius ${maxR}`);
  assert.equal(apices, 6);
  assert.equal(STONE.R, 1.0);
});

test("normals are unit length and outward", () => {
  const g = buildStoneGeometry();
  const n = g.getAttribute("normal"), p = g.getAttribute("position");
  for (let i = 0; i < n.count; i++) {
    const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    assert.ok(Math.abs(len - 1) < 1e-6, `normal ${i} has length ${len}`);
    const dot = n.getX(i) * p.getX(i) + n.getY(i) * p.getY(i) + n.getZ(i) * p.getZ(i);
    assert.ok(dot > 0.5, `normal ${i} points inward or sideways (n·p ${dot})`);
  }
});
