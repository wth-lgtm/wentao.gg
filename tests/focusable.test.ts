import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOCUSABLE,
  HIDDEN_SUBTREE,
  firstReachable,
  isReachable,
} from "../app/projects/hl-whale-tracker/lib/focusable";

// useTabpanelFocus decides whether the open panel needs its own tab stop by asking the
// DOM for a focusable control. The commit engine's ghost sheet is a cloned <table> that
// is `inert` and aria-hidden — a picture of the outgoing board, with fifty cloned
// inspect <button>s in it — and the selector counted them: for the length of a period
// commit's fade the panel read as "has controls" off elements nothing can reach. The
// predicate here is what the hook filters with; it takes anything with Element's
// `closest`, so it is pinned without a DOM.

/** An element whose nearest hidden ancestor is, or is not, there. */
const el = (hidden: boolean) => ({
  closest: (selectors: string) => (selectors === HIDDEN_SUBTREE && hidden ? {} : null),
});

test("isReachable: a control inside an inert or aria-hidden subtree does not count", () => {
  assert.equal(isReachable(el(false)), true);
  assert.equal(isReachable(el(true)), false);
  // The selector names both ways a subtree is taken out of reach, and nothing else.
  assert.equal(HIDDEN_SUBTREE, '[inert],[aria-hidden="true"]');
});

test("firstReachable: the first LIVE control, skipping the ghost's", () => {
  const ghost = el(true);
  const live = el(false);
  assert.equal(firstReachable([ghost, ghost, live, el(false)]), live);
  assert.equal(firstReachable([ghost, ghost]), null);
  assert.equal(firstReachable([]), null);
});

test("FOCUSABLE is still the browser's own tab sequence", () => {
  // The hook's selector, unchanged: what it matches is a property of the browser, and
  // the filter above is what changed, not the list.
  for (const part of ["a[href]", "button:not([disabled])", '[tabindex]:not([tabindex="-1"])']) {
    assert.ok(FOCUSABLE.includes(part), part);
  }
});
