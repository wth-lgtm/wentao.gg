import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { BEAT_MS, CSS_TOKENS, EASE, FLAP_MS, HOLD_MS, MASS, atBeat, beats, bezierAt, dampingRatio, nextBeat, springOvershoot, type BeatClock } from "../app/lib/mechanism";

const ROOT = path.join(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

test("one beat: FLAP_MS is the beat (100 ms), HOLD_MS is forty of them, beats(n) is n × 100", () => {
  assert.equal(BEAT_MS, 100);
  assert.equal(FLAP_MS, BEAT_MS);
  assert.equal(HOLD_MS, 40 * BEAT_MS);
  assert.equal(beats(3), 300);
});

test("the SplitFlap takes its clock from mechanism.ts — no private copy of FLAP_MS or HOLD_MS", () => {
  const src = fs.readFileSync(path.join(ROOT, "app/components/SplitFlap.tsx"), "utf8");
  assert.match(src, /import \{ FLAP_MS, HOLD_MS \} from "\.\.\/lib\/mechanism"/);
  assert.doesNotMatch(src, /const (FLAP_MS|HOLD_MS)\s*=/);
});

test("nextBeat is a PHASE on performance.now(): the first multiple of 100 more than 2 ms away, plus (n − 1) beats", () => {
  assert.equal(nextBeat(0), 100);
  assert.equal(nextBeat(42), 100);
  assert.equal(nextBeat(97.9), 100, "2.1 ms before the boundary still makes it");
  assert.equal(nextBeat(98.5), 200, "1.5 ms before the boundary is too close: the next one");
  assert.equal(nextBeat(100), 200);
  assert.equal(nextBeat(150, 3), 400);
  assert.equal(nextBeat(12345.6), 12400);
  for (let t = 0; t < 1000; t += 7.3) {
    const b = nextBeat(t);
    assert.equal(b % BEAT_MS, 0);
    assert.ok(b > t + 2 && b <= t + 2 + BEAT_MS);
  }
});

test("atBeat arms ONE timeout to the boundary and nothing else; cancel() clears it and is idempotent", () => {
  const timers: { at: number; cb: () => void; id: number }[] = [];
  let now = 1234;
  let nextId = 1;
  const cleared: number[] = [];
  const clock: BeatClock = {
    now: () => now,
    setTimeout: (cb, ms) => { const id = nextId++; timers.push({ at: now + ms, cb, id }); return id; },
    clearTimeout: (id) => { cleared.push(id as number); },
  };
  let fired = 0;
  const cancel = atBeat(() => fired++, 1, clock);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].at, 1300);
  now = 1234.6;
  const c3 = atBeat(() => {}, 1, clock);
  assert.equal(timers[1].at, 1300.6, "the delay is rounded UP to whole ms, so it never fires before the boundary");
  c3();
  timers.splice(1, 1);
  now = 1234;
  now = 1300; timers[0].cb();
  assert.equal(fired, 1);
  const c2 = atBeat(() => fired++, 2, clock);
  assert.equal(timers[1].at, 1500, "n = 2 is the second boundary");
  c2(); c2();
  assert.deepEqual(cleared, [2, 3]);
  cancel();
});

test("--ease-stop overshoots by ≈ 5.3 % with its peak near x 0.485; the entrance curve never overshoots", () => {
  let peak = 0, at = 0;
  for (let x = 0; x <= 1; x += 0.001) { const y = bezierAt(EASE.stop, x); if (y > peak) { peak = y; at = x; } }
  assert.ok(Math.abs(peak - 1.053) < 0.002, `peak ${peak}`);
  assert.ok(Math.abs(at - 0.485) < 0.02, `at ${at}`);
  let entranceMax = 0;
  for (let x = 0; x <= 1; x += 0.001) entranceMax = Math.max(entranceMax, bezierAt(EASE.entrance, x));
  assert.ok(entranceMax <= 1.0000001);
});

test("MASS: the true overshoots are 0.26 % (panel, ζ 0.885) and 4.8 % (trim, ζ 0.694) — OC-G keeps these springs", () => {
  assert.ok(Math.abs(dampingRatio(MASS.panel) - 0.885) < 0.001);
  assert.ok(Math.abs(dampingRatio(MASS.trim) - 0.694) < 0.001);
  assert.ok(Math.abs(springOvershoot(MASS.panel) - 0.0026) < 0.0002);
  assert.ok(Math.abs(springOvershoot(MASS.trim) - 0.048) < 0.001);
  assert.equal(springOvershoot({ stiffness: 100, damping: 40, mass: 1 }), 0, "over-damped: no overshoot");
});

test("CSS = TS: every token mechanism.ts mirrors is declared with the same value in globals.css :root", () => {
  for (const [name, value] of Object.entries(CSS_TOKENS)) {
    const m = new RegExp(`${name.replace(/-/g, "\\-")}:\\s*([^;]+);`).exec(css);
    assert.ok(m, `${name} is declared in globals.css`);
    assert.equal(m![1].trim(), value, name);
  }
  assert.match(css, /--sf-flap:\s*calc\(var\(--beat\) \/ 2\);/, "one leaf phase is half a beat (50 ms, value-identical)");
});
