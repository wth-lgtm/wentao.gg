import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAILED_PAYLOAD_TTL_MS,
  payloadFresh,
} from "../app/projects/hl-whale-tracker/lib/info";

// How long a module-scope upstream payload is allowed to stand, and the case that got
// it wrong.
//
// Both trader routes cache the two payloads that are not about any one trader —
// spotMeta (near-static, 1h) and allMids (a live market, 30s) — so they cost one
// upstream call per cold lambda rather than one per visitor. lib/info's `info()` answers
// null for a non-2xx, and Hyperliquid returns 429 on a second sequential call from a
// shared egress IP, so a null is a TRANSIENT failure.
//
// Caching that null for the GOOD window meant one 429 cost an hour of "@107" on every
// spot fill and an hour of em dashes in the USD column — and because the positions route
// folds missing pricing into `partial`, which sets `Cache-Control: no-store`, an hour
// with no edge cache either. Rate-limited is precisely when the fan-out cap matters, so
// a failure is held only long enough to collapse a burst.

const ok = (at: number) => ({ value: { universe: [] }, at });
const failed = (at: number) => ({ value: null, at });
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

test("payloadFresh: nothing cached is never fresh", () => {
  assert.equal(payloadFresh(null, HOUR, NOW), false);
});

test("payloadFresh: a good payload stands for its own window", () => {
  assert.equal(payloadFresh(ok(NOW), HOUR, NOW), true);
  assert.equal(payloadFresh(ok(NOW - HOUR + 1), HOUR, NOW), true);
  assert.equal(payloadFresh(ok(NOW - HOUR), HOUR, NOW), false);
  assert.equal(payloadFresh(ok(NOW - 2 * HOUR), HOUR, NOW), false);
});

test("payloadFresh: a failure stands for the short window, not the good one", () => {
  assert.equal(payloadFresh(failed(NOW), HOUR, NOW), true);
  assert.equal(payloadFresh(failed(NOW - FAILED_PAYLOAD_TTL_MS + 1), HOUR, NOW), true);
  // The moment that matters: an hour's worth of dashes used to start here.
  assert.equal(payloadFresh(failed(NOW - FAILED_PAYLOAD_TTL_MS), HOUR, NOW), false);
  assert.equal(payloadFresh(failed(NOW - 60_000), HOUR, NOW), false);
});

test("payloadFresh: a failure is never held LONGER than a success would be", () => {
  // allMids' window is 30s today, comfortably above the failure window — but a caller
  // with a window shorter than FAILED_PAYLOAD_TTL_MS must not end up remembering a 429
  // for longer than it would remember a real answer.
  const short = 5_000;
  assert.ok(short < FAILED_PAYLOAD_TTL_MS);
  assert.equal(payloadFresh(failed(NOW - short + 1), short, NOW), true);
  assert.equal(payloadFresh(failed(NOW - short), short, NOW), false);
});

test("payloadFresh: the short window is short enough to be worth having", () => {
  // The coordinator's bound, pinned so it cannot drift back towards an hour.
  assert.ok(FAILED_PAYLOAD_TTL_MS > 0);
  assert.ok(FAILED_PAYLOAD_TTL_MS <= 60_000);
});
