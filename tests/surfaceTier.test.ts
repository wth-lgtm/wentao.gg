import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideSurfaceTier,
  SERVER_SURFACE_TIER,
} from "../app/projects/hl-whale-tracker/hooks/useSurfaceTier";

// The one structural gate every motion on the board reads. It is a ladder, not a
// boolean: `still` is the designed still (nothing moves), `seat` allows the discrete
// on-beat state changes a phone can afford (a plate seating), and only `commit` may
// run continuous travel — the re-seat and the odometer roll. The decision is pure so
// the three media queries can be tested as booleans, without a window.

test("decideSurfaceTier: a reduced-motion request is the still, whatever the device", () => {
  assert.equal(decideSurfaceTier({ reducedMotion: true, finePointer: true, atLeastSm: true }), "still");
  assert.equal(decideSurfaceTier({ reducedMotion: true, finePointer: false, atLeastSm: false }), "still");
});

test("decideSurfaceTier: a coarse pointer never gets travel — the phone and the tablet seat", () => {
  assert.equal(decideSurfaceTier({ reducedMotion: false, finePointer: false, atLeastSm: false }), "seat");
  // A tablet is wide enough for the table but still has nothing to hover with.
  assert.equal(decideSurfaceTier({ reducedMotion: false, finePointer: false, atLeastSm: true }), "seat");
});

test("decideSurfaceTier: a fine pointer in a window below sm still seats — the table is not even shown there", () => {
  assert.equal(decideSurfaceTier({ reducedMotion: false, finePointer: true, atLeastSm: false }), "seat");
});

test("decideSurfaceTier: fine pointer, motion allowed, at least sm is the only way to commit", () => {
  assert.equal(decideSurfaceTier({ reducedMotion: false, finePointer: true, atLeastSm: true }), "commit");
});

test("the server renders the still: it has no window to ask and the still is the safe default", () => {
  assert.equal(SERVER_SURFACE_TIER, "still");
});
