import { test } from "node:test";
import assert from "node:assert/strict";

import { VELOCITY_TAU_MS, VELOCITY_ZERO_MS, createScrollStore, type ScrollEnv } from "../app/lib/scrollStore";

function harness() {
  let now = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  let id = 0;
  const reads = new Set<() => void>();
  const env: ScrollEnv = {
    setTimeout: (cb, ms) => { timers.set(++id, { at: now + ms, cb }); return id; },
    clearTimeout: (t) => { timers.delete(t as number); },
    read: (cb) => { reads.add(cb); },
  };
  const frame = () => { const run = [...reads]; reads.clear(); run.forEach((f) => f()); };
  const advance = (ms: number) => {
    now += ms;
    for (const [k, t] of [...timers]) if (t.at <= now) { timers.delete(k); t.cb(); }
  };
  return { env, frame, advance, now: () => now, timers, reads };
}

test("subscribers are called in the READ phase, once per frame however many scroll samples arrived", () => {
  const h = harness();
  const s = createScrollStore(h.env);
  s.setMaxY(1000);
  const seen: number[] = [];
  s.subscribe((st) => seen.push(st.y));
  s.sample(10, 0); s.sample(20, 4); s.sample(30, 8);
  assert.equal(seen.length, 0, "nothing runs until the frame");
  h.frame();
  assert.deepEqual(seen, [30]);
  assert.equal(s.get().progress, 0.03);
  assert.equal(s.get().target, 30, "native scroll: the target is where the page is");
});

test("velocity is an EMA with a 50 ms time constant, signed, in px/s; direction follows the last move", () => {
  const h = harness();
  const s = createScrollStore(h.env);
  s.sample(0, 0);
  s.sample(16, 16); // 1000 px/s instantaneous
  const a = 1 - Math.exp(-16 / VELOCITY_TAU_MS);
  assert.ok(Math.abs(s.get().velocity - a * 1000) < 1e-9);
  for (let t = 32; t <= 400; t += 16) s.sample(t, t);
  assert.ok(Math.abs(s.get().velocity - 1000) < 5, `converges to the steady speed, ${s.get().velocity}`);
  assert.equal(s.get().direction, 1);
  s.sample(380, 416);
  assert.equal(s.get().direction, -1);
});

test("ONE timeout zeroes the velocity 120 ms after the last sample, and notifies (a held riffle resumes); no rAF", () => {
  const h = harness();
  const s = createScrollStore(h.env);
  const seen: number[] = [];
  s.subscribe((st) => seen.push(st.velocity));
  s.sample(0, 0); s.sample(100, 16);
  assert.equal(h.timers.size, 1, "one pending timer, re-armed per sample");
  h.frame();
  h.advance(VELOCITY_ZERO_MS - 1);
  assert.notEqual(s.get().velocity, 0);
  h.advance(1);
  assert.equal(s.get().velocity, 0);
  assert.equal(s.get().direction, 0);
  h.frame();
  assert.equal(seen[seen.length - 1], 0, "the zeroing reached the subscribers");
  assert.equal(h.timers.size, 0);
  assert.equal(h.reads.size, 0, "at rest nothing is pending");
});

test("unsubscribe stops the calls; with no subscribers a sample schedules no frame", () => {
  const h = harness();
  const s = createScrollStore(h.env);
  let n = 0;
  const off = s.subscribe(() => n++);
  off();
  s.sample(5, 1);
  assert.equal(h.reads.size, 0);
  h.frame();
  assert.equal(n, 0);
});
