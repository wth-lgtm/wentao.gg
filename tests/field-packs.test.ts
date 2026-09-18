import { test } from "node:test";
import assert from "node:assert/strict";

import { CAST_CYCLE, PACKS_NARROW, PACKS_QUADS, PACKS_WIDE, PACK_MAX_R, fieldCount, fieldPacks, packCasting, packCentroids, packCount, packOf, packTargets, packVariantFromSearch, type Pack } from "../app/lib/fieldPacks";
import { SEED_FIELD, fieldCamera, fieldScales, keepOutFor, placeWorld, repivot, solveTargets, type Slot } from "../app/lib/fieldLayout";
import { DRIFT, PACK_DRIFT_BASE, driftOffset, packDriftOffset } from "../app/lib/fieldDrift";
import { DYN, createWorld } from "../app/lib/jackDynamics";

const fit1440 = fieldCamera(1440, 900, 112);
const H1_1440 = { left: 144, top: 359, right: 799, bottom: 471 };
const CARD_1440 = { left: 839, top: 280, right: 1296, bottom: 620 };
const ALL: readonly (readonly Pack[])[] = [PACKS_WIDE, PACKS_QUADS, PACKS_NARROW];
const centre = (p: Pack, fit = fit1440) => ({ x: (p.cx * fit.viewW) / 2, y: (p.cy * fit.viewH) / 2 });

test("the compositions: WIDE is the card's fourteen on a 2 u disc under the name plus seven above it (21), QUADS three sevens (21), NARROW one ten (10); fieldCount 21 at ≥ 1280 × 800 and 10 below; the quads override applies only where WIDE does", () => {
  assert.deepEqual(PACKS_WIDE, [{ cx: -0.45, cy: -0.5, n: 14, r: 2.0, swirlGain: 1 }, { cx: -0.55, cy: 0.66, n: 7, r: 0.9, swirlGain: 3 }]);
  assert.deepEqual(PACKS_QUADS, [{ cx: -0.75, cy: -0.6, n: 7, r: 0.9, swirlGain: 3 }, { cx: -0.25, cy: -0.6, n: 7, r: 0.9, swirlGain: 3 }, { cx: -0.5, cy: 0.68, n: 7, r: 0.9, swirlGain: 3 }]);
  assert.deepEqual(PACKS_NARROW, [{ cx: -0.4, cy: -0.5, n: 10, r: 1.4, swirlGain: 1.9 }]);
  assert.equal(packCount(PACKS_WIDE), 21);
  assert.equal(packCount(PACKS_QUADS), 21);
  assert.equal(packCount(PACKS_NARROW), 10);
  assert.equal(PACK_MAX_R, 2.0);
  for (const packs of ALL) for (const p of packs) {
    assert.ok(p.r <= PACK_MAX_R && p.n >= 7 && Math.abs(p.cx) < 1 && Math.abs(p.cy) < 1 && p.swirlGain >= 1, JSON.stringify(p));
    // a lower pack's cy stays ≥ −0.6 at 1440 × 900 or the blob's bottom clips (−0.66 → 951 px)
    assert.ok(p.cy >= -0.6, `cy ${p.cy}`);
  }
  // no pack centre inside the visitor card's x-range (x 1.67..8.08 u at 1440 × 900): its half-strength band leaves less than a body above and below the card, and a pack there flattens into a row under the nav
  for (const packs of [PACKS_WIDE, PACKS_QUADS]) for (const p of packs) assert.ok(centre(p).x < 1.67, `pack at x ${centre(p).x} u is in the card's column`);
  assert.equal(fieldCount(1440, 900), 21);
  assert.equal(fieldCount(1280, 800), 21);
  assert.equal(fieldCount(1279, 800), 10);
  assert.equal(fieldCount(1024, 768), 10);
  assert.equal(fieldCount(1440, 700), 10);
  assert.equal(fieldCount(1366, 768), 10);
  assert.equal(fieldPacks(1440, 900), PACKS_WIDE);
  assert.equal(fieldPacks(1440, 900, "quads"), PACKS_QUADS);
  assert.equal(fieldPacks(1024, 768), PACKS_NARROW);
  assert.equal(fieldPacks(1024, 768, "quads"), PACKS_NARROW, "the override does not apply below the breakpoint");
  assert.equal(packVariantFromSearch("?jacksDebug=1&jacksPacks=quads"), "quads");
  assert.equal(packVariantFromSearch("?jacksPacks=quads&jacksDebug"), "quads");
  assert.equal(packVariantFromSearch("?jacksPacks=quads"), null, "never without the debug flag");
  assert.equal(packVariantFromSearch("?jacksDebug=1"), null);
  assert.equal(packVariantFromSearch("?jacksDebug=1&jacksPacks=other"), null);
  assert.equal(packVariantFromSearch(""), null);
  assert.deepEqual(packOf(PACKS_WIDE), [...Array<number>(14).fill(0), ...Array<number>(7).fill(1)]);
  assert.deepEqual(packOf(PACKS_QUADS), [...Array<number>(7).fill(0), ...Array<number>(7).fill(1), ...Array<number>(7).fill(2)]);
});

test("targets: a Fermat spiral inside r about C = (cx·viewW/2, cy·viewH/2) — every target within r of C, and the members' discs cover more than twice the target disc so they can never all reach their targets: they pack; z ∈ ±{0.35, 0.8, 1.25}, the sign alternating between consecutive members; the spiral's phase is seeded per pack, the z slots are not", () => {
  for (const packs of ALL) {
    const t = packTargets(fit1440, packs, SEED_FIELD);
    assert.equal(t.length, packCount(packs));
    const scales = fieldScales(t.length, SEED_FIELD);
    let i = 0;
    for (const p of packs) {
      const c = centre(p);
      let discArea = 0;
      for (let k = 0; k < p.n; k++, i++) {
        const q = t[i];
        assert.ok([q.x, q.y, q.z].every(Number.isFinite));
        assert.ok(Math.hypot(q.x - c.x, q.y - c.y) < p.r + 1e-9, `member ${k} of a ${p.n}-pack sits ${Math.hypot(q.x - c.x, q.y - c.y)} u from C (r ${p.r})`);
        const mag = 0.35 + (0.9 * ((k >> 1) % 3)) / 2;
        assert.ok(Math.abs(Math.abs(q.z) - mag) < 1e-9 && [0.35, 0.8, 1.25].some((m) => Math.abs(mag - m) < 1e-9), `z ${q.z} at k ${k}`);
        assert.equal(Math.sign(q.z), k % 2 ? -1 : 1);
        if (k > 0) assert.notEqual(Math.sign(q.z), Math.sign(t[i - 1].z), "z alternates");
        discArea += Math.PI * (DYN.BODY_R * scales[i]) ** 2;
      }
      assert.ok(discArea > 2 * Math.PI * p.r * p.r, `${p.n} bodies (${discArea.toFixed(1)} u² of disc) on a ${p.r} u target disc (${(Math.PI * p.r * p.r).toFixed(1)} u²) would not pack`);
    }
    const t2 = packTargets(fit1440, packs, SEED_FIELD + 1);
    assert.notDeepEqual(t2.map((q) => [q.x, q.y]), t.map((q) => [q.x, q.y]), "another seed turns the spiral");
    assert.deepEqual(t2.map((q) => q.z), t.map((q) => q.z), "the z slots do not depend on the seed");
    assert.deepEqual(packTargets(fit1440, packs, SEED_FIELD), t, "deterministic");
  }
  // the raw centroid IS C to within a fraction of a body: a Fermat spiral is balanced
  const raw = packCentroids(packTargets(fit1440, PACKS_WIDE, SEED_FIELD), PACKS_WIDE);
  PACKS_WIDE.forEach((p, pi) => assert.ok(Math.hypot(raw[pi].x - centre(p).x, raw[pi].y - centre(p).y) < 0.2, `raw centroid ${Math.hypot(raw[pi].x - centre(p).x, raw[pi].y - centre(p).y)} u off C`));
});

const tally = (slots: readonly Slot[]) => {
  const fam: Record<string, number> = { accent: 0, white: 0, black: 0 }, glossy: Record<string, number> = { accent: 0, white: 0, black: 0 };
  for (const s of slots) { fam[s.family]++; if (s.finish === "glossy") glossy[s.family]++; }
  return { fam, glossy };
};
const EXPECT: Record<number, ReturnType<typeof tally>> = {
  14: { fam: { accent: 4, white: 6, black: 4 }, glossy: { accent: 1, white: 1, black: 1 } },
  7: { fam: { accent: 2, white: 3, black: 2 }, glossy: { accent: 0, white: 1, black: 1 } },
  10: { fam: { accent: 3, white: 4, black: 3 }, glossy: { accent: 0, white: 1, black: 1 } },
};

test("casting per pack in spiral order from the cycle W A W B W A B, the phase advanced one per round: fourteen → white 6 / accent 4 / black 4 with one glossy per family; seven → 3 / 2 / 2 with a glossy white and black; ten → 4 / 3 / 3 (the plain cycle would give 5 / 3 / 2) with a glossy white and black; WIDE totals accent 6 (5/1), white 9 (7/2), black 6 (4/2) — five glossies of twenty-one; consecutive members never share a family; glossies are never adjacent; deterministic", () => {
  assert.deepEqual(CAST_CYCLE, ["white", "accent", "white", "black", "white", "accent", "black"]);
  for (let i = 0; i < 7; i++) assert.notEqual(CAST_CYCLE[i], CAST_CYCLE[(i + 1) % 7], "no two cyclic neighbours share a family");
  for (const packs of ALL) {
    const cast = packCasting(packs, SEED_FIELD), own = packOf(packs);
    assert.equal(cast.length, packCount(packs));
    assert.deepEqual(packCasting(packs, SEED_FIELD), cast, "deterministic");
    packs.forEach((p, pi) => {
      const g = cast.filter((_, j) => own[j] === pi);
      assert.deepEqual(tally(g), EXPECT[p.n], `a ${p.n}-pack cast ${JSON.stringify(tally(g))}`);
      for (let k = 1; k < g.length; k++) assert.notEqual(g[k].family, g[k - 1].family, `members ${k - 1} and ${k} of a ${p.n}-pack share a family`);
      assert.equal(new Set(g.map((s) => s.family)).size, 3, "no pack is one family");
      const glossyAt = g.map((s, k) => (s.finish === "glossy" ? k : -1)).filter((k) => k >= 0);
      for (let a = 0; a < glossyAt.length; a++) for (let b = a + 1; b < glossyAt.length; b++) assert.ok(Math.abs(glossyAt[a] - glossyAt[b]) >= 2, `glossies at spiral positions ${glossyAt} are adjacent`);
    });
  }
  assert.deepEqual(tally(packCasting(PACKS_WIDE, SEED_FIELD)), { fam: { accent: 6, white: 9, black: 6 }, glossy: { accent: 1, white: 2, black: 2 } });
  assert.equal(packCasting(PACKS_WIDE, SEED_FIELD).filter((s) => s.finish === "glossy").length, 5);
  // the phase advance is what makes ten 4 / 3 / 3 — the plain cycle's first ten are 5 / 3 / 2
  const plain = tally(Array.from({ length: 10 }, (_, k) => ({ family: CAST_CYCLE[k % 7], finish: "matte" as const })));
  assert.deepEqual(plain.fam, { accent: 3, white: 5, black: 2 });
});

test("pivots are the centroids of the SOLVED targets, not the nominal centres: at 1440 × 900 the h1's band pushes six of the lower pack's fourteen down to the band edge — x kept, a line along the name — moving its centroid 0.32 u down; one of the upper seven touches the band and moves its centroid 0.03 u up; repivot hands each body a copy of its pack's centroid and the pack's gain, and a relayout replaces them", () => {
  const scales = fieldScales(21, SEED_FIELD);
  const avoid = [keepOutFor(H1_1440, fit1440, 1), keepOutFor(CARD_1440, fit1440, 0.5)];
  const raw = packTargets(fit1440, PACKS_WIDE, SEED_FIELD);
  const { targets, inBand } = solveTargets(fit1440, raw, scales, avoid);
  assert.deepEqual(inBand, []);
  const cents = packCentroids(targets, PACKS_WIDE), rawCents = packCentroids(raw, PACKS_WIDE);
  const shift = PACKS_WIDE.map((_, pi) => Math.hypot(cents[pi].x - rawCents[pi].x, cents[pi].y - rawCents[pi].y));
  assert.ok(shift[0] > 0.2 && shift[0] < 1.5, `the lower pack's centroid moved ${shift[0]} u off the raw spiral's`);
  assert.ok(shift[1] > 0.02 && shift[1] < 0.5, `the upper pack's centroid moved ${shift[1]} u`);
  assert.ok(cents[0].y < rawCents[0].y - 0.2 && Math.abs(cents[0].x - rawCents[0].x) < 1e-9, "the lower pack moved DOWN, away from the name, x kept");
  assert.ok(cents[1].y > rawCents[1].y + 0.02 && Math.abs(cents[1].x - rawCents[1].x) < 1e-9, "the upper pack moved UP, x kept");
  // a swirl about the nominal centre would turn the lower pack about a point 0.3 u above its members' mean
  assert.ok(Math.abs(cents[0].y - centre(PACKS_WIDE[0]).y) > 0.25, `solved centroid ${cents[0].y} vs nominal ${centre(PACKS_WIDE[0]).y}`);
  // the pushed members sit exactly at the band's edge in projection (the force is zero there), x unchanged
  const h1 = avoid[0];
  let pushed = 0;
  targets.forEach((t, i) => {
    if (Math.hypot(t.x - raw[i].x, t.y - raw[i].y) < 1e-9) return;
    pushed++;
    assert.ok(Math.abs(t.x - raw[i].x) < 1e-9, `member ${i} moved in x`);
    const r = DYN.BODY_R * scales[i], proj = fit1440.z / (fit1440.z - t.z);
    const ex = Math.abs(t.x * proj - h1.cx) - h1.hw, ey = Math.abs(t.y * proj - h1.cy) - h1.hh;
    const d = Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - (r + DYN.KEEP_PAD);
    assert.ok(Math.abs(d - DYN.KEEP_BAND) < 1e-6, `member ${i} sits ${d} u from the h1's inflated box`);
  });
  assert.ok(pushed >= 5, `${pushed} members pushed`);
  const w = createWorld(scales, fit1440, SEED_FIELD);
  placeWorld(w, targets, fit1440);
  assert.ok(w.bodies.every((b) => b.pivot === undefined && b.swirlGain === undefined), "createWorld sets neither — the card's path");
  const owners = packOf(PACKS_WIDE);
  repivot(w, owners.map((p) => cents[p]), owners.map((p) => PACKS_WIDE[p].swirlGain));
  w.bodies.forEach((b, j) => {
    assert.deepEqual(b.pivot, cents[owners[j]]);
    assert.notEqual(b.pivot, cents[owners[j]], "a copy, not the centroid object");
    assert.equal(b.swirlGain, PACKS_WIDE[owners[j]].swirlGain);
  });
  assert.equal(w.bodies.filter((b) => b.swirlGain === 3).length, 7);
  repivot(w, owners.map(() => ({ x: 1, y: 2, z: 3 })), []);
  w.bodies.forEach((b, j) => { assert.deepEqual(b.pivot, { x: 1, y: 2, z: 3 }); assert.equal(b.swirlGain, PACKS_WIDE[owners[j]].swirlGain, "gains untouched when none are handed in"); });
});

test("common-mode drift: every member of pack p shares packDriftOffset(p) = driftOffset at k = 1000 + p — one term per pack, bounded like a body's own, differing between packs and from every member's own term; a home's total excursion is under 2·AMP", () => {
  assert.equal(PACK_DRIFT_BASE, 1000);
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 }, own = { x: 0, y: 0, z: 0 };
  const owners = packOf(PACKS_QUADS);
  let packsDiffer = 0, ownDiffer = 0, samples = 0;
  for (let t = 0; t < 60; t += 0.5) {
    for (let p = 0; p < PACKS_QUADS.length; p++) {
      packDriftOffset(p, t, SEED_FIELD, a);
      driftOffset(PACK_DRIFT_BASE + p, t, SEED_FIELD, b);
      assert.deepEqual(a, b);
      assert.ok(Math.abs(a.x) <= DRIFT.AMP + 1e-12 && Math.abs(a.y) <= DRIFT.AMP + 1e-12 && Math.abs(a.z) <= DRIFT.AMP_Z + 1e-12);
      // the members: body j of pack p gets the same pack term (the scene adds it to each member's own)
      owners.forEach((q, j) => {
        if (q !== p) return;
        driftOffset(j, t, SEED_FIELD, own);
        if (Math.hypot(a.x - own.x, a.y - own.y, a.z - own.z) > 0.01) ownDiffer++;
        samples++;
        assert.ok(Math.abs(own.x + a.x) <= 2 * DRIFT.AMP + 1e-12 && Math.abs(own.z + a.z) <= 2 * DRIFT.AMP_Z + 1e-12, "the total home offset is under 2·AMP");
      });
    }
    packDriftOffset(0, t, SEED_FIELD, a); packDriftOffset(1, t, SEED_FIELD, b);
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.01) packsDiffer++;
  }
  assert.ok(packsDiffer > 100, `packs 0 and 1 differ at ${packsDiffer} of 120 samples`);
  assert.ok(ownDiffer > 0.9 * samples, `a pack's term differs from its members' own at ${ownDiffer} of ${samples} samples`);
});
