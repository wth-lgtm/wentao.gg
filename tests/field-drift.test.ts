import { test } from "node:test";
import assert from "node:assert/strict";

import { DRIFT, driftOffset } from "../app/lib/fieldDrift";
import { SEED_FIELD } from "../app/lib/fieldLayout";

const STEP = 0.05;
const T_END = 600;
const zero = () => ({ x: 0, y: 0, z: 0 });

test("DRIFT: the ruled numbers — 0.18 u in x and y, 0.10 in z, a 9–14 s swell and a 4–7 s ripple, 30 Hz while idle, 0.5 u/s the idle ceiling", () => {
  assert.equal(DRIFT.AMP, 0.18);
  assert.equal(DRIFT.AMP_Z, 0.1);
  assert.deepEqual(DRIFT.T_SLOW, [9, 14]);
  assert.deepEqual(DRIFT.T_FAST, [4, 7]);
  assert.equal(DRIFT.IDLE_HZ, 30);
  assert.equal(DRIFT.IDLE_V, 0.5);
});

test("bounded: over 600 s at 0.05 s steps |x|, |y| ≤ AMP and |z| ≤ AMP_Z for every body; the mean per axis is within 0.02·AMP of 0", () => {
  const out = zero();
  for (let k = 0; k < 16; k++) {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let t = 0; t <= T_END; t += STEP) {
      driftOffset(k, t, SEED_FIELD, out);
      assert.ok([out.x, out.y, out.z].every(Number.isFinite));
      assert.ok(Math.abs(out.x) <= DRIFT.AMP + 1e-12 && Math.abs(out.y) <= DRIFT.AMP + 1e-12, `body ${k} at ${t} s: (${out.x}, ${out.y})`);
      assert.ok(Math.abs(out.z) <= DRIFT.AMP_Z + 1e-12, `body ${k} at ${t} s: z ${out.z}`);
      sx += out.x; sy += out.y; sz += out.z; n++;
    }
    // the residual of a sine averaged over [0, 600] is ≤ 0.65·T/(600π) ≈ 0.005·A at T 14
    for (const [axis, s] of [["x", sx], ["y", sy], ["z", sz]] as const) assert.ok(Math.abs(s / n) < 0.02 * DRIFT.AMP, `body ${k} mean ${axis} ${s / n}`);
  }
});

test("the drift is used, not decorative: every body reaches at least half its amplitude on every axis within 600 s", () => {
  const out = zero();
  for (let k = 0; k < 16; k++) {
    let mx = 0, my = 0, mz = 0;
    for (let t = 0; t <= T_END; t += STEP) {
      driftOffset(k, t, SEED_FIELD, out);
      mx = Math.max(mx, Math.abs(out.x)); my = Math.max(my, Math.abs(out.y)); mz = Math.max(mz, Math.abs(out.z));
    }
    assert.ok(mx > 0.5 * DRIFT.AMP && my > 0.5 * DRIFT.AMP && mz > 0.5 * DRIFT.AMP_Z, `body ${k} reaches (${mx}, ${my}, ${mz})`);
  }
});

test("deterministic in (k, t, seed); the object handed in is the one returned; bodies 0 and 1 differ, and so does another seed", () => {
  const a = zero(), b = zero();
  for (const t of [0, 1.5, 37.25, 599.95]) {
    driftOffset(0, t, SEED_FIELD, a);
    driftOffset(0, t, SEED_FIELD, b);
    assert.deepEqual(a, b);
  }
  assert.equal(driftOffset(3, 12, SEED_FIELD, a), a, "no allocation: the caller's object comes back");
  let bodiesDiffer = 0, seedsDiffer = 0;
  for (let t = 0; t < 60; t += 0.5) {
    driftOffset(0, t, SEED_FIELD, a); driftOffset(1, t, SEED_FIELD, b);
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.01) bodiesDiffer++;
    driftOffset(0, t, SEED_FIELD + 1, b);
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.01) seedsDiffer++;
  }
  assert.ok(bodiesDiffer > 100, `bodies 0 and 1 differ at ${bodiesDiffer} of 120 samples`);
  assert.ok(seedsDiffer > 100, `seeds differ at ${seedsDiffer} of 120 samples`);
});

test("slow: the PER-AXIS finite-difference speed never exceeds A·2π·(0.65/T_SLOW[0] + 0.35/T_FAST[0]) — 0.18 u/s for x and y, 0.10 for z (the 3-D speed can reach ≈ 0.27, under IDLE_V 0.5)", () => {
  const bound = (A: number) => A * 2 * Math.PI * (0.65 / DRIFT.T_SLOW[0] + 0.35 / DRIFT.T_FAST[0]) + 1e-6;
  assert.ok(Math.abs(bound(DRIFT.AMP) - 0.1806) < 0.001, `${bound(DRIFT.AMP)} u/s`);
  assert.ok(Math.hypot(bound(DRIFT.AMP), bound(DRIFT.AMP), bound(DRIFT.AMP_Z)) < DRIFT.IDLE_V, "even every axis at its ceiling at once stays under the idle speed");
  const a = zero(), b = zero();
  let vmax = 0;
  for (let k = 0; k < 16; k++) {
    for (let t = 0; t < T_END; t += STEP) {
      driftOffset(k, t, SEED_FIELD, a);
      driftOffset(k, t + STEP, SEED_FIELD, b);
      const vx = Math.abs(b.x - a.x) / STEP, vy = Math.abs(b.y - a.y) / STEP, vz = Math.abs(b.z - a.z) / STEP;
      assert.ok(vx <= bound(DRIFT.AMP) && vy <= bound(DRIFT.AMP), `body ${k} at ${t} s: (${vx}, ${vy}) u/s`);
      assert.ok(vz <= bound(DRIFT.AMP_Z), `body ${k} at ${t} s: z ${vz} u/s`);
      vmax = Math.max(vmax, Math.hypot(vx, vy, vz));
    }
  }
  assert.ok(vmax < DRIFT.IDLE_V, `3-D drift speed ${vmax} u/s`);
});
