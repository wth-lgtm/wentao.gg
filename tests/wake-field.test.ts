import { test } from "node:test";
import assert from "node:assert/strict";

import { WAKE, awake, brushRadiusTex, compositeAt, fieldScale, fieldSize, lifetimeS, paintOrDecay, perFrame, stepWeight } from "../app/lib/wakeField";

// the GitHub card's column at 1440: 691 × 273 CSS px
const CANVAS = { w: 691, h: 273 };
const FIELD = fieldSize(CANVAS.w, CANVAS.h);

test("the field is a quarter of the canvas's CSS size and its blurred copy an eighth — DPR is not an input", () => {
  assert.deepEqual(FIELD, { w: 172, h: 68, lowW: 86, lowH: 34 });
  assert.deepEqual(fieldSize(519, 273), { w: 129, h: 68, lowW: 64, lowH: 34 });
  assert.deepEqual(fieldSize(0, 0), { w: 1, h: 1, lowW: 1, lowH: 1 }, "a not-yet-measured canvas gets a 1×1 field, never a 0×0 target");
});

test("the reference's texel lengths scale by the field's height: 1 on Lusion's own 1440×900, 0.30 on the 273 px column", () => {
  assert.equal(fieldScale(fieldSize(1440, 900).h), 1);
  assert.ok(Math.abs(fieldScale(FIELD.h) - 68 / 225) < 1e-12);
  // the same column height at any width is the same scale
  assert.equal(fieldScale(fieldSize(519, 273).h), fieldScale(FIELD.h));
});

test("brush radius: 0..100 px per frame maps to 0..100 px of a 900 px reference, clamped, as field texels — 30 px on this column", () => {
  assert.equal(brushRadiusTex(0, FIELD.h), 0);
  // 50 px/frame → 50/900 of the field's height → 3.78 texels (15 CSS px)
  assert.ok(Math.abs(brushRadiusTex(50, FIELD.h) - (50 / 900) * 68) < 1e-9);
  // 100 and 400 px/frame are the same full brush: 7.56 texels, 30 CSS px, 11% of the column
  assert.equal(brushRadiusTex(100, FIELD.h), brushRadiusTex(400, FIELD.h));
  assert.ok(Math.abs(brushRadiusTex(100, FIELD.h) - (100 / 900) * 68) < 1e-9);
  // on the reference's own field the full brush is Lusion's 25 texels
  assert.ok(Math.abs(brushRadiusTex(100, fieldSize(1440, 900).h) - 25) < 1e-9);
  // a 200 px/s move at 60 Hz (3.3 px/frame) is a quarter texel: nothing is painted
  assert.equal(brushRadiusTex(3.33, FIELD.h), 0);
  // the brush appears at half a texel — 6.6 px/frame, 400 px/s — and is a hairline until a real flick
  assert.equal(brushRadiusTex(6.5, FIELD.h), 0);
  assert.ok(brushRadiusTex(6.7, FIELD.h) > 0.5);
  assert.ok(brushRadiusTex(25, FIELD.h) < 2, "1500 px/s: under two texels");
});

test("per-frame rates are frame-rate independent: 0.985 per 60 Hz frame reaches 1/e at the same sim time for dt 1/30, 1/60, 1/120", () => {
  const tau = 1 / (60 * -Math.log(WAKE.DECAY_LONG)); // 1.103 s
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    let v = 1, t = 0;
    while (v > 1 / Math.E) { v *= perFrame(WAKE.DECAY_LONG, dt); t += dt; }
    assert.ok(Math.abs(t - tau) <= dt, `dt ${dt}: 1/e at ${t.toFixed(4)} s, expected ${tau.toFixed(4)} ± ${dt}`);
    // and exactly one second of sim is exactly sixty 60 Hz frames' worth
    let p = 1;
    for (let i = 0; i < Math.round(1 / dt); i++) p *= perFrame(WAKE.DECAY_LONG, dt);
    assert.ok(Math.abs(p - Math.pow(WAKE.DECAY_LONG, 60)) < 1e-9);
  }
});

test("the weight bound reaches exactly zero — the floor is what ends the ribbon — at the same sim time at every frame rate", () => {
  const ref = lifetimeS(1 / 60);
  assert.ok(ref > 1.4 && ref < 1.7, `a fresh stroke's long weight lives ${ref.toFixed(3)} s; the brief wants ~1–1.5 s`);
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    let w = 1, t = 0, steps = 0;
    while (w > 0) { w = stepWeight(w, dt); t += dt; steps++; assert.ok(steps < 10000); }
    assert.equal(w, 0, "exactly zero, not a denormal — the loop's sleep test is w > 0");
    assert.ok(Math.abs(t - ref) <= 1 / 30, `dt ${dt}: zero at ${t.toFixed(3)} s vs ${ref.toFixed(3)} s`);
  }
});

test("the bound is a bound: the step is monotone in the weight and never below the texel it bounds", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    let prev = 0;
    for (let w = 0; w <= 1; w += 0.01) {
      const s = stepWeight(w, dt);
      assert.ok(s >= prev - 1e-12, "monotone");
      assert.ok(s <= w, "never grows without paint");
      assert.ok(s >= 0);
      prev = s;
    }
    assert.equal(stepWeight(0, dt), 0, "an empty field stays empty");
  }
});

test("awake: a painting frame or a live weight keeps the demand loop up; a still, empty field does not", () => {
  assert.equal(awake(0, 0), false);
  assert.equal(awake(0, 0.6), true, "the first frame of a stroke");
  assert.equal(awake(0.3, 0), true, "a decaying field");
  // a stroke: paint one frame, then let it decay — awake for its lifetime, asleep after, and never a flap
  let w = 0;
  const dt = 1 / 60;
  w = paintOrDecay(w, 12.4, dt);
  assert.equal(w, 1, "a painted frame is a full weight, not a decayed one (Lusion adds the brush after the dissipation)");
  let t = 0, wasAwake = true, sleptAt = -1;
  for (let i = 0; i < 400; i++) {
    w = paintOrDecay(w, 0, dt);
    t += dt;
    const a = awake(w, 0);
    if (!a && wasAwake) sleptAt = t;
    assert.ok(!(a && !wasAwake), "once asleep it does not wake without paint");
    wasAwake = a;
  }
  assert.ok(sleptAt > 1.4 && sleptAt < 1.7, `slept at ${sleptAt.toFixed(3)} s`);
  assert.equal(awake(w, 0), false);
});

test("composite at zero weight is a pass-through: no smear step, no fringe (the shader's uniform branch, mirrored)", () => {
  const texelPx = CANVAS.w / FIELD.w; // 4.02 CSS px per field texel
  const scale = fieldScale(FIELD.h);
  const rest = compositeAt([0.5, 0.5, 0, 0], texelPx, scale);
  assert.deepEqual([rest.weight, rest.vel, rest.stepPx, rest.fringe], [0, [0, 0], 0, 0]);
  // a stale velocity under a dead weight is also nothing — the weight multiplies everything
  const stale = compositeAt([0.9, 0.1, 0, 0], texelPx, scale);
  assert.deepEqual([stale.stepPx, stale.fringe], [0, 0]);
  // a fresh saturated stroke: 25 CSS px per tap on the reference (amount 20 / 4 × 1.25 × a 4 px paint texel), 7.6 px here
  const fresh = compositeAt([1, 0.5, 1, 1], texelPx, scale);
  assert.ok(Math.abs(fresh.stepPx - 25 * (texelPx / 4) * scale) < 1e-9);
  assert.ok(Math.abs(compositeAt([1, 0.5, 1, 1], 4, 1).stepPx - 25) < 1e-9, "Lusion's own: 25 px a tap");
  assert.equal(fresh.fringe, 0, "the fresh core (weight ≥ 0.4) has no rainbow; the fringe belongs to the aged edge");
  // the aged ribbon: weight 0.2 → the reversed smoothstep is up, the rainbow is on
  const aged = compositeAt([0.7, 0.5, 0.4, 0], texelPx, scale);
  assert.ok(aged.weight === 0.2 && aged.fringe > 0);
  // the fringe is bounded by edge(w)·1.25·w: under 0.019 for every field value — visible only added in linear light
  let peak = 0;
  for (let w = 0; w <= 1; w += 0.001) peak = Math.max(peak, compositeAt([1, 1, w, w], texelPx, scale).fringe);
  assert.ok(peak > 0.017 && peak < 0.019, `fringe peak ${peak.toFixed(4)}`);
});
