import { test } from "node:test";
import assert from "node:assert/strict";

import { createStepper, onFrame, setScheduler, type FrameData } from "../app/lib/frame";

test("phases run in order within one frame: setup → read → update → render → postRender", () => {
  const s = createStepper();
  setScheduler(s);
  const order: string[] = [];
  onFrame("render", () => order.push("render"));
  onFrame("postRender", () => order.push("postRender"));
  onFrame("setup", () => order.push("setup"));
  onFrame("read", () => order.push("read"));
  onFrame("update", () => order.push("update"));
  s.step(16);
  assert.deepEqual(order, ["setup", "read", "update", "render", "postRender"]);
  setScheduler(null);
});

test("the same callback requested twice before it runs runs ONCE (the wrapper is cached per callback and phase)", () => {
  const s = createStepper();
  setScheduler(s);
  let n = 0;
  const cb = () => n++;
  onFrame("read", cb);
  onFrame("read", cb);
  onFrame("read", cb);
  assert.equal(s.pending(), 1);
  s.step();
  assert.equal(n, 1);
  s.step();
  assert.equal(n, 1, "once: a spent request does not run again");
  onFrame("read", cb);
  onFrame("render", cb);
  s.step();
  assert.equal(n, 3, "one request per phase");
  setScheduler(null);
});

test("a throw stalls nothing: the other callbacks in the frame and the next frame still run, and the error is re-raised in a microtask", () => {
  const s = createStepper();
  setScheduler(s);
  const ran: string[] = [];
  const queued: (() => void)[] = [];
  const realQueue = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (fn: () => void) => { queued.push(fn); };
  try {
    onFrame("read", () => { throw new Error("boom"); });
    onFrame("read", () => ran.push("a"));
    onFrame("render", () => ran.push("b"));
    s.step();
    assert.deepEqual(ran, ["a", "b"]);
    onFrame("render", () => ran.push("c"));
    s.step();
    assert.deepEqual(ran, ["a", "b", "c"]);
  } finally {
    globalThis.queueMicrotask = realQueue;
  }
  assert.equal(queued.length, 1, "the error is handed to a microtask");
  assert.throws(() => queued[0](), /boom/, "…which re-raises it");
  setScheduler(null);
});

test("cancel() removes a pending request; a request made inside a frame runs in the NEXT frame", () => {
  const s = createStepper();
  setScheduler(s);
  let n = 0;
  const cancel = onFrame("render", () => n++);
  cancel();
  s.step();
  assert.equal(n, 0);
  const seen: number[] = [];
  const loop = (d: FrameData) => { seen.push(d.timestamp); if (seen.length < 3) onFrame("render", loop); };
  onFrame("render", loop);
  s.step(100); s.step(116); s.step(132); s.step(148);
  assert.deepEqual(seen, [100, 116, 132]);
  setScheduler(null);
});

test("without a scheduler (node, nothing injected) onFrame is a harmless no-op", () => {
  setScheduler(null);
  let n = 0;
  const cancel = onFrame("read", () => n++);
  cancel();
  assert.equal(n, 0);
});

/**
 * A scheduler with framer's render-step semantics (motion-dom createRenderStep): each phase swaps a this-frame and a
 * next-frame Set and processes behind an `isProcessing` flag with NO try/catch — so a throw leaves the flag true,
 * and every later process() of that step only defers itself: the step is stalled for good. The injected stepper
 * above cannot show that failure; this can.
 */
function framerLike() {
  const steps = new Map(["setup", "read", "update", "render", "postRender"].map((p) => {
    let thisFrame = new Set<(d: FrameData) => void>(), nextFrame = new Set<(d: FrameData) => void>();
    let isProcessing = false;
    const step = {
      schedule(fn: (d: FrameData) => void) { nextFrame.add(fn); },
      cancel(fn: (d: FrameData) => void) { nextFrame.delete(fn); },
      process(d: FrameData) {
        if (isProcessing) return; // framer: flushNextFrame = true, and the frame is lost while stuck
        isProcessing = true;
        [thisFrame, nextFrame] = [nextFrame, thisFrame];
        thisFrame.forEach((fn) => fn(d)); // a throw escapes here, leaving isProcessing true
        thisFrame.clear();
        isProcessing = false;
      },
    };
    return [p, step];
  }));
  let t = 0;
  return {
    schedule: (phase: string, fn: (d: FrameData) => void) => steps.get(phase)!.schedule(fn),
    cancel: (phase: string, fn: (d: FrameData) => void) => steps.get(phase)!.cancel(fn),
    frame() {
      t += 16;
      for (const s of steps.values()) { try { s.process({ delta: 16, timestamp: t }); } catch { /* framer's batcher lets it escape the frame */ } }
    },
  };
}

test("under framer's render-step semantics a raw throw stalls its step for good, and onFrame's wrapper prevents it", () => {
  // the failure mode, unwrapped: one throw in render, and render never runs again
  const raw = framerLike();
  const ran: string[] = [];
  raw.schedule("render", () => { throw new Error("boom"); });
  raw.frame();
  raw.schedule("render", () => ran.push("next"));
  raw.frame(); raw.frame();
  assert.deepEqual(ran, [], "the raw step is stuck with isProcessing left true");

  // through onFrame: the same throw, and the step keeps running frame after frame
  const s = framerLike();
  setScheduler(s as unknown as Parameters<typeof setScheduler>[0]);
  const queued: (() => void)[] = [];
  const realQueue = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (fn: () => void) => { queued.push(fn); };
  try {
    onFrame("render", () => { throw new Error("boom"); });
    onFrame("render", () => ran.push("same frame"));
    s.frame();
    onFrame("render", () => ran.push("next frame"));
    s.frame();
  } finally {
    globalThis.queueMicrotask = realQueue;
    setScheduler(null);
  }
  assert.deepEqual(ran, ["same frame", "next frame"]);
  assert.equal(queued.length, 1, "the error is still reported, in a microtask");
});
