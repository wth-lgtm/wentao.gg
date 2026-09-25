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
