import { test } from "node:test";
import assert from "node:assert/strict";

import { PERF, createSampler, sampleFrame, stepsFor } from "../app/lib/scenePerf";

const frames = (n: number, dt: number) => Array.from({ length: n }, () => dt);

test("a fast GPU with a two-frame 150 ms shader-compile blip does not degrade", () => {
  assert.equal(stepsFor([...frames(10, 0.016), 0.15, 0.15, ...frames(60, 0.016)]), 0);
});

test("a 16 ms GPU never degrades, however long the entrance", () => {
  assert.equal(stepsFor(frames(600, 0.016)), 0);
});

test("a sustained 120 ms GPU degrades even though no frame ever enters the mean window", () => {
  assert.equal(stepsFor(frames(PERF.SLOW_LIMIT, 0.12)), 1);
  assert.equal(stepsFor(frames(PERF.SLOW_LIMIT - 1, 0.12)), 0);
});

test("a window whose mean is over 20 ms degrades", () => {
  assert.equal(stepsFor(frames(PERF.WINDOW, 0.025)), 1);
  assert.equal(stepsFor(frames(PERF.WINDOW, 0.019)), 0);
});

test("a hidden-tab gap is not a slow frame", () => {
  assert.equal(stepsFor([...frames(10, 0.016), 5, ...frames(10, 0.016), 30, ...frames(10, 0.016)]), 0);
});

test("degrading is monotone: at most MAX_STEPS steps, each trigger re-arms for the next, never more", () => {
  const s = createSampler();
  const fired: number[] = [];
  frames(200, 0.12).forEach((d, i) => { if (sampleFrame(s, d)) fired.push(i); });
  assert.deepEqual(fired, [PERF.SLOW_LIMIT - 1, 2 * PERF.SLOW_LIMIT - 1]);
  assert.equal(s.steps, PERF.MAX_STEPS);
  // the mean trigger also caps
  assert.equal(stepsFor(frames(10 * PERF.WINDOW, 0.03)), PERF.MAX_STEPS);
  // and the two triggers share the cap
  assert.equal(stepsFor([...frames(PERF.WINDOW, 0.03), ...frames(5 * PERF.SLOW_LIMIT, 0.12)]), PERF.MAX_STEPS);
});
