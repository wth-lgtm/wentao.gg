import { test } from "node:test";
import assert from "node:assert/strict";

import { DYN, clickWorld, createWorld, isResting, setKeepOut, stepWorld, type Pointer, type World } from "../app/lib/jackDynamics";
import { SEED } from "../app/lib/connectorJacks";
import { cameraFor } from "../app/lib/connectorScene";
import { SEED_FIELD, fieldScales } from "../app/lib/fieldLayout";
import { packTargets } from "../app/lib/fieldPacks";

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

// ---- the keep-out band (added for the hero; the card passes no rects and is untouched) ----

// a keep-out box on the z = 0 plane: 6 u wide, 1.5 u tall, centred at (−4, 1) — a wordmark's worth
const BOX = { cx: -4, cy: 1, hw: 3, hh: 0.75 };
const clearanceTo = (x: number, y: number, r: number, k = BOX) => {
  const ex = Math.abs(x - k.cx) - k.hw, ey = Math.abs(y - k.cy) - k.hh;
  return Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - (r + DYN.KEEP_PAD);
};

test("keep-out: a fresh world has none; a body resting exactly BAND from the inflated box feels nothing, and one wandering beyond it steps EXACTLY as with no keep-out", () => {
  const w = createWorld([1, 0.9], { viewW: 24, viewH: 15 }, SEED);
  assert.deepEqual(w.keepOut, []);
  assert.equal(w.eyeZ, 0);
  // at rest exactly on the band's edge (a hero target's placement): E 0, on target, no velocity → no force
  setKeepOut(w, [BOX]);
  const edge = w.bodies[0];
  edge.pos = { x: -4, y: 1 - 0.75 - (edge.r + DYN.KEEP_PAD) - DYN.KEEP_BAND, z: 0 };
  edge.target = { ...edge.pos };
  edge.vel = { x: 0, y: 0, z: 0 };
  w.bodies[1].pos = { x: 8, y: 1, z: 0 }; w.bodies[1].target = { x: 8, y: 1, z: 0 }; w.bodies[1].vel = { x: 0, y: 0, z: 0 };
  assert.ok(Math.abs(clearanceTo(edge.pos.x, edge.pos.y, edge.r) - DYN.KEEP_BAND) < 1e-9);
  stepWorld(w, 1 / 60, null, 0);
  assert.deepEqual(edge.vel, { x: 0, y: 0, z: 0 }, "zero force at d = BAND");
  // wandering half a unit beyond the band, with a keep-out and without: identical trajectories
  const a = createWorld([1, 0.9], { viewW: 24, viewH: 15 }, SEED), twin = createWorld([1, 0.9], { viewW: 24, viewH: 15 }, SEED);
  for (const q of [a, twin]) {
    q.bodies[0].pos = { x: -4, y: 1 - 0.75 - (1.05 + DYN.KEEP_PAD) - DYN.KEEP_BAND - 0.5, z: 0 };
    q.bodies[1].pos = { x: 8, y: 1, z: 0 };
    q.bodies.forEach((b) => { b.target = { ...b.pos }; b.vel = { x: 0.3, y: 0.2, z: 0 }; });
  }
  setKeepOut(a, [BOX]);
  for (let i = 0; i < 30; i++) { stepWorld(a, 1 / 60, null, 1); stepWorld(twin, 1 / 60, null, 1); }
  assert.deepEqual(a.bodies.map((b) => [b.pos, b.vel]), twin.bodies.map((b) => [b.pos, b.vel]), "the band's force is identically zero outside it");
});

test("keep-out: a body launched at CAP toward the box stops inside the band — under 0.2 u into the inflated box — and comes back out", () => {
  const w = createWorld([1], { viewW: 24, viewH: 15 }, SEED);
  setKeepOut(w, [BOX]);
  const b = w.bodies[0];
  // resting under the box, just outside the band, then flung straight up at it
  b.pos = { x: -4, y: 1 - 0.75 - (1.05 + DYN.KEEP_PAD) - DYN.KEEP_BAND - 0.01, z: 0 };
  b.target = { ...b.pos };
  b.vel = { x: 0, y: DYN.CAP, z: 0 };
  let minD = Infinity, topY = -Infinity;
  for (let i = 0; i < 120; i++) {
    stepWorld(w, 1 / 60, null, 1); // a flick happens with the pointer over the hero: E = 1
    minD = Math.min(minD, clearanceTo(b.pos.x, b.pos.y, b.r));
    topY = Math.max(topY, b.pos.y);
  }
  assert.ok(minD < DYN.KEEP_BAND, "it did enter the band");
  assert.ok(minD > -0.2, `penetrated ${-minD} u into the inflated box`);
  assert.ok(b.pos.y < topY - 0.5 && b.vel.y < 0, "it turned and is on its way back");
  assert.ok(finite(w));
});

test("keep-out: the eye — a body is tested where the camera sees it: a z +3 body exactly BAND clear of an OFF-CENTRE box in world x projects 10% further from the centre, into the band", () => {
  // the hero's wordmark sits left of the canvas centre, like this box; a body between them and
  // nearer the camera is seen further left than its world x — over the letters sooner
  const k = { cx: -8, cy: 0, hw: 4, hh: 1 };
  const mk = (eyeZ: number) => {
    const w = createWorld([1], { viewW: 24, viewH: 15 }, SEED);
    setKeepOut(w, [k], eyeZ);
    const b = w.bodies[0];
    b.pos = { x: -8 + 4 + 1.05 + DYN.KEEP_PAD + DYN.KEEP_BAND, y: 0, z: 3 };
    b.target = { ...b.pos };
    b.vel = { x: 0, y: 0, z: 0 };
    stepWorld(w, 1 / 60, null, 0);
    return b.vel.x;
  };
  assert.ok(Math.abs(mk(0)) < 1e-12, "orthographic: exactly at the band's edge, no force");
  assert.ok(mk(32) > 0, "seen from a z 32 camera the disc is inside the band, and the push is away from the box (+x)");
});

test("keep-out: a body inside the box is pushed out along its nearest face, never through the far one", () => {
  const w = createWorld([1], { viewW: 24, viewH: 15 }, SEED);
  setKeepOut(w, [BOX]);
  const b = w.bodies[0];
  b.pos = { x: -4, y: 1 - 0.5, z: 0 }; // just under the centre line: the bottom face is nearest
  b.target = { ...b.pos };
  b.vel = { x: 0, y: 0, z: 0 };
  stepWorld(w, 1 / 60, null, 0);
  assert.ok(b.vel.y < 0 && b.vel.x === 0, `pushed (${b.vel.x}, ${b.vel.y}), wanted straight down`);
  assert.ok(Math.abs(-b.vel.y - DYN.K_KEEP / 60) < 0.05, `full strength inside: ${-b.vel.y} u/s per 1/60 step vs ${DYN.K_KEEP / 60}`);
});

test("keep-out: a box's strength scales the band — half strength, half the push — and createWorld takes the unit body radius", () => {
  const push = (strength?: number) => {
    const w = createWorld([1], { viewW: 24, viewH: 15 }, SEED);
    setKeepOut(w, [{ ...BOX, strength }]);
    const b = w.bodies[0];
    b.pos = { x: -4, y: 1 - 0.5, z: 0 }; b.target = { ...b.pos }; b.vel = { x: 0, y: 0, z: 0 };
    stepWorld(w, 1 / 60, null, 0);
    return -b.vel.y;
  };
  assert.ok(Math.abs(push(0.5) / push() - 0.5) < 1e-9, `half strength pushed ${push(0.5)} vs full ${push()}`);
  assert.equal(push(undefined), push(1));
  const other = createWorld([1, 0.72], { viewW: 24, viewH: 15 }, SEED, 1.0);
  assert.equal(other.bodies[0].r, 1.0);
  assert.ok(Math.abs(other.bodies[1].r - 0.72) < 1e-12);
  assert.ok(Math.abs(other.bodies[0].m - (4 / 3) * Math.PI) < 1e-9, "mass follows the radius passed");
  const jacks = createWorld([1], { viewW: 24, viewH: 15 }, SEED);
  assert.equal(jacks.bodies[0].r, DYN.BODY_R, "the card's default is untouched");
});

test("keep-out under a click burst: with the cap LIFTED (capUntil ahead, as clickWorld leaves it) a 25 u/s body reaches 0.40–0.46 u from the band's edge, 0.57–0.59 from mid-band, ~0.92 parked; clipped to 20 it would read 0.10–0.14", () => {
  const launch = (scale: number, startD: number, lift: boolean) => {
    const w = createWorld([scale], { viewW: 24, viewH: 15 }, SEED);
    setKeepOut(w, [BOX]);
    const b = w.bodies[0];
    b.pos = { x: -4, y: 1 - 0.75 - (b.r + DYN.KEEP_PAD) - startD, z: 0 };
    b.target = { ...b.pos };
    b.vel = { x: 0, y: DYN.CAP_CLICK, z: 0 };
    if (lift) w.capUntil = w.time + DYN.CAP_CLICK_S;
    let minD = Infinity, vmax = 0;
    for (let i = 0; i < 120; i++) { stepWorld(w, 1 / 60, null, 1); minD = Math.min(minD, clearanceTo(b.pos.x, b.pos.y, b.r)); vmax = Math.max(vmax, Math.hypot(b.vel.x, b.vel.y, b.vel.z)); }
    return { pen: -minD, vmax };
  };
  for (const s of [0.86, 1, 1.2]) {
    const edge = launch(s, DYN.KEEP_BAND + 0.01, true), mid = launch(s, DYN.KEEP_BAND / 2, true), parked = launch(s, 0.05, true);
    assert.ok(edge.vmax > DYN.CAP + 1, `the cap was lifted: peak ${edge.vmax} u/s`);
    assert.ok(edge.pen > 0.38 && edge.pen < 0.48, `scale ${s} from the band's edge: ${edge.pen} u`);
    assert.ok(mid.pen > 0.55 && mid.pen < 0.62, `scale ${s} from mid-band: ${mid.pen} u`);
    assert.ok(parked.pen > 0.88 && parked.pen < 0.95, `scale ${s} parked at the inflated edge: ${parked.pen} u`);
    assert.ok(edge.pen < mid.pen && mid.pen < parked.pen, "less run-up, deeper");
    // the clipped launch the earlier comments described, kept as the contrast
    const clipped = launch(s, DYN.KEEP_BAND + 0.01, false);
    assert.ok(clipped.vmax <= DYN.CAP + 1e-6 && clipped.pen > 0.09 && clipped.pen < 0.15, `clipped: ${clipped.pen} u at ${clipped.vmax} u/s`);
  }
});

// ---- the swirl's pivot and gain (added for the hero's packs; the card sets neither) ----

// The card's twelve after 300 substeps at E = 1, captured from 7e3f48d (the parent of this round) by
// tests' own `world()` — pos, vel, quat per body. The pivot/gain code path must reproduce it bit for bit.
const SWIRL_FIXTURE_7E3F48D: readonly (readonly number[])[] = [
  [-3.7462556861633356, -0.39671679863730275, 0.16282320907672249, 0.03581483977692924, 0.05833497039306969, 0.12543186570710108, 0.7640641105753725, 0.5376677197397137, 0.0562757333033817, -0.35206888519397506],
  [-2.6039076638291068, 0.8179331630656957, -1.218000146154203, 0.03846894128918276, -0.08213558747357148, 0.016921498438362277, 0.5073113427331682, -0.5114534770272898, 0.32526182466521425, -0.612580841837566],
  [-1.9979857140931845, -0.9574506875429227, -0.059753996413479275, 0.056804097447532675, 0.04895934570792369, 0.1441520408439128, 0.16035014032147957, -0.4312886520641281, -0.8852409907718394, -0.06801705195670807],
  [-2.3669361513835194, 0.6443250324025942, 1.073372905624727, 0.06684130047937205, 0.12806816364132276, 0.0326611066122137, -0.3005088562709337, 0.044170336324412626, 0.25511585805446624, -0.9179647638449187],
  [-0.7011963606146306, 1.3185651710367365, 0.3077982423396425, 0.04889390533497907, -0.05348018665503519, -0.2148604760312716, -0.12430361619949334, -0.5966976043544377, -0.07186857462295768, -0.7895159833335031],
  [-0.47709116776873023, -0.46903815071591937, 1.302482446532824, 0.06539817155864455, 0.10006206140608755, 0.05359806761733825, -0.35363787791804446, 0.11546347832030524, -0.7496980361127822, 0.5473219264056908],
  [0.5679629633356091, -0.8942139418370652, -0.5301936017203102, -0.12069796958455227, -0.0088500750190852, 0.03207239365254289, -0.4653889771668897, -0.43933815467272724, -0.7542677313856678, -0.14654444776461903],
  [0.9894445007167287, 0.6861757032685419, 0.4373062830327833, 0.010640673960595289, 0.013862473255474081, -0.0675648746596398, -0.7239978631852225, -0.5525101828453644, 0.14306296113864447, -0.38741783787747397],
  [2.3679273119530873, 0.511043816062973, -1.2221859353979256, 0.12287959943089666, -0.01629406575745482, 0.002243085189361269, 0.4679715437041453, -0.7770873889733658, 0.4196044193370921, -0.032710173562638264],
  [0.21354497148911059, 0.8692104983538873, -1.2075289976197563, 0.12487131736097153, 0.002291787498619882, -0.1367961610711743, 0.66684702582741, 0.18757055389567512, -0.4950467602365138, 0.5244626170050053],
  [2.8841799991954455, 0.9456809894053246, 1.0410120951521333, 0.00986365778472547, -0.11866105341424692, -0.017592365331246963, -0.9070055639891667, 0.15939873870785518, -0.3788400499994196, 0.09172330951004502],
  [3.6269472314185425, -0.6580004564421696, 0.09309307648629107, 0.22461780337635942, 0.00506673239170971, -0.05974895193140336, -0.9626538378084353, 0.24721123475479484, -0.0622473436439111, -0.09115625142017071]
];

test("the swirl without a pivot is today's, bit for bit: the card's twelve stepped 300 substeps at E = 1 equal the fixture captured from 7e3f48d, and createWorld sets neither pivot nor gain", () => {
  const w = world();
  for (let i = 0; i < 300; i++) stepWorld(w, 1 / 60, null, 1);
  w.bodies.forEach((b) => { assert.equal(b.pivot, undefined); assert.equal(b.swirlGain, undefined); });
  const rows = w.bodies.map((b) => [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w]);
  assert.deepEqual(rows, SWIRL_FIXTURE_7E3F48D);
  assert.ok(Math.abs(w.time - 5) < 1e-9);
  // and an explicit gain of 1 with an origin pivot is the same arithmetic
  const twin = world();
  twin.bodies.forEach((b) => { b.pivot = { x: 0, y: 0, z: 0 }; b.swirlGain = 1; });
  for (let i = 0; i < 300; i++) stepWorld(twin, 1 / 60, null, 1);
  assert.deepEqual(twin.bodies.map((b) => [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z]), rows.map((r) => r.slice(0, 6)));
});

// fourteen bodies pulled to a Fermat spiral on a 2 u disc about (px, py, 0): 10 s at E = 1 to settle,
// then 2 s at E = 1 measured — the pack's mean displacement, its members' mean speed, mean |pos − target|
function packRun(px: number, py: number, pivot: boolean) {
  const n = 14;
  const scales = fieldScales(n, SEED_FIELD);
  const targets = packTargets({ viewW: 2 * Math.abs(px), viewH: 2 * Math.abs(py) }, [{ cx: Math.sign(px), cy: Math.sign(py), n, r: 2, swirlGain: 1 }], SEED_FIELD);
  const w = createWorld(scales, { viewW: 24, viewH: 15 }, SEED);
  w.bodies.forEach((b, i) => { b.target = { ...targets[i] }; if (pivot) b.pivot = { x: px, y: py, z: 0 }; });
  const mean = () => { const c = { x: 0, y: 0, z: 0 }; for (const b of w.bodies) { c.x += b.pos.x / n; c.y += b.pos.y / n; c.z += b.pos.z / n; } return c; };
  run(w, 10, 1);
  const m0 = mean();
  let speed = 0, spread = 0;
  for (let k = 0; k < 120; k++) {
    stepWorld(w, 1 / 60, null, 1);
    for (const b of w.bodies) { speed += Math.hypot(b.vel.x, b.vel.y, b.vel.z) / (120 * n); spread += Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z) / (120 * n); }
  }
  const m1 = mean();
  assert.ok(finite(w));
  return { moved: Math.hypot(m1.x - m0.x, m1.y - m0.y, m1.z - m0.z), speed, spread, meanR: Math.hypot(m1.x, m1.y) };
}

test("the swirl about a pack's PIVOT is a rotation of the pack about itself: fourteen on a 2 u disc at the h1-side pack's place (−5.5, 4.5, 0) — 10 s at E = 1, then over 2 s the pack's mean moves < 0.1 u while its members average ≥ 0.08 u/s (the card's 0.113); the ORIGIN swirl on the same set 7 u out is a per-body shear that churns it (0.40 u/s), drags it (0.16 u) and spreads it wider (1.09 vs 0.73)", () => {
  const piv = packRun(-5.5, 4.5, true), org = packRun(-5.5, 4.5, false);
  assert.ok(piv.moved < 0.1, `with the pivot the pack's mean moved ${piv.moved} u in 2 s`);
  assert.ok(piv.speed >= 0.08, `with the pivot the members average ${piv.speed} u/s`);
  assert.ok(Math.abs(org.meanR - Math.hypot(5.5, 4.5)) < 0.3, `the origin-swirled pack sits ${org.meanR} u from the origin`);
  assert.ok(piv.spread < org.spread, `pivot spread ${piv.spread} vs origin ${org.spread}`);
  assert.ok(org.speed > 2 * piv.speed, `the origin shear churns: ${org.speed} vs ${piv.speed} u/s`);
  assert.ok(org.moved > piv.moved, `the origin shear drags the pack: ${org.moved} vs ${piv.moved} u`);
});

test("the origin swirl's effect depends on WHERE a pack sits — it is 1 − |â·p̂| about (1,1,1), a fifth as strong at (5, 3) (along 0.79) as at (−5.5, 4.5) (along 0.08) — while the pivot swirl reads the same pack the same way anywhere: mean still < 0.1 u, members ≥ 0.08 u/s, the pack 5.8 u from the origin", () => {
  const AXIS = 1 / Math.sqrt(3);
  const along = (x: number, y: number) => Math.abs((x + y) * AXIS) / Math.hypot(x, y);
  assert.ok(along(5, 3) > 0.75 && along(-5.5, 4.5) < 0.1, `along ${along(5, 3)} / ${along(-5.5, 4.5)}`);
  const piv = packRun(5, 3, true), org = packRun(5, 3, false);
  assert.ok(Math.abs(org.meanR - Math.hypot(5, 3)) < 0.3, `the pack sits ${org.meanR} u from the origin`);
  assert.ok(piv.moved < 0.1 && piv.speed >= 0.08, `pivot at (5, 3): moved ${piv.moved} u, ${piv.speed} u/s`);
  // the attenuated origin swirl here is quieter than the full shear at (−5.5, 4.5) by more than 2×
  const far = packRun(-5.5, 4.5, false);
  assert.ok(far.speed > 2 * org.speed, `origin swirl: ${far.speed} u/s at (−5.5, 4.5) vs ${org.speed} at (5, 3)`);
});
