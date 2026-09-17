import { test } from "node:test";
import assert from "node:assert/strict";

import { WAKE, awake, brushRadiusTex, brushSpeed, compositeAt, fieldSize, lifetimeS, paintOrDecay, perFrame, stepWeight } from "../app/lib/wakeField";

// the GitHub card's column at 1440: 691 × 273 CSS px
const CANVAS = { w: 691, h: 273 };
const FIELD = fieldSize(CANVAS.w, CANVAS.h);

test("the field is a quarter of the canvas's CSS size and its blurred copy an eighth — DPR is not an input", () => {
  assert.deepEqual(FIELD, { w: 172, h: 68, lowW: 86, lowH: 34 });
  assert.deepEqual(fieldSize(519, 273), { w: 129, h: 68, lowW: 64, lowH: 34 });
  assert.deepEqual(fieldSize(0, 0), { w: 1, h: 1, lowW: 1, lowH: 1 }, "a not-yet-measured canvas gets a 1×1 field, never a 0×0 target");
});

test("brush radius: 0..100 px per 60 Hz frame maps to 0..100 px, clamped, scaled by the canvas height into field texels", () => {
  assert.equal(brushRadiusTex(0, CANVAS.h, FIELD.h), 0);
  // 50 px/frame → 50 px → 50/273 of the canvas height → 12.45 texels of the 68-texel field
  assert.ok(Math.abs(brushRadiusTex(50, CANVAS.h, FIELD.h) - (50 / 273) * 68) < 1e-9);
  // 100 and 400 px/frame are the same full brush
  assert.equal(brushRadiusTex(100, CANVAS.h, FIELD.h), brushRadiusTex(400, CANVAS.h, FIELD.h));
  assert.ok(Math.abs(brushRadiusTex(100, CANVAS.h, FIELD.h) - (100 / 273) * 68) < 1e-9);
  // a slow move is a hairline (200 px/s at 60 Hz = 3.3 px/frame → 0.83 texels), a crawl is nothing
  assert.ok(brushRadiusTex(3.33, CANVAS.h, FIELD.h) > 0.8 && brushRadiusTex(3.33, CANVAS.h, FIELD.h) < 0.85);
  assert.equal(brushRadiusTex(1, CANVAS.h, FIELD.h), 0, "a brush thinner than half a texel cannot be drawn and paints nothing");
  // the same speed on the 519 px column paints the same fraction of the canvas height
  assert.ok(Math.abs(brushRadiusTex(50, 273, fieldSize(519, 273).h) - brushRadiusTex(50, CANVAS.h, FIELD.h)) < 1e-9);
});

test("brush speed is px per 60 Hz frame: the faster of the pointer's own event reading and the frame's travel normalised to 60 Hz", () => {
  // a rAF-aligned pointer at 60 Hz: one event per frame, both readings agree
  assert.equal(brushSpeed(40, 40, 1 / 60), 40);
  // a 120 Hz display: half the travel per frame, so the frame reading is doubled back to the 60 Hz figure
  assert.equal(brushSpeed(20, 20, 1 / 120), 40);
  // a 30 fps GPU under a 60 Hz pointer: two events per frame, the frame's travel is halved
  assert.equal(brushSpeed(40, 80, 1 / 30), 40);
  // a burst of events inside one frame (a harness, or an uncoalesced mouse): the event reading wins
  assert.equal(brushSpeed(158, 950, 1 / 30), 475);
  assert.equal(brushSpeed(0, 0, 1 / 60), 0);
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
  const rest = compositeAt([0.5, 0.5, 0, 0], texelPx);
  assert.deepEqual([rest.weight, rest.vel, rest.stepPx, rest.fringe], [0, [0, 0], 0, 0]);
  // a stale velocity under a dead weight is also nothing — the weight multiplies everything
  const stale = compositeAt([0.9, 0.1, 0, 0], texelPx);
  assert.deepEqual([stale.stepPx, stale.fringe], [0, 0]);
  // a fresh saturated stroke: 25 CSS px per tap (Lusion: amount 20 / 4 × multiplier 1.25 × a 4 px paint texel)
  const fresh = compositeAt([1, 0.5, 1, 1], texelPx);
  assert.ok(Math.abs(fresh.stepPx - 25 * texelPx / 4) < 1e-9);
  assert.equal(fresh.fringe, 0, "the fresh core (weight ≥ 0.4) has no rainbow; the fringe belongs to the aged edge");
  // the aged ribbon: weight 0.2 → the reversed smoothstep is up, the rainbow is on
  const aged = compositeAt([0.7, 0.5, 0.4, 0], texelPx);
  assert.ok(aged.weight === 0.2 && aged.fringe > 0);
  // a slow sweep's hairline (velocity 0.011 at full weight) smears about half a pixel per tap
  const slow = compositeAt([0.511, 0.5, 1, 1], texelPx);
  assert.ok(slow.stepPx > 0.4 && slow.stepPx < 0.7, `slow sweep smear ${slow.stepPx.toFixed(3)} px per tap`);
});
