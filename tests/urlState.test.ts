import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WHALE_STATE,
  composeWrite,
  readWhaleState,
  sameWhaleState,
  settlePending,
  whaleQuery,
  type WhaleUrlState,
} from "../app/projects/hl-whale-tracker/lib/urlState";

// The five controls the whale tracker used to keep in useState. Every assertion below
// is a journey the plain-useState version lost: a reload, a shared link, the phone's
// Back gesture out of Positions, and a hand-edited query string.
//
// readWhaleState takes anything with URLSearchParams' `get`, which is what Next's
// ReadonlyURLSearchParams is — so the reader is testable in Node with no React and no
// router. whaleQuery is its inverse, and it omits defaults so the bare
// /projects/hl-whale-tracker keeps its clean URL.

const read = (query: string) => readWhaleState(new URLSearchParams(query));

test("readWhaleState: an empty query is the board's defaults", () => {
  assert.deepEqual(read(""), {
    tab: "leaderboard",
    trader: null,
    period: "7d",
    sort: "pnl",
    dir: "desc",
  });
  assert.deepEqual(read(""), DEFAULT_WHALE_STATE);
});

test("readWhaleState: the acceptance deep link opens Positions for that trader", () => {
  const state = read(
    "tab=positions&trader=0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060"
  );
  assert.equal(state.tab, "positions");
  assert.equal(state.trader, "0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060");
});

test("readWhaleState: a checksummed address is lowercased to match the board's rows", () => {
  // LeaderboardTable compares `trader.address === selectedAddress` with ===, and
  // upstream's ethAddress is lowercase. A shared link carrying EIP-55 mixed case
  // would otherwise fetch the right book and highlight no row.
  const state = read("trader=0x5B5D51201B134B0E0EEB1FD2D1E5A0D1F298C060");
  assert.equal(state.trader, "0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060");
});

test("readWhaleState: anything that is not a 40-hex address is no selection at all", () => {
  // The address is the only user-supplied value in this feature and the trader route
  // rejects it on exactly this pattern, so the URL reader must not hand the page a
  // string the API will 400 on.
  assert.equal(read("trader=0xdeadbeef").trader, null);
  assert.equal(read("trader=").trader, null);
  assert.equal(read("trader=" + "z".repeat(42)).trader, null);
  assert.equal(
    read("trader=5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060").trader,
    null
  );
  // One glyph too many is not a truncation to fix — it is a different address.
  assert.equal(
    read("trader=0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c0600").trader,
    null
  );
});

test("readWhaleState: an invalid value falls back to its own default, not the whole state", () => {
  const state = read("tab=nope&window=1y&sort=sharpe&dir=sideways&trader=nope");
  assert.deepEqual(state, DEFAULT_WHALE_STATE);

  // A bad tab must not cost the window that was also in the link.
  assert.deepEqual(read("tab=nope&window=30d"), {
    ...DEFAULT_WHALE_STATE,
    period: "30d",
  });
});

test("readWhaleState: every window the board has is reachable from the URL", () => {
  assert.equal(read("window=1d").period, "1d");
  assert.equal(read("window=7d").period, "7d");
  assert.equal(read("window=30d").period, "30d");
  assert.equal(read("window=allTime").period, "allTime");
});

test("readWhaleState: the query says ROI, the way every column header does", () => {
  // types.ts:49 keeps the upstream field name `winRate` ("Actually ROI from API");
  // renaming it touches nine files and the public /api/hl-leaderboard shape. The URL
  // is copy-pasted and read aloud, so it carries the word the page shows.
  assert.equal(read("sort=roi").sort, "winRate");
  assert.equal(read("sort=pnl").sort, "pnl");
  assert.equal(read("sort=volume").sort, "volume");
  // Accepted so a link built from the internal name still works.
  assert.equal(read("sort=winRate").sort, "winRate");
  assert.equal(whaleQuery({ ...DEFAULT_WHALE_STATE, sort: "winRate" }), "sort=roi");
});

test("readWhaleState: a shouted or wrongly-cased value still restores", () => {
  // A URL that has been through a chat client, a QR code or a capitalising keyboard
  // still names a real window; resetting it to 7D silently would look like a bug.
  assert.equal(read("window=30D").period, "30d");
  assert.equal(read("window=ALLTIME").period, "allTime");
  assert.equal(read("tab=POSITIONS").tab, "positions");
  assert.equal(read("sort=ROI").sort, "winRate");
  assert.equal(read("dir=ASC").dir, "asc");
});

test("readWhaleState: a trader tab with no trader is a real state, not a fallback", () => {
  // PositionsPanel and TradesPanel both render an affirmative "no trader selected"
  // branch, and the tab rack can be driven to either with nothing selected, so the
  // reader must not quietly rewrite the tab to the leaderboard.
  assert.equal(read("tab=trades").tab, "trades");
  assert.equal(read("tab=trades").trader, null);
});

test("whaleQuery: the board's own state is the bare URL", () => {
  assert.equal(whaleQuery(DEFAULT_WHALE_STATE), "");
});

test("whaleQuery: only what differs from the default is written", () => {
  assert.equal(whaleQuery({ ...DEFAULT_WHALE_STATE, period: "30d" }), "window=30d");
  assert.equal(whaleQuery({ ...DEFAULT_WHALE_STATE, dir: "asc" }), "dir=asc");
  assert.equal(
    whaleQuery({ ...DEFAULT_WHALE_STATE, tab: "analytics" }),
    "tab=analytics"
  );
});

test("whaleQuery: a selected trader is kept on every tab, including the board", () => {
  // Switching back to the Leaderboard tab keeps the row highlighted and keeps the
  // selection through a reload, so `trader` is not conditional on the tab.
  const addr = "0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060";
  assert.equal(
    whaleQuery({ ...DEFAULT_WHALE_STATE, trader: addr }),
    `trader=${addr}`
  );
});

test("whaleQuery: the key order is fixed so an unchanged state cannot churn history", () => {
  const addr = "0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060";
  assert.equal(
    whaleQuery({
      tab: "trades",
      trader: addr,
      period: "30d",
      sort: "volume",
      dir: "asc",
    }),
    `tab=trades&trader=${addr}&window=30d&sort=volume&dir=asc`
  );
});

test("whaleQuery then readWhaleState round-trips every state the board can hold", () => {
  const addr = "0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060";
  const tabs = ["leaderboard", "positions", "trades", "analytics"] as const;
  const periods = ["1d", "7d", "30d", "allTime"] as const;
  const sorts = ["pnl", "winRate", "volume"] as const;
  const dirs = ["asc", "desc"] as const;

  for (const tab of tabs) {
    for (const trader of [null, addr]) {
      for (const period of periods) {
        for (const sort of sorts) {
          for (const dir of dirs) {
            const state = { tab, trader, period, sort, dir };
            assert.deepEqual(
              readWhaleState(new URLSearchParams(whaleQuery(state))),
              state
            );
          }
        }
      }
    }
  }
});

// The write/sync race, replayed. useTableControls composes every write from a base and
// used to reset that base to the URL's reading whenever the params changed — including
// when an EARLIER write's params landed. Three writes in quick succession then went
// write1, write2, (write1 lands → base regresses to write1), write3 composed from the
// stale base, and write2's change was gone from the URL for good. The hook now keeps the
// queue of states it has written and composes from the newest until the URL reflects it.

/** What the router reports after a write lands: the query, read back. */
const landed = (state: WhaleUrlState) => readWhaleState(new URLSearchParams(whaleQuery(state)));

test("settlePending: the three-write sequence keeps write2", () => {
  const addr = "0x5b5d51201b134b0e0eeb1fd2d1e5a0d1f298c060";
  let url = DEFAULT_WHALE_STATE;
  let pending: WhaleUrlState[] = [];
  const base = () => pending[pending.length - 1] ?? url;

  const w1 = composeWrite(base(), { sort: "volume" });
  pending = [...pending, w1];
  const w2 = composeWrite(base(), { period: "30d" });
  pending = [...pending, w2];
  assert.equal(w2.sort, "volume", "write2 composes over write1 before either lands");

  // write1's params land. The old hook set base = this state here.
  url = landed(w1);
  pending = settlePending(pending, url);
  assert.deepEqual(pending, [w2], "write1 is settled, write2 is still in flight");

  const w3 = composeWrite(base(), { trader: addr, tab: "positions" });
  pending = [...pending, w3];
  // This is the assertion the bug failed: composed from the regressed base, write3
  // carried sort=volume and the default window, and 30d was never written again.
  assert.equal(w3.period, "30d");
  assert.equal(w3.sort, "volume");
  assert.equal(w3.trader, addr);

  url = landed(w2);
  pending = settlePending(pending, url);
  assert.deepEqual(pending, [w3]);
  url = landed(w3);
  pending = settlePending(pending, url);
  assert.deepEqual(pending, []);
  assert.deepEqual(base(), landed(w3), "with nothing in flight the URL is the base again");
});

test("settlePending: a landing that matches no write is a navigation, and clears the queue", () => {
  // Back, Forward, a deep link: the URL moved for a reason we did not cause, so the
  // queue is stale and the URL's reading is the only honest base.
  const w1 = composeWrite(DEFAULT_WHALE_STATE, { sort: "volume" });
  const back = { ...DEFAULT_WHALE_STATE, period: "1d" as const };
  assert.deepEqual(settlePending([w1], back), []);
  // A landing of the NEWEST write settles everything before it too.
  const w2 = composeWrite(w1, { period: "30d" });
  assert.deepEqual(settlePending([w1, w2], landed(w2)), []);
  // Nothing pending is nothing to settle.
  assert.deepEqual(settlePending([], landed(w1)), []);
});

test("sameWhaleState and composeWrite are the pure halves the hook composes from", () => {
  assert.equal(sameWhaleState(DEFAULT_WHALE_STATE, { ...DEFAULT_WHALE_STATE }), true);
  assert.equal(sameWhaleState(DEFAULT_WHALE_STATE, { ...DEFAULT_WHALE_STATE, dir: "asc" }), false);
  const next = composeWrite(DEFAULT_WHALE_STATE, { trader: null, tab: "leaderboard" });
  assert.deepEqual(next, DEFAULT_WHALE_STATE);
  // A patch never reaches into its base.
  const frozen = Object.freeze({ ...DEFAULT_WHALE_STATE });
  assert.notEqual(composeWrite(frozen, { dir: "asc" }), frozen);
  assert.equal(frozen.dir, "desc");
});
