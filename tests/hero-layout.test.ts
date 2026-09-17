import { test } from "node:test";
import assert from "node:assert/strict";

import { CASTING, HERO, SEED_HERO, cardBox, cssToWorld, heroCamera, heroCount, keepOut, placeWorld, targetsFor, type HeroRects } from "../app/lib/heroLayout";
import { DYN, createWorld, isResting, setKeepOut, stepWorld } from "../app/lib/jackDynamics";

const TAN = Math.tan((HERO.FOV / 2) * Math.PI / 180);

// DOM rects as the hero lays out at 1440 × 900 (content 1104 wide from x 168; left 7 cols
// 168–795; right 5 cols 835–1272; the h1 at clamp(2.5rem, 9vw, 7rem) = 112 px; the card
// centred on the name), in CSS px relative to the section. Fixtures, not measurements: the
// live scene reads its own DOM.
const R1440: HeroRects = {
  h1: { left: 168, top: 362, right: 795, bottom: 465 },
  role: { left: 168, top: 489, right: 795, bottom: 535 },
  card: { left: 835, top: 265, right: 1272, bottom: 635 },
  cta: { left: 835, top: 651, right: 1272, bottom: 695 },
};
// 1024 × 768: content 976 from x 24; the h1 at 9vw = 92 px; five columns from x 594.
const R1024: HeroRects = {
  h1: { left: 24, top: 318, right: 570, bottom: 403 },
  role: { left: 24, top: 421, right: 570, bottom: 467 },
  card: { left: 594, top: 199, right: 1000, bottom: 569 },
  cta: { left: 594, top: 585, right: 1000, bottom: 629 },
};

// signed distance from a body's disc (radius r + the pad) to the keep-out box, as the world measures it
const clearance = (x: number, y: number, r: number, k: { cx: number; cy: number; hw: number; hh: number }) => {
  const ex = Math.abs(x - k.cx) - k.hw, ey = Math.abs(y - k.cy) - k.hh;
  return Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - (r + DYN.KEEP_PAD);
};

test("the size rule: a unit jack's diameter is 1.25 × the h1's font size — 140 px at 1440 × 900, 115 px at 1024 × 768 — and the camera is solved from it", () => {
  const a = heroCamera(1440, 900, 112);
  assert.ok(Math.abs(a.pxPerUnit * HERO.UNIT_DIAM - 1.25 * 112) < 1e-9, `unit jack ${a.pxPerUnit * HERO.UNIT_DIAM} px`);
  assert.ok(Math.abs(a.pxPerUnit - 63.64) < 0.01);
  assert.ok(Math.abs(a.z - 900 / (a.pxPerUnit * 2 * TAN)) < 1e-9 && a.z > HERO.Z_MIN && a.z < HERO.Z_MAX, `z ${a.z}`);
  assert.ok(Math.abs(a.z - 31.9) < 0.1);
  assert.ok(Math.abs(a.viewH - 2 * a.z * TAN) < 1e-9 && Math.abs(a.viewW - a.viewH * (1440 / 900)) < 1e-9);
  const b = heroCamera(1024, 768, 92.16);
  assert.ok(Math.abs(b.pxPerUnit * HERO.UNIT_DIAM - 1.25 * 92.16) < 1e-9);
  assert.ok(Math.abs(b.z - 33.0) < 0.1 && b.z < HERO.Z_MAX, `z ${b.z}`);
});

test("the clamp re-keys px/u: a 2560 × 1440 window wants z 51, gets 40, and a unit jack is then 179 px (1.6 × the 112 px font)", () => {
  const c = heroCamera(2560, 1440, 112);
  assert.equal(c.z, HERO.Z_MAX);
  assert.ok(Math.abs(c.pxPerUnit - 1440 / c.viewH) < 1e-9, "px/u follows the clamped view, not the size rule");
  assert.ok(Math.abs(c.pxPerUnit * HERO.UNIT_DIAM - 179) < 1);
  // degenerate inputs never produce a NaN camera
  for (const [w, h, f] of [[0, 0, 112], [1440, 900, 0], [1440, 900, Number.NaN]]) {
    const d = heroCamera(w, h, f);
    assert.ok([d.z, d.viewW, d.viewH, d.pxPerUnit].every(Number.isFinite), `${w}×${h} @ ${f}`);
  }
});

test("seven jacks at ≥ 1280 × 800, five below", () => {
  assert.equal(heroCount(1440, 900), 7);
  assert.equal(heroCount(1280, 800), 7);
  assert.equal(heroCount(1279, 800), 5);
  assert.equal(heroCount(1280, 799), 5);
  assert.equal(heroCount(1024, 768), 5);
  assert.equal(CASTING.length, 7);
});

test("css → world: the canvas centre is the origin, screen y grows downward so a rect's top is its larger world y", () => {
  const fit = heroCamera(1440, 900, 112);
  const c = cssToWorld({ left: 720, top: 450, right: 720, bottom: 450 }, fit);
  assert.ok(Math.abs(c.x0) < 1e-9 && Math.abs(c.y0) < 1e-9);
  const h = cssToWorld(R1440.h1, fit);
  assert.ok(h.x0 < h.x1 && h.y0 < h.y1);
  assert.ok(Math.abs(h.x0 - (168 - 720) / fit.pxPerUnit) < 1e-9 && Math.abs(h.y1 - (450 - 362) / fit.pxPerUnit) < 1e-9);
  const k = keepOut(R1440, fit);
  // the union of the h1 and the role line: same columns, from the h1's top to the role's bottom
  assert.ok(Math.abs(k.cx - (h.x0 + h.x1) / 2) < 1e-9 && Math.abs(k.hw - (h.x1 - h.x0) / 2) < 1e-9);
  const r = cssToWorld(R1440.role, fit);
  assert.ok(Math.abs(k.cy - (r.y0 + h.y1) / 2) < 1e-9 && Math.abs(k.hh - (h.y1 - r.y0) / 2) < 1e-9);
});

test("targets at 1440 × 900: seven, cast as the brief, every one ≥ BAND clear of the inflated keep-out so the band's force is zero at rest, T1/T2 a touching pair", () => {
  const fit = heroCamera(1440, 900, 112);
  const k = keepOut(R1440, fit);
  const t = targetsFor(R1440, fit, 7);
  assert.equal(t.length, 7);
  t.forEach((p, i) => {
    assert.ok([p.x, p.y, p.z].every(Number.isFinite));
    assert.equal(p.z, CASTING[i].z);
    const r = DYN.BODY_R * CASTING[i].scale;
    const d = clearance(p.x, p.y, r, k);
    assert.ok(d >= DYN.KEEP_BAND - 1e-9, `T${i + 1} sits ${d} u from the inflated keep-out, inside the ${DYN.KEEP_BAND} u band`);
  });
  const h = cssToWorld(R1440.h1, fit), card = cssToWorld(R1440.card, fit), cta = cssToWorld(R1440.cta, fit), role = cssToWorld(R1440.role, fit);
  // T1 under the role line, left-aligned to the wordmark; T2 touching it (targets closer than the radii sum)
  assert.ok(t[0].y < role.y0 && t[0].x > h.x0 && t[0].x < h.x0 + 3);
  const gap = Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y, t[1].z - t[0].z);
  assert.ok(gap < DYN.BODY_R * (CASTING[0].scale + CASTING[1].scale), `T1–T2 ${gap} u apart: not a resting pair`);
  assert.ok(t[1].x > t[0].x && t[1].y <= t[0].y, "T2 is right of T1 and no higher");
  // T3 above the name, nearer the camera; T4 above the card's right end, farther
  assert.ok(t[2].y > h.y1 && t[2].z > 0);
  assert.ok(t[3].y > card.y1 && t[3].x > card.x0 && t[3].x < card.x1 && t[3].z < 0);
  // T5/T6 under the CTA; T7 low, in the gap between the wordmark's right end and the card, the farthest
  assert.ok(t[4].y < cta.y0 && t[5].y < cta.y0 && t[5].x > t[4].x);
  assert.ok(t[6].x > (h.x0 + h.x1) / 2 && t[6].x < card.x0 && t[6].y < role.y0 && t[6].z === -2, `T7 at (${t[6].x}, ${t[6].y}, ${t[6].z})`);
  // five: the first five slots, the same points
  const five = targetsFor(R1440, fit, 5);
  assert.deepEqual(five, t.slice(0, 5));
  // no target parks a disc inside the card ∪ CTA glass: the brief's T7 anchor (h1.right + 0.3 D,
  // x 831 px) reached 50 px under the pill (cta.left 835) — it is pushed clear along the nearest face
  const g = cardBox(R1440, fit);
  t.forEach((p, i) => assert.ok(clearance(p.x, p.y, DYN.BODY_R * CASTING[i].scale, g) >= -DYN.KEEP_PAD - 1e-9, `T${i + 1}'s disc is inside the card box`));
  const rawT7x = h.x1 + 0.3 * HERO.UNIT_DIAM * CASTING[6].scale;
  assert.ok(Math.abs(rawT7x * fit.pxPerUnit + 720 - 831) < 1, `the brief's T7 anchor is x ${rawT7x * fit.pxPerUnit + 720} px`);
  // T7 steps LEFT of the glass (its y is the brief's), and its target does not overlap T5's — the trio must not jam
  const r7 = DYN.BODY_R * CASTING[6].scale, r5 = DYN.BODY_R * CASTING[4].scale;
  assert.ok(t[6].x + r7 + DYN.KEEP_PAD <= g.cx - g.hw + 1e-9, `T7's disc reaches x ${t[6].x + r7} into the glass at ${g.cx - g.hw}`);
  assert.ok(Math.abs(t[6].y - (role.y0 - 1.5 * HERO.UNIT_DIAM * CASTING[6].scale)) < 1e-9, "T7 keeps the brief's y");
  assert.ok(Math.hypot(t[6].x - t[4].x, t[6].y - t[4].y) >= r5 + r7, `T5 and T7 targets ${Math.hypot(t[6].x - t[4].x, t[6].y - t[4].y)} u apart overlap (radii ${r5 + r7})`);
});

test("targets at 1024 × 768: five, all clear of the band, none clipped past the canvas by more than a radius", () => {
  const fit = heroCamera(1024, 768, 92.16);
  const k = keepOut(R1024, fit);
  const t = targetsFor(R1024, fit, heroCount(1024, 768));
  assert.equal(t.length, 5);
  t.forEach((p, i) => {
    const r = DYN.BODY_R * CASTING[i].scale;
    assert.ok(clearance(p.x, p.y, r, k) >= DYN.KEEP_BAND - 1e-9, `T${i + 1} inside the band`);
    assert.ok(Math.abs(p.x) < fit.viewW / 2 + r && Math.abs(p.y) < fit.viewH / 2 + r, `T${i + 1} at (${p.x}, ${p.y}) is off the canvas`);
  });
});

test("the entrance spawns beyond the NEAREST view edge by 1.5 D with vel = −2·(pos − target), and no fly-in crosses the name", () => {
  const fit = heroCamera(1440, 900, 112);
  const t = targetsFor(R1440, fit, 7);
  const k = keepOut(R1440, fit);
  const w = createWorld(CASTING.map((c) => c.scale), fit, SEED_HERO);
  placeWorld(w, t, fit);
  w.bodies.forEach((b, i) => {
    const D = HERO.UNIT_DIAM * CASTING[i].scale;
    assert.deepEqual(b.target, t[i]);
    const beyondX = Math.abs(b.pos.x) - fit.viewW / 2, beyondY = Math.abs(b.pos.y) - fit.viewH / 2;
    assert.ok(Math.abs(Math.max(beyondX, beyondY) - HERO.SPAWN_D * D) < 1e-9, `T${i + 1} spawned ${Math.max(beyondX, beyondY)} u beyond the edge, wanted ${HERO.SPAWN_D * D}`);
    assert.ok((beyondX > 0) !== (beyondY > 0), "one axis moved, the other kept");
    assert.ok(Math.abs(b.vel.x - DYN.SPAWN_VEL * (b.pos.x - t[i].x)) < 1e-9 && Math.abs(b.vel.y - DYN.SPAWN_VEL * (b.pos.y - t[i].y)) < 1e-9 && b.vel.z === 0);
    // the straight fly-in path stays out of the h1 ∪ role box inflated by the body's radius
    for (let s = 0; s <= 1; s += 1 / 64) {
      const x = b.pos.x + (t[i].x - b.pos.x) * s, y = b.pos.y + (t[i].y - b.pos.y) * s;
      assert.ok(clearance(x, y, b.r, k) > -DYN.KEEP_PAD, `T${i + 1}'s fly-in crosses the name at s ${s}`);
    }
  });
});

test("the whole entrance in node: over 10 s alive and the fall to rest, no body's disc ever covers the letters (penetration < 0.2 u), and the pack rests", () => {
  const fit = heroCamera(1440, 900, 112);
  const t = targetsFor(R1440, fit, 7);
  const k = keepOut(R1440, fit);
  const w = createWorld(CASTING.map((c) => c.scale), fit, SEED_HERO);
  placeWorld(w, t, fit);
  setKeepOut(w, [k], fit.z);
  let worst = Infinity;
  const probe = () => { for (const b of w.bodies) { const s = fit.z / (fit.z - b.pos.z); worst = Math.min(worst, clearance(b.pos.x * s, b.pos.y * s, b.r, k)); } };
  for (let i = 0; i < 10 * 60; i++) { stepWorld(w, 1 / 60, null, 1); probe(); }
  let E = 1, restAt = -1;
  const t0 = w.time;
  for (let i = 0; i < 12 * 60 && restAt < 0; i++) {
    E = Math.max(0, E - 1 / 120);
    if (isResting(w, stepWorld(w, 1 / 60, null, E), E)) restAt = w.time - t0;
    probe();
  }
  assert.ok(worst > -0.2, `a body reached ${-worst} u into the inflated keep-out`);
  assert.ok(restAt > 0, "the hero pack rests");
  assert.ok(restAt < 12, `rest took ${restAt} s`);
});
