import { test } from "node:test";
import assert from "node:assert/strict";

import { WAKE, awake, brushRadiusTex, brushSpeed, brushStrength, capsuleTouches, compositeAt, fieldScale, fieldSize, lifetimeS, perFrame, stepWeight, strokeBound } from "../app/lib/wakeField";

// the GitHub card's column at 1440: 691 × 273 CSS px
const CANVAS = { w: 691, h: 273 };
const FIELD = fieldSize(CANVAS.w, CANVAS.h);

test("the field is a quarter of the canvas's CSS size and its blurred copy an eighth — DPR is not an input", () => {
  assert.deepEqual(FIELD, { w: 172, h: 68, lowW: 86, lowH: 34 });
  assert.deepEqual(fieldSize(519, 273), { w: 129, h: 68, lowW: 64, lowH: 34 });
  assert.deepEqual(fieldSize(0, 0), { w: 1, h: 1, lowW: 1, lowH: 1 }, "a not-yet-measured canvas gets a 1×1 field, never a 0×0 target");
});

test("the reference's texel lengths scale by the field's height: REF_H 600 is 1.5 on Lusion's own 1440×900, 0.45 on the 273 px column", () => {
  assert.equal(fieldScale(fieldSize(1440, 900).h), 1.5);
  assert.ok(Math.abs(fieldScale(FIELD.h) - 68 / 150) < 1e-12);
  // the same column height at any width is the same scale
  assert.equal(fieldScale(fieldSize(519, 273).h), fieldScale(FIELD.h));
});

test("brush speed is px per 60 Hz frame from the frame's own travel: 120 Hz reads like 60, coalesced events sum, dt is floored at 1/240", () => {
  assert.equal(brushSpeed(40, 1 / 60), 40);
  assert.equal(brushSpeed(20, 1 / 120), 40, "half the travel a frame on a 120 Hz display is the same hand");
  assert.equal(brushSpeed(80, 1 / 30), 40, "two 60 Hz events landing in one 30 fps frame sum");
  assert.equal(brushSpeed(959, 1 / 30), 479.5, "the harness's 959 px flick under swiftshader's 1/30 clamp");
  assert.equal(brushSpeed(10, 1e-3), 40, "a 1 ms delta is not a frame: floored at 1/240");
  assert.equal(brushSpeed(0, 1 / 60), 0);
});

test("brush radius: the ramp starts at 20 px per frame (1200 px/s) and reaches the full 100 px brush at 100 — 45 px on this column", () => {
  assert.equal(brushRadiusTex(0, FIELD.h), 0);
  assert.equal(brushRadiusTex(3.33, FIELD.h), 0, "a 200 px/s move at 60 Hz paints nothing");
  assert.equal(brushRadiusTex(20, FIELD.h), 0, "the ramp's foot");
  // 25 px/frame (1500 px/s, an ordinary cursor crossing): 6.25 px → 0.71 texels, a hairline that carries almost no velocity
  assert.ok(Math.abs(brushRadiusTex(25, FIELD.h) - (6.25 / 600) * 68) < 1e-9);
  // 50 px/frame → 37.5 px → 4.25 texels (17 px); 100 and 400 px/frame are the same full brush, 11.3 texels = 45 px
  assert.ok(Math.abs(brushRadiusTex(50, FIELD.h) - (37.5 / 600) * 68) < 1e-9);
  assert.equal(brushRadiusTex(100, FIELD.h), brushRadiusTex(400, FIELD.h));
  assert.ok(Math.abs(brushRadiusTex(100, FIELD.h) - (100 / 600) * 68) < 1e-9);
  // on the reference's own field the full brush is 1.5 × Lusion's 25 texels
  assert.ok(Math.abs(brushRadiusTex(100, fieldSize(1440, 900).h) - 37.5) < 1e-9);
  // the half-texel floor: just above the ramp's foot the brush is too thin to draw
  assert.equal(brushRadiusTex(22, FIELD.h), 0);
  assert.ok(brushRadiusTex(24.5, FIELD.h) > 0.5);
});

test("brush strength: the velocity a brush carries ramps with the same speeds — nothing at 20, half at 60, all at 100", () => {
  assert.equal(brushStrength(0), 0);
  assert.equal(brushStrength(20), 0);
  assert.ok(Math.abs(brushStrength(25) - 0.0625) < 1e-12, "a 1500 px/s crossing injects a sixteenth of a flick's velocity");
  assert.equal(brushStrength(60), 0.5);
  assert.equal(brushStrength(100), 1);
  assert.equal(brushStrength(480), 1);
});

test("a capsule paints only if it can reach the canvas: a board flick far from the column arms nothing", () => {
  const [W, H] = [CANVAS.w, CANVAS.h];
  assert.equal(capsuleTouches(100, 100, 500, 120, 45, W, H), true, "inside");
  assert.equal(capsuleTouches(-400, 100, -60, 100, 45, W, H), false, "a flick over the board, 60 px short of the column with a 45 px brush");
  assert.equal(capsuleTouches(-400, 100, -30, 100, 45, W, H), true, "ending 30 px short: the brush reaches in");
  assert.equal(capsuleTouches(-30, 100, -30, 100, 45, W, H), true, "the stop frame's disc, just off the edge");
  assert.equal(capsuleTouches(-30, 100, -30, 100, 20, W, H), false, "the same disc with a thinner brush");
  assert.equal(capsuleTouches(200, -80, 300, -60, 45, W, H), false, "above the column");
  assert.equal(capsuleTouches(-100, 100, W + 100, 100, 45, W, H), true, "a flick right across it");
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
  assert.equal(awake(0, false), false);
  assert.equal(awake(0, true), true, "the first frame of a stroke");
  assert.equal(awake(0.3, false), true, "a decaying field");
  // a stroke: paint one frame, then let it decay — awake for its lifetime, asleep after, and never a flap
  let w = 0;
  const dt = 1 / 60;
  w = strokeBound(w, true, dt);
  assert.equal(w, 1, "a painted frame is a full weight, not a decayed one (Lusion adds the brush after the dissipation)");
  let t = 0, wasAwake = true, sleptAt = -1;
  for (let i = 0; i < 400; i++) {
    w = strokeBound(w, false, dt);
    t += dt;
    const a = awake(w, false);
    if (!a && wasAwake) sleptAt = t;
    assert.ok(!(a && !wasAwake), "once asleep it does not wake without paint");
    wasAwake = a;
  }
  assert.ok(sleptAt > 1.4 && sleptAt < 1.7, `slept at ${sleptAt.toFixed(3)} s`);
  assert.equal(awake(w, false), false);
});

test("the stop frame: a stroke [R, 0, 0, …] repaints a full disc on the frame after it stops (Lusion's from carries the previous radius), and the bound knows", () => {
  const dt = 1 / 60;
  const radii = [11.3, 0, 0, 0];
  let w = 0, prev = 0;
  const bounds: number[] = [];
  for (const r of radii) {
    // the GPU side's rule: this frame's capsule OR the previous frame's disc
    const painting = r > 0 || prev > 0;
    w = strokeBound(w, painting, dt);
    bounds.push(w);
    prev = r;
  }
  assert.equal(bounds[0], 1, "the stroke");
  assert.equal(bounds[1], 1, "the stop frame repaints the disc at weight 1 — the bound is 1, not 0.985");
  assert.ok(bounds[2] < 1 && bounds[2] > 0.98, "then it decays");
  assert.ok(bounds[3] < bounds[2]);
  // and the old rule would have been one step behind the shader on that frame
  assert.ok(strokeBound(1, false, dt) < 1);
});

test("composite at zero weight is a pass-through: no smear step, no fringe (the shader's uniform branch, mirrored)", () => {
  const texelPx = CANVAS.w / FIELD.w; // 4.02 CSS px per field texel
  const scale = fieldScale(FIELD.h);
  const rest = compositeAt([0.5, 0.5, 0, 0], texelPx, scale);
  assert.deepEqual([rest.weight, rest.vel, rest.stepPx, rest.fringe], [0, [0, 0], 0, 0]);
  // a stale velocity under a dead weight is also nothing — the weight multiplies everything
  const stale = compositeAt([0.9, 0.1, 0, 0], texelPx, scale);
  assert.deepEqual([stale.stepPx, stale.fringe], [0, 0]);
  // a fresh saturated stroke: 25 CSS px per tap on the reference (amount 20 / 4 × 1.25 × a 4 px paint texel), 11.4 px here
  const fresh = compositeAt([1, 0.5, 1, 1], texelPx, scale);
  assert.ok(Math.abs(fresh.stepPx - 25 * (texelPx / 4) * scale) < 1e-9);
  assert.ok(fresh.stepPx > 11 && fresh.stepPx < 12, `smear step ${fresh.stepPx.toFixed(2)} px a tap`);
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
