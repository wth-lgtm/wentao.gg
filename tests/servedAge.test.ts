import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ageAtReceiptMs,
  elapsedMs,
} from "../app/projects/hl-whale-tracker/lib/servedAge";

// How old a body already was when it landed, from the two readings that can say so.
// Both exist because each undercounts the other's case: the CDN `age` header is absent
// on a MISS, and a MISS can be served out of Next's Data Cache with a body up to TTL_S
// old — which is the defect this file pins: AGE 00:00 over a five-minute-old snapshot,
// with the STALE cue and the next-wake schedule inheriting the under-count.

test("ageAtReceiptMs: the CDN header alone, in seconds, becomes milliseconds", () => {
  assert.equal(ageAtReceiptMs("54", undefined), 54_000);
  assert.equal(ageAtReceiptMs("54", 0), 54_000);
});

test("ageAtReceiptMs: the body alone — a CDN MISS answered from the Data Cache", () => {
  // No `age` header (the edge did not have it), but the handler says the reduced body
  // it just served was written 4m32s ago.
  assert.equal(ageAtReceiptMs(null, 272_000), 272_000);
  assert.equal(ageAtReceiptMs("0", 272_000), 272_000);
});

test("ageAtReceiptMs: both present — the larger wins, whichever it is", () => {
  // Edge HIT of a body that was already old when the edge first fetched it: the header
  // counts the edge's hold, the body counts the Data Cache's, and neither counts both.
  assert.equal(ageAtReceiptMs("30", 120_000), 120_000);
  assert.equal(ageAtReceiptMs("200", 120_000), 200_000);
});

test("ageAtReceiptMs: neither present is as fresh as anyone can tell", () => {
  assert.equal(ageAtReceiptMs(null, undefined), 0);
  assert.equal(ageAtReceiptMs(null, null), 0);
});

test("ageAtReceiptMs: garbage on either side reads as nothing, never as a number", () => {
  assert.equal(ageAtReceiptMs("abc", undefined), 0);
  assert.equal(ageAtReceiptMs("-5", undefined), 0);
  assert.equal(ageAtReceiptMs(null, "272000"), 0);
  assert.equal(ageAtReceiptMs(null, -1), 0);
  assert.equal(ageAtReceiptMs(null, Number.NaN), 0);
  assert.equal(ageAtReceiptMs(null, Number.POSITIVE_INFINITY), 0);
  // A bad header does not hide a good body, and vice versa.
  assert.equal(ageAtReceiptMs("abc", 9_000), 9_000);
  assert.equal(ageAtReceiptMs("9", "nope"), 9_000);
});

test("elapsedMs: departure age plus our own elapsed time, one clock per term", () => {
  const receipt = { receivedAt: 1_000_000, ageAtReceipt: 272_000 };
  assert.equal(elapsedMs(receipt, 1_000_000), 272_000);
  assert.equal(elapsedMs(receipt, 1_030_000), 302_000);
  // A clock that stepped backwards under us cannot make the body younger than it was.
  assert.equal(elapsedMs({ receivedAt: 1_000_000, ageAtReceipt: 0 }, 999_000), 0);
});
