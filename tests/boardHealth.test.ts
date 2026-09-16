import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isUnreadableBoard,
  isUnreadableWindow,
  unreadableBoardMessage,
} from "../app/projects/hl-whale-tracker/lib/boardHealth";

// The 200 that must not be read as an empty market.
//
// app/api/hl-leaderboard/route.ts answers 502 only when NO row could be read at all,
// and otherwise serves the rows it has with a per-window count of the ones it dropped.
// That relaxation is right for the case it was written for — one renamed field drops
// every row as incomplete, and the board should not go dark over a payload it partly
// understands — but it created a payload shape nothing downstream handled:
// `periods` empty in every window, `rowsPartial` in the tens of thousands, HTTP 200.
//
// LeaderboardTable reads `noRows && error === null` as "empty" and renders "No traders
// found with activity in this period", which its own comment says is reachable only
// through the error path. That sentence is a fabricated fact about the market — the
// upstream publishes a top-N per window and had 45,092 rows on 2026-09-16 — so the
// case is classified here and reported as the failure it is.

const board = (rows: number, partial: Record<string, number>) => ({
  periods: {
    "1d": Array.from({ length: rows }, (_, i) => ({ address: `0x${i}` })),
    "7d": [],
    "30d": [],
    allTime: [],
  },
  rowsSeen: 45_092,
  rowsPartial: partial,
});

const ALL_DROPPED = { "1d": 45_092, "7d": 45_090, "30d": 44_001, allTime: 45_092 };
const NONE_DROPPED = { "1d": 0, "7d": 0, "30d": 0, allTime: 0 };

test("isUnreadableBoard: every window empty while rows were dropped is unreadable", () => {
  assert.equal(isUnreadableBoard(board(0, ALL_DROPPED)), true);
  // One window reporting a drop is enough: the board is empty everywhere, so there is
  // no window left that could be showing real rows.
  assert.equal(
    isUnreadableBoard(board(0, { ...NONE_DROPPED, "30d": 12 })),
    true
  );
});

test("isUnreadableBoard: a board with rows is readable, dropped rows or not", () => {
  // The normal partial case — some rows parsed, some did not. The rail's DROPPED field
  // is the whole story here; the board itself is fine.
  assert.equal(isUnreadableBoard(board(50, ALL_DROPPED)), false);
  assert.equal(isUnreadableBoard(board(50, NONE_DROPPED)), false);
});

test("isUnreadableBoard: an upstream that returned nothing is a different case", () => {
  // rowsSeen 0 means the payload held no rows to misread. Nothing was dropped, so this
  // is not the fabrication this predicate exists to catch — and a board with no rows
  // and no drops has nothing dishonest to say.
  assert.equal(
    isUnreadableBoard({
      periods: { "1d": [], "7d": [], "30d": [], allTime: [] },
      rowsSeen: 0,
      rowsPartial: NONE_DROPPED,
    }),
    false
  );
  assert.equal(isUnreadableBoard(board(0, NONE_DROPPED)), false);
});

test("isUnreadableBoard: a shape it cannot judge is not called unreadable", () => {
  // The caller's own `!body?.periods` guard owns these; claiming them here would put
  // two different sentences on one failure.
  for (const payload of [
    null,
    undefined,
    {},
    { periods: {}, rowsPartial: ALL_DROPPED },
    { periods: "nope", rowsPartial: ALL_DROPPED },
    { periods: { "1d": [] }, rowsPartial: "nope" },
    { periods: { "1d": "nope" }, rowsPartial: ALL_DROPPED },
    // A non-numeric count is not a count.
    { periods: { "1d": [] }, rowsPartial: { "1d": "45092" } },
  ]) {
    assert.equal(isUnreadableBoard(payload), false, JSON.stringify(payload));
  }
});

test("unreadableBoardMessage: the count is the window's own, and only when there is one", () => {
  assert.equal(
    unreadableBoardMessage(45_090),
    "Leaderboard unreadable: upstream rows arrived but none carried complete figures (45,090 dropped in this window)"
  );
  // No count for this window, or a zero one: the sentence still has to be true, so the
  // parenthetical goes rather than printing "(0 dropped)" over a board that is empty
  // for a reason it cannot name per window.
  assert.equal(
    unreadableBoardMessage(null),
    "Leaderboard unreadable: upstream rows arrived but none carried complete figures"
  );
  assert.equal(unreadableBoardMessage(0), unreadableBoardMessage(null));
});

test("isUnreadableWindow: the window on screen, not the whole board", () => {
  // isUnreadableBoard only fires when EVERY window is empty, so a board with rows in
  // three windows and a fourth that arrived empty with dropped rows produced no error at
  // all — and LeaderboardTable read "no rows, no error" as EMPTY and printed "No traders
  // found with activity in this period" over a window whose rows upstream had sent and
  // this app could not read. Same fabrication, one window at a time.
  assert.equal(isUnreadableWindow([], 45_092), true);
  assert.equal(isUnreadableWindow([], 1), true);
  // Rows arrived: whatever else dropped, the window has something to show.
  assert.equal(isUnreadableWindow([{}], 45_092), false);
  // A genuine empty: upstream held nothing for this window and nothing was dropped.
  assert.equal(isUnreadableWindow([], 0), false);
  // A count the body did not carry is not a count. Upstream renaming a window key lands
  // here, and it must not be read as "0 dropped" — the window is simply unexplained.
  assert.equal(isUnreadableWindow([], null), false);
  assert.equal(isUnreadableWindow([], undefined), false);
  // No window at all, for the same reason: this says nothing about dropped rows.
  assert.equal(isUnreadableWindow(undefined, 5), true);
  assert.equal(isUnreadableWindow(undefined, undefined), false);
});
