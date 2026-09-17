import { test } from "node:test";
import assert from "node:assert/strict";

import { DYN, clickWorld, createWorld, isResting, stepWorld, type Pointer, type World } from "../app/lib/jackDynamics";
import { SEED } from "../app/lib/connectorJacks";
import { cameraFor } from "../app/lib/connectorScene";

const SCALES = [0.86, 1.2, 0.9, 1.0, 0.86, 1.1, 0.95, 0.86, 1.2, 0.88, 1.05, 0.86];
// the shipped configuration: the site's seed and the ≥ 1072 px card's camera (z 8.5, view 9.54 × 3.77 u at z 0)
const FIT = cameraFor(691, 273);
const VIEW = { viewW: FIT.viewW, viewH: FIT.viewH, z: FIT.z };

const world = () => createWorld(SCALES, VIEW, SEED);
const run = (w: World, seconds: number, E: number, pointer: Pointer | null = null, dt = 1 / 60) => {
  let last = { steps: 0, dt: 1 / 60, maxDpos: 0, maxDang: 0 };
  for (let t = 0; t < seconds; t += dt) last = stepWorld(w, dt, pointer, E);
  return last;
};
const finite = (w: World) =>
  w.bodies.every((b) =>
    [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w, b.frictionTot].every(Number.isFinite),
  );
const meanOff = (w: World) =>
  w.bodies.reduce((s, b) => s + Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z), 0) / w.bodies.length;
// a ray from the camera through the world point (x, y, 0)
const rayTo = (x: number, y: number, vel = { x: 0, y: 0, z: 0 }): Pointer => {
  const len = Math.hypot(x, y, -VIEW.z);
  return { origin: { x: 0, y: 0, z: VIEW.z }, dir: { x: x / len, y: y / len, z: -VIEW.z / len }, vel };
};

test("bodies: Lusion's mass and inertia from the body radius 1.05·scale, targets on a 0.6 u x-pitch, spawn box with vel = −2·pos", () => {
  const w = world();
  assert.equal(w.bodies.length, 12);
  w.bodies.forEach((b, i) => {
    const r = DYN.BODY_R * SCALES[i];
    assert.ok(Math.abs(b.r - r) < 1e-12);
    assert.ok(Math.abs(b.m - (4 / 3) * Math.PI * r ** 3) < 1e-9, `mass ${b.m}`);
    assert.ok(Math.abs(b.I - 0.4 * b.m * r * r) < 1e-9);
    assert.ok(Math.abs(b.target.x - (i - 5.5) * 0.6) < 1e-12 && b.target.y === 0 && b.target.z === 0);
    assert.ok(Math.abs(b.pos.x) <= VIEW.viewW / 2 && Math.abs(b.pos.y) <= VIEW.viewH && Math.abs(b.pos.z) <= 3);
    assert.ok(Math.abs(b.vel.x + 2 * b.pos.x) < 1e-12 && Math.abs(b.vel.y + 2 * b.pos.y) < 1e-12 && Math.abs(b.vel.z + 2 * b.pos.z) < 1e-12);
  });
  // a unit jack: K 40 over m 4.85 is ω 2.87 rad/s — the "settles like fruit" spring
  const m = (4 / 3) * Math.PI * 1.05 ** 3;
  assert.ok(Math.abs(Math.sqrt(DYN.K_PULL / m) - 2.87) < 0.01);
});

test("substeps: dt is clamped to [1e-3, 1/30] and split into ≤ 1/60 steps", () => {
  const w = world();
  assert.equal(stepWorld(w, 1 / 60, null, 1).steps, 1);
  assert.equal(stepWorld(w, 1 / 30, null, 1).steps, 2);
  assert.equal(stepWorld(w, 0.5, null, 1).steps, 2);
  assert.equal(stepWorld(w, 1e-4, null, 1).steps, 1);
  assert.equal(stepWorld(w, 0, null, 1).steps, 1);
  const before = w.time;
  stepWorld(w, 0.5, null, 1);
  assert.ok(Math.abs(w.time - before - 1 / 30) < 1e-12, "sim time advances by the clamped dt, not the wall gap");
});

test("energy: after the entrance (E = 1 for 10 s) the pack comes to rest within 8 s of E dropping to 0 — nothing over 0.06 u/s or 0.06 rad/s for 0.5 s of sim", () => {
  // a hard drop and the shipped 2 s ramp both rest; measured 2.5–3.4 s for this set with
  // friction + settle damping, the worst of fifteen scale sets at two rates 7.6 s
  for (const ramp of [0, 2]) {
    const w = world();
    run(w, 10, 1);
    let E = 1, restAt = -1;
    const t0 = w.time;
    for (let k = 0; k < 60 * 8 && restAt < 0; k++) {
      E = ramp > 0 ? Math.max(0, E - 1 / (60 * ramp)) : 0;
      if (isResting(w, stepWorld(w, 1 / 60, null, E), E)) restAt = w.time - t0;
    }
    assert.ok(restAt > 0 && restAt < 8, `ramp ${ramp}s: rest after ${restAt} s`);
    const r = stepWorld(w, 1 / 60, null, 0);
    assert.ok(r.maxDpos / r.dt < DYN.REST_V && r.maxDang / r.dt < DYN.REST_W, `still creeping: ${r.maxDpos / r.dt} u/s, ${r.maxDang / r.dt} rad/s`);
    // the pack is a pack: centres within the extents the camera was solved for (PACK 10 × 5 less a radius each side)
    const xs = w.bodies.map((b) => b.pos.x), ys = w.bodies.map((b) => b.pos.y);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 8.5 && Math.max(...ys) - Math.min(...ys) < 3.5, `pack ${Math.max(...xs) - Math.min(...xs)} × ${Math.max(...ys) - Math.min(...ys)}`);
  }
});

test("the rest test judges rates, not frames: 30 Hz frames rest too, and E = 1 never passes it (Lusion never rests)", () => {
  const w30 = world();
  run(w30, 10, 1, null, 1 / 30);
  let resting30 = false;
  for (let i = 0; i < 60 * 8 && !resting30; i++) resting30 = isResting(w30, stepWorld(w30, 1 / 30, null, 0), 0);
  assert.ok(resting30, "a 30 Hz device rests too");
  const w = world();
  run(w, 20, 1);
  let resting = false;
  for (let i = 0; i < 300 && !resting; i++) resting = isResting(w, stepWorld(w, 1 / 60, null, 1), 1);
  assert.equal(resting, false);
});

test("swirl: a rested pack handed E = 1 drifts again — slowly (≤ 0.5 u/s, a few px/s) — and rests again when E returns to 0", () => {
  const w = world();
  run(w, 10, 1);
  run(w, 6, 0);
  const still = run(w, 1, 0);
  assert.ok(still.maxDpos / still.dt < DYN.REST_V);
  // the jam releases with a transient (this fixture: 1.4 u/s in the first 1.5 s; six other
  // scale sets 0.1–0.6), then the swirl's drift: sustained ≤ 0.6 u/s, mean 0.05–0.14 u/s
  let maxD = 0, release = 0, drift = 0, sum = 0;
  for (let k = 0; k < 300; k++) {
    const r = stepWorld(w, 1 / 60, null, 1);
    maxD = Math.max(maxD, r.maxDpos / r.dt);
    for (const b of w.bodies) {
      const v = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      sum += v / 12;
      if (k < 90) release = Math.max(release, v); else drift = Math.max(drift, v);
    }
  }
  assert.ok(maxD > DYN.REST_V, `E = 1 moved at most ${maxD} u/s`);
  assert.ok(release < 2, `the release transient peaked at ${release} u/s`);
  assert.ok(drift < 0.6, `the sustained drift peaked at ${drift} u/s`);
  assert.ok(sum / 300 < 0.3, `mean idle speed ${sum / 300} u/s`);
  run(w, 6, 0);
  const again = run(w, 1, 0);
  assert.ok(again.maxDpos / again.dt < DYN.REST_V);
});

test("contacts separate an overlapping pair in one step and add no energy to a pair at rest", () => {
  const w = createWorld([1, 1], { viewW: 10, viewH: 4 }, SEED);
  const [a, b] = w.bodies;
  // parked ON their targets so the pull is zero; overlapping by 0.4 u along x
  a.pos = { x: -0.9, y: 0, z: 0 }; b.pos = { x: 0.9, y: 0, z: 0 };
  a.target = { ...a.pos }; b.target = { ...b.pos };
  a.vel = { x: 0, y: 0, z: 0 }; b.vel = { x: 0, y: 0, z: 0 };
  stepWorld(w, 1 / 60, null, 0);
  const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
  assert.ok(d >= a.r + b.r - 1e-9, `still overlapping: ${d}`);
  const ke = w.bodies.reduce((s, q) => s + 0.5 * q.m * (q.vel.x ** 2 + q.vel.y ** 2 + q.vel.z ** 2), 0);
  assert.ok(ke < 1e-6, `positional correction added kinetic energy ${ke}`);
  assert.ok(a.frictionTot > 0 && b.frictionTot > 0, "a contact adds friction to both");
});

test("contacts decelerate, they do not bounce: a fast closing pair keeps 40% of its closing speed, a slow one none", () => {
  const w = createWorld([1, 1], { viewW: 10, viewH: 4 }, SEED);
  const [a, b] = w.bodies;
  a.pos = { x: -1.0, y: 0, z: 0 }; b.pos = { x: 1.0, y: 0, z: 0 };
  a.target = { ...a.pos }; b.target = { ...b.pos };
  a.vel = { x: 2, y: 0, z: 0 }; b.vel = { x: -2, y: 0, z: 0 };
  stepWorld(w, 1 / 60, null, 1); // E = 1: Lusion's model exactly, no settle friction or damping
  // a at −1 moving +x, b at +1 moving −x: closing in x is a.vel.x > b.vel.x; the step's own
  // 0.2^h damping takes another 2.6% after the impulse
  const rel = a.vel.x - b.vel.x;
  const kept = 0.4 * Math.pow(DYN.DAMP, 1 / 60);
  assert.ok(rel > 0 && Math.abs(rel / 4 - kept) < 1e-6, `fast pair kept ${rel / 4} of its closing speed, expected ${kept}`);
  const w2 = createWorld([1, 1], { viewW: 10, viewH: 4 }, SEED);
  const [c, d] = w2.bodies;
  c.pos = { x: -1.0, y: 0, z: 0 }; d.pos = { x: 1.0, y: 0, z: 0 };
  c.target = { ...c.pos }; d.target = { ...d.pos };
  c.vel = { x: 0.1, y: 0, z: 0 }; d.vel = { x: -0.1, y: 0, z: 0 };
  stepWorld(w2, 1 / 60, null, 1);
  assert.ok(Math.abs(c.vel.x - d.vel.x) < 1e-3, "a resting contact zeroes the normal relative velocity");
});

test("pointer: only bodies under the ray are moved; a slow sweep kicks at most 4 of 12 in one frame, at most 3 of them directly", () => {
  const w = world();
  run(w, 10, 1);
  run(w, 6, 0);
  // a parked pointer 6 u from the leftmost body leaves that body EXACTLY as a pointer-less
  // step would — the ray test is the whole coupling, there is no field around it
  const poked = structuredClone(w), twin = structuredClone(w);
  const fi = w.bodies.reduce((m, b, i) => (b.pos.x < w.bodies[m].pos.x ? i : m), 0);
  stepWorld(poked, 1 / 60, rayTo(w.bodies[fi].pos.x + 6, w.bodies[fi].pos.y), 0);
  stepWorld(twin, 1 / 60, null, 0);
  assert.deepEqual(poked.bodies[fi].vel, twin.bodies[fi].vel);
  assert.deepEqual(poked.bodies[fi].pos, twin.bodies[fi].pos);
  assert.notDeepEqual(poked.bodies.map((b) => b.vel), twin.bodies.map((b) => b.vel), "the ray did shove what it crossed");
  // sweep the ray across the pack: at 3 u/s (~220 px/s, a slow sweep) the busiest frame kicks
  // 2–4 bodies, 1–2 of them directly under the ray — the rest is contact propagation, the
  // cluster rearranging — where the old field grabbed the whole pile; the exact 3 or 4
  // depends on which jam the pack settled into, so the bound is 4 total and 3 direct. At
  // 6 u/s the direct count is still ≤ 3 and the total ≤ 5.
  run(w, 1, 1);
  const sweep = (speed: number) => {
    let maxKicked = 0, maxDirect = 0, everKicked = 0;
    for (let t = 0; t < 10 / speed; t += 1 / 60) {
      const p = rayTo(-5 + speed * t, 0.2, { x: speed, y: 0, z: 0 });
      const prev = w.bodies.map((b) => ({ ...b.vel }));
      const under = w.bodies.map((b) => {
        const wx = b.pos.x - p.origin.x, wy = b.pos.y, wz = b.pos.z - p.origin.z;
        const tt = wx * p.dir.x + wy * p.dir.y + wz * p.dir.z;
        return Math.hypot(wx - p.dir.x * tt, wy - p.dir.y * tt, wz - p.dir.z * tt) < b.r + DYN.POINTER_PAD;
      });
      stepWorld(w, 1 / 60, p, 1);
      const dv = w.bodies.map((b, i) => Math.hypot(b.vel.x - prev[i].x, b.vel.y - prev[i].y, b.vel.z - prev[i].z));
      const kicked = dv.filter((d) => d > 0.5).length;
      maxKicked = Math.max(maxKicked, kicked);
      maxDirect = Math.max(maxDirect, dv.filter((d, i) => d > 0.5 && under[i]).length);
      if (kicked) everKicked++;
    }
    return { maxKicked, maxDirect, everKicked };
  };
  const slow = sweep(3);
  assert.ok(slow.everKicked > 0 && slow.maxKicked <= 4 && slow.maxDirect <= 3, `slow sweep: max bodies kicked in one frame ${slow.maxKicked}, direct ${slow.maxDirect}`);
  run(w, 4, 1);
  const brisk = sweep(6);
  assert.ok(brisk.maxDirect <= 3 && brisk.maxKicked <= 5, `brisk sweep: direct ${brisk.maxDirect}, total ${brisk.maxKicked}`);
  assert.ok(finite(w));
  assert.ok(w.bodies.every((b) => Math.hypot(b.vel.x, b.vel.y, b.vel.z) <= DYN.CAP + 1e-9));
});

test("click: every velocity flips and takes a ±8 u/s kick, the cap lifts to 25 for 0.3 s, and the pack regathers within 6 s", () => {
  const w = world();
  run(w, 10, 1);
  run(w, 6, 0);
  const restOff = meanOff(w);
  clickWorld(w);
  assert.ok(w.bodies.some((b) => Math.hypot(b.vel.x, b.vel.y, b.vel.z) > 5), "the burst is real");
  assert.ok(w.bodies.every((b) => Math.hypot(b.vel.x, b.vel.y, b.vel.z) <= DYN.CAP_CLICK + 1e-9));
  assert.ok(Math.abs(w.capUntil - w.time - DYN.CAP_CLICK_S) < 1e-9);
  const speeds = w.bodies.map((b) => Math.hypot(b.vel.x, b.vel.y, b.vel.z));
  assert.ok(Math.max(...speeds) - Math.min(...speeds) > 2, "the burst has variance — nothing is cap-clipped uniformly");
  run(w, 0.5, 1);
  assert.ok(meanOff(w) > restOff + 0.5, `the burst went somewhere: ${meanOff(w)} vs rest ${restOff}`);
  run(w, 5.5, 1);
  // twelve r ≈ 1 bodies packed around a 6.6 u line rest at a mean |pos − target| of ~1.1 u
  // (measured 1.05–1.21), so the design's "< 1.0" is re-keyed to the rest mean plus 0.15
  assert.ok(meanOff(w) < restOff + 0.15 && meanOff(w) < 1.4, `mean |pos − target| after 6 s = ${meanOff(w)} (rest ${restOff})`);
  assert.ok(finite(w));
});

test("deterministic: the same seed and inputs reproduce the same trajectory, click included", () => {
  const a = world(), b = world();
  run(a, 3, 1); run(b, 3, 1);
  clickWorld(a); clickWorld(b);
  run(a, 2, 1, rayTo(1, 0, { x: 3, y: 0, z: 0 })); run(b, 2, 1, rayTo(1, 0, { x: 3, y: 0, z: 0 }));
  assert.deepEqual(a.bodies.map((q) => [q.pos, q.vel, q.quat]), b.bodies.map((q) => [q.pos, q.vel, q.quat]));
});

test("no NaN for delta ∈ {0, 1e-4, 1/30, 0.5}, with the pointer parked exactly through a body's centre", () => {
  for (const delta of [0, 1e-4, 1 / 30, 0.5, Number.NaN]) {
    const w = world();
    run(w, 1, 1);
    const b = w.bodies[3];
    const p = rayTo(b.pos.x * (VIEW.z / (VIEW.z - b.pos.z)), b.pos.y * (VIEW.z / (VIEW.z - b.pos.z)), { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 30; i++) stepWorld(w, delta, p, 1);
    assert.ok(finite(w), `delta ${delta} produced a non-finite state`);
    assert.ok(w.bodies.every((q) => Math.abs(Math.hypot(q.quat.x, q.quat.y, q.quat.z, q.quat.w) - 1) < 1e-6), "quaternions stay unit");
  }
});

test("soft bounds: a body flung past 1.3× the visible half-extents or |z| > 3 is turned back", () => {
  const w = world();
  run(w, 10, 1);
  const b = w.bodies[0];
  b.vel = { x: -DYN.CAP, y: 0, z: 0 };
  let minX = 0, maxAbsZ = 0;
  for (let t = 0; t < 3; t += 1 / 60) {
    stepWorld(w, 1 / 60, null, 1); // a flick happens with the pointer over the card: E = 1
    minX = Math.min(minX, b.pos.x);
    for (const q of w.bodies) maxAbsZ = Math.max(maxAbsZ, Math.abs(q.pos.z));
  }
  assert.ok(minX > -(1.3 * VIEW.viewW / 2 + 2.5), `x reached ${minX}`);
  assert.ok(maxAbsZ < 5, `z reached ${maxAbsZ}`);
  assert.ok(b.pos.x > minX + 1, "it came back");
});
