import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cellCentre,
  equalEarth,
  equalEarthFrame,
  flatTether,
  globeCentre,
  globeTether,
  lonDelta,
  miller,
  millerGrid,
  millerInverse,
  orthographic,
  packBits,
  pathOf,
  rotate,
  rotation,
  sphereLattice,
  toEqualEarth,
  toGrid,
  toUnit,
  unpackBits,
  wrapLon,
} from "../app/lib/mapProjection";
import { HOME } from "../app/lib/telemetry";

// The visitor card's projections. The generator bakes the land with these and the page
// drops the pin with them, so a drift here puts the pin in the sea; the numbers below are
// the published constants of each projection, not values read back from the code.

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} ≉ ${b} (±${eps})`);

test("miller: the origin, the published 84° ordinate, and a clean round trip", () => {
  const o = miller(0, 0);
  close(o.x, 0);
  close(o.y, 0);
  // y = 1.25·ln tan(45° + 0.4·84°) = 2.0012 — the top of the DOTS crop.
  close(miller(0, 84).y, 2.0012, 1e-3);
  close(miller(180, 0).x, Math.PI);
  for (const lat of [-58, -30, 0, 12.5, 45, 84])
    for (const lon of [-179, -90, 0, 33.3, 179]) {
      const p = miller(lon, lat);
      const back = millerInverse(p.x, p.y);
      close(back.lat, lat, 1e-9);
      close(back.lon, lon, 1e-9);
    }
});

test("equalEarth: the published extents, and it is equal-area", () => {
  // Šavrič et al. 2018: x(180°, 0) = 2.7066, y(90°) = 1.3173 on the unit sphere.
  close(equalEarth(180, 0).x, 2.7066, 1e-4);
  close(equalEarth(0, 90).y, 1.3173, 1e-4);
  close(equalEarth(-180, 0).x, -2.7066, 1e-4);
  // Equal area: a 10°×10° cell at 60°N covers (sin70 − sin60)/(sin10 − sin0) of the
  // equatorial cell's area on the sphere; its projected quad must too (within 1 %).
  const quad = (lon: number, lat: number) => {
    const a = equalEarth(lon, lat), b = equalEarth(lon + 10, lat), c = equalEarth(lon + 10, lat + 10), d = equalEarth(lon, lat + 10);
    return Math.abs((a.x * b.y - b.x * a.y + b.x * c.y - c.x * b.y + c.x * d.y - d.x * c.y + d.x * a.y - a.x * d.y) / 2);
  };
  const s = (d: number) => Math.sin((d * Math.PI) / 180);
  const want = (s(70) - s(60)) / (s(10) - s(0));
  close(quad(0, 60) / quad(0, 0), want, want * 0.01);
});

test("orthographic: the centre faces the viewer, 90° away is the limb, the antipode is hidden", () => {
  const c = orthographic(-122.4, 37.8, -122.4, 37.8);
  close(c.x, 0, 1e-12);
  close(c.y, 0, 1e-12);
  close(c.z, 1, 1e-12);
  const east = orthographic(90, 0, 0, 0);
  close(east.x, 1, 1e-12);
  close(east.z, 0, 1e-12);
  close(orthographic(0, 90, 0, 0).y, 1, 1e-12); // north is up
  assert.ok(orthographic(57.6, -37.8, -122.4, 37.8).z < -0.999); // the antipode
  // The per-dot fast path is the same projection.
  const r = rotation(40, 20);
  for (const [lon, lat] of [[10, 5], [-70, 60], [140, -30]]) {
    const a = rotate(r, toUnit(lon, lat));
    const b = orthographic(lon, lat, 40, 20);
    close(a.x, b.x, 1e-12);
    close(a.y, b.y, 1e-12);
    close(a.z, b.z, 1e-12);
  }
});

test("globeCentre / wrapLon / lonDelta: the tilt cap and the short way round", () => {
  assert.deepEqual(globeCentre({ lat: 69.6, lon: 18.9 }), { lat: 45, lon: 18.9 }); // Tromsø: tipped no further than 45°
  assert.deepEqual(globeCentre({ lat: -54.8, lon: -68.3 }), { lat: -45, lon: -68.3 });
  assert.equal(globeCentre({ lat: 10, lon: 190 }).lon, -170);
  assert.equal(wrapLon(180), 180);
  assert.equal(wrapLon(-180), -180);
  assert.equal(wrapLon(540), 180);
  assert.equal(lonDelta(170, -170), 20); // east across the antimeridian, not 340° west
  assert.equal(lonDelta(-170, 170), -20);
  assert.equal(lonDelta(0, 180), 180);
});

test("sphereLattice: evenly spaced dots, as many as the sphere holds", () => {
  const step = 1.8;
  const pts = sphereLattice(step);
  const rad = (step * Math.PI) / 180;
  const ideal = (4 * Math.PI) / (rad * rad);
  assert.ok(Math.abs(pts.length - ideal) / ideal < 0.03, `${pts.length} dots vs ${ideal.toFixed(0)} ideal`);
  // On every ring the spacing along the ring is the step (to rounding), pole or equator.
  const rings = new Map<number, number>();
  for (const p of pts) rings.set(p.lat, (rings.get(p.lat) ?? 0) + 1);
  for (const [lat, n] of rings) {
    const spacing = (360 * Math.cos((lat * Math.PI) / 180)) / n;
    if (n > 3) assert.ok(Math.abs(spacing - step) / step < 0.2, `ring ${lat.toFixed(1)}: ${spacing.toFixed(2)}°`);
  }
  assert.ok(pts.every((p) => Math.abs(p.lat) < 90 && p.lon > -180 && p.lon < 180));
});

test("millerGrid: square cells, and a cell centre lands back in its own cell", () => {
  const g = millerGrid(150, 84, -58);
  assert.equal(g.rows, 75);
  for (const [c, r] of [[0, 0], [74, 37], [149, 74], [30, 10]]) {
    const p = cellCentre(g, c, r);
    const q = toGrid(g, p.lon, p.lat);
    close(q.x, c + 0.5, 1e-9);
    close(q.y, r + 0.5, 1e-9);
  }
});

test("equalEarthFrame: the crop's top and bottom are the frame's edges", () => {
  const f = equalEarthFrame(1000, 84, -58);
  close(toEqualEarth(f, 0, 84).y, 0, 1e-9);
  close(toEqualEarth(f, 0, -58).y, f.height, 1e-9);
  close(toEqualEarth(f, -180, 0).x, 0, 1e-9);
  close(toEqualEarth(f, 180, 0).x, 1000, 1e-9);
  close(toEqualEarth(f, 0, 0).x, 500, 1e-9);
});

test("packBits / unpackBits: a round trip, including a ragged last byte", () => {
  const bits = Array.from({ length: 29 }, (_, i) => (i * 7) % 3 === 0);
  const back = unpackBits(packBits(bits), bits.length);
  assert.deepEqual([...back].map(Boolean), bits);
});

test("flatTether: San Francisco → Tokyo leaves one edge and enters the other", () => {
  const g = millerGrid(150, 84, -58);
  const runs = flatTether(HOME, { lat: 35.68, lon: 139.65 }, (lon, lat) => toGrid(g, lon, lat));
  assert.equal(runs.length, 2);
  // The first run ends ON the west edge (x = 0) and the second starts on the east (x = cols).
  close(runs[0][runs[0].length - 1].x, 0, 1e-9);
  close(runs[1][0].x, 150, 1e-9);
  // The seam point is the same latitude on both sides.
  close(runs[0][runs[0].length - 1].y, runs[1][0].y, 1e-9);
});

test("flatTether: San Francisco → London is one run that bows NORTH", () => {
  const g = millerGrid(150, 84, -58);
  const runs = flatTether(HOME, { lat: 51.51, lon: -0.13 }, (lon, lat) => toGrid(g, lon, lat));
  assert.equal(runs.length, 1);
  const ys = runs[0].map((p) => p.y);
  const ends = Math.min(ys[0], ys[ys.length - 1]);
  assert.ok(Math.min(...ys) < ends - 5, "the great circle climbs well north of both ends (smaller y)");
});

test("globeTether: only the near side is drawn, and it ends at the centred visitor", () => {
  const london = { lat: 51.51, lon: -0.13 };
  const runs = globeTether(HOME, london, rotation(london.lon, london.lat));
  assert.ok(runs.length >= 1);
  const last = runs[runs.length - 1];
  const end = last[last.length - 1];
  close(Math.hypot(end.x, end.y), 0, 1e-9);
  assert.ok(runs.flat().every((p) => Math.hypot(p.x, p.y) <= 1 + 1e-9));
  assert.match(pathOf(runs, true), /^M/);
  // Turned to face Tokyo, San Francisco (74° away) is on the near side; turned to face
  // Madrid's antipode it is not, and nothing is drawn.
  assert.ok(globeTether(HOME, { lat: 35.68, lon: 139.65 }, rotation(139.65, 35.68)).length === 1);
  assert.equal(globeTether(HOME, { lat: 40.4, lon: -3.7 }, rotation(176.3, -40.4)).length, 0);
});
