import { test } from "node:test";
import assert from "node:assert/strict";

import { DIAL_ROW_PX, HYSTERESIS_PX, PIN_SLACK_PX, STAGE_CLEAR, decideMode, pickOwner } from "../app/lib/chapterList";

// The ChapterDirector's two decisions, pure (chapterList.ts): which mode a chapter takes in the live window, and
// which one chapter owns the marks in a frame. The director only measures and applies them.

const base = { motion: true, pinQuery: true, inPinSet: true, panelH: 500, stageH: 900, pinnedNow: false, narrow: false, dialH: 0 };
const band = (stageH: number, extra = 0) => stageH - STAGE_CLEAR.top - STAGE_CLEAR.bottom - extra;

test("decideMode: static without motion, whatever else holds; flow off the pin query or out of the pin set", () => {
  assert.equal(decideMode({ ...base, motion: false }), "static");
  assert.equal(decideMode({ ...base, motion: false, pinQuery: false, inPinSet: false }), "static");
  assert.equal(decideMode({ ...base, pinQuery: false }), "flow");
  assert.equal(decideMode({ ...base, inPinSet: false }), "flow");
  assert.equal(decideMode(base), "pinned");
});

test("decideMode: the pin and unpin thresholds differ by exactly PIN_SLACK_PX, at every stage height (no flapping)", () => {
  for (const stageH of [720, 789, 832, 900, 982, 1117, 1440]) {
    for (const narrow of [false, true]) {
      const extra = narrow ? DIAL_ROW_PX : 0;
      const b = band(stageH, extra);
      // not pinned: pins only with PIN_SLACK_PX to spare
      assert.equal(decideMode({ ...base, stageH, narrow, panelH: b - PIN_SLACK_PX }), "pinned", `${stageH} ${narrow}: pin at band − slack`);
      assert.equal(decideMode({ ...base, stageH, narrow, panelH: b - PIN_SLACK_PX + 1 }), "flow", `${stageH} ${narrow}: no pin inside the slack`);
      // pinned: stays pinned up to the band itself, and releases one px past it
      assert.equal(decideMode({ ...base, stageH, narrow, pinnedNow: true, panelH: b, dialH: 0 }), "pinned", `${stageH} ${narrow}: stays at the band`);
      assert.equal(decideMode({ ...base, stageH, narrow, pinnedNow: true, panelH: b + 1, dialH: 0 }), "flow", `${stageH} ${narrow}: releases past it`);
      // between the two thresholds the mode is whatever it already is
      const mid = b - PIN_SLACK_PX / 2;
      assert.equal(decideMode({ ...base, stageH, narrow, panelH: mid }), "flow");
      assert.equal(decideMode({ ...base, stageH, narrow, pinnedNow: true, panelH: mid }), "pinned");
    }
  }
});

test("decideMode: 700–1023 px, a pinned dial row grown by text spacing comes off the band as it stands", () => {
  const stageH = 1024;
  const grown = 120; // the compact row at a 24 px default font, taller than DIAL_ROW_PX − 16
  const b = band(stageH, grown + 16);
  assert.equal(decideMode({ ...base, stageH, narrow: true, pinnedNow: true, dialH: grown, panelH: b }), "pinned");
  assert.equal(decideMode({ ...base, stageH, narrow: true, pinnedNow: true, dialH: grown, panelH: b + 1 }), "flow");
  // not pinned: the same grown allowance (the row as last laid out pinned), with PIN_SLACK_PX to spare
  assert.equal(decideMode({ ...base, stageH, narrow: true, dialH: grown, panelH: b - PIN_SLACK_PX }), "pinned");
  assert.equal(decideMode({ ...base, stageH, narrow: true, dialH: grown, panelH: b - PIN_SLACK_PX + 1 }), "flow");
  // never laid out pinned (dialH 0): the nominal DIAL_ROW_PX
  assert.equal(decideMode({ ...base, stageH, narrow: true, dialH: 0, panelH: band(stageH, DIAL_ROW_PX) - PIN_SLACK_PX }), "pinned");
  // two columns: no dial row comes off the band
  assert.equal(decideMode({ ...base, stageH, narrow: false, pinnedNow: true, dialH: grown, panelH: band(stageH) }), "pinned");
});

test("decideMode has a fixed point: fed its own answer back as pinnedNow, it returns the same mode (no 2-cycle)", () => {
  // the review's cycle: flow with panelH 784 in a 1024 stage pinned; pinned with a 120 px row then released it
  for (const narrow of [false, true]) for (const stageH of [720, 800, 900, 1024, 1180]) {
    for (let dialH = 0; dialH <= 200; dialH += 4) for (let panelH = 300; panelH <= stageH; panelH += 3) {
      for (const start of [false, true]) {
        const i = { ...base, stageH, narrow, dialH, panelH };
        const m1 = decideMode({ ...i, pinnedNow: start });
        const m2 = decideMode({ ...i, pinnedNow: m1 === "pinned" });
        assert.equal(m2, m1, `narrow ${narrow} stage ${stageH} dial ${dialH} panel ${panelH} from ${start ? "pinned" : "flow"}`);
      }
    }
  }
});

const ch = (engaged: boolean, focusY: number) => ({ engaged, focusY });

test("pickOwner: the engaged chapter whose target row is nearest the reading line; none engaged → none", () => {
  const a = ch(true, 300), b = ch(true, 540), c = ch(false, 560);
  assert.equal(pickOwner([a, b, c], 558, null), b);
  assert.equal(pickOwner([c], 558, null), null);
  assert.equal(pickOwner([], 558, null), null);
});

test("pickOwner: the current owner keeps the marks until another is nearer by MORE than HYSTERESIS_PX", () => {
  const line = 558;
  const owner = ch(true, line + 100);
  const within = ch(true, line + 100 - HYSTERESIS_PX); // nearer by exactly the hysteresis: no handover
  assert.equal(pickOwner([owner, within], line, owner), owner);
  const beyond = ch(true, line + 100 - HYSTERESIS_PX - 1); // nearer by more: it takes over
  assert.equal(pickOwner([owner, beyond], line, owner), beyond);
  // and the handover does not flap back: the new owner is now held by the same margin
  assert.equal(pickOwner([owner, beyond], line, beyond), beyond);
});

test("pickOwner: a previous owner that is no longer engaged, or no longer near the screen, never holds the marks", () => {
  const line = 558;
  const was = ch(false, line);
  const other = ch(true, line + 200);
  assert.equal(pickOwner([was, other], line, was), other);
  const gone = ch(true, line + 1); // engaged but not among the near chapters (its observer detached it)
  assert.equal(pickOwner([other], line, gone), other);
});
