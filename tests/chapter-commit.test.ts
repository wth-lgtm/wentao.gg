import { test } from "node:test";
import assert from "node:assert/strict";

import { createCommit } from "../app/lib/chapterCommit";
import { COMMIT_MAX_V } from "../app/lib/chapterList";
import { atBeat, type BeatClock } from "../app/lib/mechanism";

/** A fake lattice: real atBeat arithmetic over a manual clock. */
function lattice(start = 1000) {
  let now = start;
  const timers = new Map<number, { at: number; cb: () => void }>();
  let id = 0;
  const clock: BeatClock = {
    now: () => now,
    setTimeout: (cb, ms) => { timers.set(++id, { at: now + ms, cb }); return id; },
    clearTimeout: (t) => { timers.delete(t as number); },
  };
  const advanceTo = (t: number) => {
    for (;;) {
      let next: [number, { at: number; cb: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= t && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].cb();
    }
    now = t;
  };
  return { clock, advanceTo, now: () => now, pending: () => timers.size };
}

function rig(start = 1000) {
  const L = lattice(start);
  let v = 0;
  const log: { beat: number; at: number }[] = [];
  const c = createCommit({
    atBeat: (cb) => atBeat(cb, 1, L.clock),
    velocity: () => v,
    onStep: (next) => log.push({ beat: next, at: L.now() }),
  });
  return { c, L, log, setV: (x: number) => { v = x; } };
}

test("one step per boundary, each landing exactly on a 100 ms boundary; nothing pending at rest", () => {
  const { c, L, log } = rig(1030);
  c.setTarget(0);
  assert.equal(c.pending, true);
  L.advanceTo(1100);
  assert.deepEqual(log, [{ beat: 0, at: 1100 }], "docks on the next boundary");
  assert.equal(c.pending, false);
  c.setTarget(3);
  L.advanceTo(1500);
  assert.deepEqual(log.map((e) => e.beat), [0, 1, 2, 3]);
  assert.deepEqual(log.map((e) => e.at), [1100, 1200, 1300, 1400]);
  assert.equal(c.pending, false);
  assert.equal(L.pending(), 0, "at rest: no timer");
});

test("the jump beyond RIFFLE_JUMP: an anchor-length move goes to one short, then steps the last row", () => {
  const { c, L, log } = rig();
  c.setTarget(0); L.advanceTo(1100);
  c.setTarget(9); L.advanceTo(2000);
  assert.deepEqual(log.map((e) => e.beat), [0, 8, 9]);
});

test("cancel on return: a target that comes back to `shown` before the boundary cancels the pending step", () => {
  const { c, L, log } = rig();
  c.setTarget(0); L.advanceTo(1100);
  c.setTarget(1);
  assert.equal(c.pending, true);
  L.advanceTo(1150);
  c.setTarget(0);
  assert.equal(c.pending, false);
  L.advanceTo(1500);
  assert.deepEqual(log.map((e) => e.beat), [0]);
  assert.equal(L.pending(), 0);
});

test("hold above COMMIT_MAX_V: no step is armed during a fling; resume() riffles from where shown stands", () => {
  const { c, L, log, setV } = rig();
  c.setTarget(0); L.advanceTo(1100);
  setV(COMMIT_MAX_V + 1);
  c.setTarget(3);
  assert.equal(c.held, true);
  assert.equal(c.pending, false);
  L.advanceTo(1600);
  assert.deepEqual(log.map((e) => e.beat), [0]);
  setV(0);
  c.resume();
  L.advanceTo(2000);
  assert.deepEqual(log.map((e) => e.beat), [0, 1, 2, 3]);
  // a fling that starts while a step is pending holds at the boundary
  c.setTarget(1);
  setV(-5000);
  L.advanceTo(2100);
  assert.deepEqual(log.map((e) => e.beat), [0, 1, 2, 3]);
  assert.equal(c.held, true);
  setV(0); c.resume(); L.advanceTo(2400);
  assert.deepEqual(log.map((e) => e.beat), [0, 1, 2, 3, 2, 1]);
});

test("a 2-beat and a 5-beat glide emit every intermediate beat in order (the target advances over ~400 ms, as a wheel glide does)", () => {
  for (const span of [2, 5]) {
    const { c, L, log } = rig(1000);
    c.setTarget(0); L.advanceTo(1100);
    // an ease-out glide: 90 % of the way in 200 ms (the eased wheel's k = 11.5/s)
    for (let t = 1100; t <= 1900; t += 16) {
      L.advanceTo(t);
      const p = 1 - Math.exp(-11.5 * ((t - 1100) / 1000));
      c.setTarget(Math.min(span, Math.floor(p * span + 1e-9)));
    }
    c.setTarget(span);
    L.advanceTo(3000);
    const want = Array.from({ length: span + 1 }, (_, k) => k);
    assert.deepEqual(log.map((e) => e.beat), want, `span ${span}`);
    for (const e of log) assert.equal(e.at % 100, 0, "each on a boundary");
  }
});

test("clear() removes the marks synchronously and cancels any pending step; a −1 target clears on the next beat", () => {
  const { c, L, log } = rig();
  c.setTarget(0); L.advanceTo(1100);
  c.setTarget(2);
  c.clear();
  assert.equal(c.shown, -1);
  assert.equal(log[log.length - 1].beat, -1);
  assert.equal(log[log.length - 1].at, 1100, "synchronous");
  assert.equal(L.pending(), 0);
  c.setTarget(1); L.advanceTo(1200);
  assert.equal(c.shown, 1, "re-docks directly");
  c.setTarget(-1);
  assert.equal(c.shown, 1, "not yet");
  L.advanceTo(1300);
  assert.equal(c.shown, -1, "cleared on the beat");
});
