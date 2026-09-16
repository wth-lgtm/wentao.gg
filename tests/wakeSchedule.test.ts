import { test } from "node:test";
import assert from "node:assert/strict";

import { nextWakeAt } from "../app/projects/hl-whale-tracker/hooks/useLeaderboard";

// The whole of the board's refetch policy, in one expression. It is exported from the
// hook precisely so it can be asserted here rather than only observed through a stubbed
// dev server: the failure modes below are a request loop and a page that never recovers,
// neither of which shows up in a screenshot.
//
// Two gates, and the answer is the later of them:
//   - the floor: one request per TTL, counted from when we last ASKED;
//   - the expiry: with a snapshot in hand, not before it has actually aged out.

const TTL = 300_000;

test("nextWakeAt: with no snapshot the floor alone schedules the attempt", () => {
  // A first load that failed leaves no snapshot and nothing to age. Before this the
  // wake effect returned early here, so there was no timer and no listener: the page
  // could only recover if the visitor happened to do something.
  assert.equal(nextWakeAt({ snapshot: null, ttlMs: TTL, attemptedAt: 1000 }), 1000 + TTL);
});

test("nextWakeAt: a fresh snapshot is refetched when it passes its TTL", () => {
  // CDN MISS: the body is as new as it can be, so the expiry and the floor coincide.
  const at = 1_000_000;
  assert.equal(
    nextWakeAt({ snapshot: { receivedAt: at, ageAtReceipt: 0 }, ttlMs: TTL, attemptedAt: at }),
    at + TTL
  );
});

test("nextWakeAt: a half-aged snapshot still waits out the floor, not just its expiry", () => {
  // Answered from the CDN 150s into its own window: it expires 150s from now, but we
  // asked for it now, so asking again in 150s would be twice inside one TTL.
  const at = 1_000_000;
  const half = nextWakeAt({
    snapshot: { receivedAt: at, ageAtReceipt: TTL / 2 },
    ttlMs: TTL,
    attemptedAt: at,
  });
  assert.equal(half, at + TTL);
});

test("nextWakeAt: a body already past its TTL cannot schedule an immediate refetch", () => {
  // This is the loop. Inside stale-while-revalidate the edge legitimately serves a body
  // that is ALREADY past s-maxage, so an expiry-only gate is satisfied by the very
  // answer it just produced and the page refetches as fast as the network allows.
  const at = 1_000_000;
  const due = nextWakeAt({
    snapshot: { receivedAt: at, ageAtReceipt: TTL * 4 },
    ttlMs: TTL,
    attemptedAt: at,
  });
  assert.equal(due, at + TTL);
  assert.ok(due > at, "never due at the instant the answer landed");
});

test("nextWakeAt: an old snapshot is governed by the floor once its expiry has passed", () => {
  // A tab that was hidden for an hour: the expiry is long gone, so the only question is
  // how long since we last asked.
  const snapshot = { receivedAt: 0, ageAtReceipt: 0 };
  assert.equal(nextWakeAt({ snapshot, ttlMs: TTL, attemptedAt: 3_600_000 }), 3_600_000 + TTL);
});

test("nextWakeAt: the answer is monotone in both inputs", () => {
  // Neither a later attempt nor an older body may ever pull the next request EARLIER;
  // that direction is the only one that can turn into a loop.
  const base = { snapshot: { receivedAt: 500, ageAtReceipt: 0 }, ttlMs: TTL, attemptedAt: 500 };
  const floor = nextWakeAt(base);
  for (const attemptedAt of [500, 1_000, 10_000, 999_999]) {
    assert.ok(nextWakeAt({ ...base, attemptedAt }) >= floor);
    assert.ok(nextWakeAt({ ...base, attemptedAt }) >= attemptedAt + TTL);
  }
  for (const ageAtReceipt of [0, 1, TTL, TTL * 10]) {
    assert.ok(
      nextWakeAt({ ...base, snapshot: { receivedAt: 500, ageAtReceipt } }) >= floor
    );
  }
});
