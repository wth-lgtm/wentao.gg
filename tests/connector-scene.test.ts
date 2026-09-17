import { test } from "node:test";
import assert from "node:assert/strict";

import { CAMERA, COLUMN_MIN_PX, PANEL, PACK, cameraFor } from "../app/lib/connectorScene";

const TAN = Math.tan((CAMERA.FOV / 2) * Math.PI / 180);

test("the panel and the column gate are the constants the card reads", () => {
  assert.equal(PANEL, "#141518");
  assert.equal(COLUMN_MIN_PX, 340);
  assert.equal(CAMERA.FOV, 25);
});

test("691×273 (the ≥ 1072 px card): the width rule wants z 7.55, the clamp floor holds at 8.5", () => {
  const c = cameraFor(691, 273);
  assert.equal(c.z, CAMERA.Z_MIN);
  assert.equal(CAMERA.Z_MIN, 8.5);
  assert.ok(Math.abs(c.viewH - 2 * c.z * TAN) < 1e-9);
  assert.ok(Math.abs(c.viewW - c.viewH * (691 / 273)) < 1e-9);
  assert.ok(Math.abs(c.pxPerUnit - 273 / c.viewH) < 1e-9);
  // ~72.4 px/u: a 2.2 u jack at z 0 spans ~58% of the column, inside the reference's 45–63%
  const jackFrac = (2.2 * c.pxPerUnit) / 273;
  assert.ok(jackFrac > 0.45 && jackFrac < 0.63, `jack spans ${jackFrac} of the column`);
  // the pack overflows both axes: 10/9.54 wide, 5/3.77 tall
  assert.ok(PACK.w / c.viewW > 1.04 && PACK.h / c.viewH >= CAMERA.OVERFLOW);
});

test("520×273 (the fluid card) and 380×273: the height rule binds at z 9.56 and the pack overflows every side", () => {
  for (const w of [520, 380]) {
    const c = cameraFor(w, 273);
    assert.ok(Math.abs(c.z - PACK.h / CAMERA.OVERFLOW / (2 * TAN)) < 1e-9, `z at ${w} = ${c.z}`);
    assert.ok(Math.abs(c.z - 9.56) < 0.01);
    assert.ok(c.z >= CAMERA.Z_MIN && c.z <= CAMERA.Z_MAX);
    assert.ok(PACK.w / c.viewW >= CAMERA.OVERFLOW, `width overflow at ${w}: ${PACK.w / c.viewW}`);
    assert.ok(PACK.h / c.viewH >= CAMERA.OVERFLOW - 1e-9);
    const jackFrac = (2.2 * c.pxPerUnit) / 273;
    assert.ok(jackFrac > 0.45 && jackFrac < 0.63, `jack spans ${jackFrac} of the column at ${w}`);
  }
});

test("z stays in [9.5, 12.5] whatever the canvas; a tall one is still the height rule", () => {
  assert.equal(cameraFor(2000, 273).z, CAMERA.Z_MIN);
  const tall = cameraFor(300, 900);
  assert.ok(Math.abs(tall.z - PACK.h / CAMERA.OVERFLOW / (2 * TAN)) < 1e-9 && tall.z <= CAMERA.Z_MAX);
  assert.ok(cameraFor(0, 0).z >= CAMERA.Z_MIN && Number.isFinite(cameraFor(0, 0).viewW));
});
