import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMERA,
  WORLD,
  capsFor,
  driftPoses,
  fitCamera,
  frameTopY,
  mouthFor,
  poseFor,
  projectNdc,
  sceneVertices,
} from "../app/lib/pileScene";

// The card's tray column is 273 px tall at every viewport that mounts it (column 1's stack);
// its width runs from ~380 px (fluid card) to 691 px (max-w-5xl).
const ASPECTS = [1.6, 2.0, 2.53, 2.7];

test("fitCamera keeps every scene vertex inside the frame at every drift pose", () => {
  for (const aspect of ASPECTS) {
    const fit = fitCamera(aspect, 273);
    const legend = CAMERA.LEGEND_PX / (273 / 2);
    const bottom = CAMERA.BOTTOM_PX / (273 / 2);
    const rest = poseFor(fit.distance);
    for (const v of sceneVertices()) {
      assert.ok(Math.abs(projectNdc(v, rest, aspect).x) <= CAMERA.WIDTH_FILL + 1e-9, `aspect ${aspect}: rest x at ${JSON.stringify(v)}`);
    }
    for (const pose of driftPoses(fit.distance)) {
      for (const v of sceneVertices()) {
        const n = projectNdc(v, pose, aspect);
        // composition (84%) is a rest-pose choice; under drift only the clip edge matters
        assert.ok(Math.abs(n.x) <= 1 - 0.05, `aspect ${aspect}: x ${n.x} at ${JSON.stringify(v)}`);
        assert.ok(n.y <= 1 - legend + 1e-9, `aspect ${aspect}: y ${n.y} over the legend reserve at ${JSON.stringify(v)}`);
        assert.ok(n.y >= -1 + bottom - 1e-9, `aspect ${aspect}: y ${n.y} under the bottom breath at ${JSON.stringify(v)}`);
        assert.ok(n.depth >= CAMERA.NEAR && n.depth <= CAMERA.FAR, `aspect ${aspect}: depth ${n.depth} outside near/far`);
      }
    }
    assert.ok(fit.headroomOk, `aspect ${aspect}: headroom`);
  }
});

test("fitCamera: the width rule binds at the live 1440 px tray and the fit is width-tight", () => {
  const fit = fitCamera(691 / 273, 273);
  // Re-keyed by measurement: the design expected ≈ 91 px/u (d ≈ 12.7); the 84% width rule
  // measured at the slab's front-bottom corners puts the camera at d ≈ 16.6 → ≈ 72 px/u.
  assert.ok(fit.distance >= fit.dWidth - 1e-9 && fit.distance >= fit.dHeight - 1e-9);
  assert.ok(Math.abs(fit.distance - fit.dWidth) < 1e-6, `width-limited: d ${fit.distance} vs dWidth ${fit.dWidth}`);
  assert.ok(fit.pxPerUnit > 69 && fit.pxPerUnit < 75, `px/u ${fit.pxPerUnit}`);
  // the widest projected point sits exactly at the 84% line
  let maxX = 0;
  for (const v of sceneVertices()) maxX = Math.max(maxX, Math.abs(projectNdc(v, poseFor(fit.distance), fit.aspect).x));
  assert.ok(Math.abs(maxX - CAMERA.WIDTH_FILL) < 1e-6, `tray spans ${maxX}`);
  // a narrower tray column is farther away, and px/u falls with it
  const narrow = fitCamera(520 / 273, 273);
  assert.ok(narrow.distance > fit.distance && narrow.pxPerUnit < fit.pxPerUnit);
});

test("frameTopY agrees with the projection and rises toward the front", () => {
  const fit = fitCamera(2.53, 273);
  const pose = poseFor(fit.distance);
  for (const z of [-WORLD.D / 2, 0, WORLD.D / 2, WORLD.D / 2 + WORLD.LIP]) {
    const y = frameTopY(fit.distance, z);
    const n = projectNdc({ x: 0, y, z }, pose, 2.53);
    assert.ok(Math.abs(n.y - 1) < 1e-9, `top edge at z ${z}: ndc ${n.y}`);
  }
  assert.ok(frameTopY(fit.distance, WORLD.D / 2) > frameTopY(fit.distance, -WORLD.D / 2));
});

test("the mouth is above the frame over every lane and the park stays out of sight", () => {
  for (const aspect of ASPECTS) {
    const fit = fitCamera(aspect, 273);
    const mouth = mouthFor(fit, 0.55);
    for (const z of WORLD.LANES) assert.ok(mouth > frameTopY(fit.distance, z + WORLD.LANE_JITTER), `aspect ${aspect} lane ${z}`);
    assert.ok(mouth > WORLD.CREST + 1);
  }
});

test("capsFor: a capped hop from the crest at the back wall stays under the frame's top edge", () => {
  for (const aspect of ASPECTS) {
    const fit = fitCamera(aspect, 273);
    const { vCap, wCap, rise } = capsFor(fit, 0.55);
    const top = frameTopY(fit.distance, -WORLD.D / 2);
    assert.ok(WORLD.CREST + (vCap * vCap) / (2 * WORLD.G) <= top + 1e-9, `aspect ${aspect}: rise ${rise} vs headroom ${top - WORLD.CREST}`);
    assert.ok(Math.abs(wCap - vCap / (1.035 * 0.55)) < 1e-9);
    assert.ok(vCap > 4 && vCap < 20, `vCap ${vCap}`);
  }
});
