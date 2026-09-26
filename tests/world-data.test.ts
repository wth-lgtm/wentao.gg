import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DOTS_GRID } from "../app/components/map/worldDots";
import { GLOBE_DOTS } from "../app/components/map/worldGlobe";
import { OUTLINE } from "../app/components/map/worldOutline";
import { DOTS_FRAME, GLOBE_STEP, MAP_ASPECT, OUTLINE_FRAME } from "../app/components/map/frames";
import { equalEarthFrame, millerGrid, sphereLattice, toGrid, toUnit, unpackBits } from "../app/lib/mapProjection";

// The baked world maps (scripts/gen-world.ts from Natural Earth 110m land). These hold the
// data to the frames the page projects with, and hold the land where the world keeps it:
// a regenerated file with a shifted row or a flipped bit fails here, not on a visitor's card.

const dotsLand = unpackBits(DOTS_GRID.bits, DOTS_GRID.cols * DOTS_GRID.rows);
const globeLand = unpackBits(GLOBE_DOTS.bits, GLOBE_DOTS.count);
const lattice = sphereLattice(GLOBE_DOTS.step);

// Inland points (no coastal city: at 2.4° a coast can land in either cell) and open ocean.
const LAND = {
  Madrid: [40.4, -3.7],
  Moscow: [55.8, 37.6],
  Delhi: [28.6, 77.2],
  Chengdu: [30.7, 104.1],
  Nairobi: [-1.3, 36.8],
  Kinshasa: [-4.3, 15.3],
  Brasília: [-15.8, -47.9],
  Denver: [39.7, -105.0],
  Chicago: [41.9, -87.9],
  "Alice Springs": [-23.7, 133.9],
  Riyadh: [24.7, 46.7],
  "Greenland ice": [72, -40],
} as const;
const SEA = {
  "mid-Pacific": [0, -150],
  "mid-Atlantic": [30, -40],
  "Indian Ocean": [-20, 80],
  "South Atlantic": [-35, -15],
  "North Pacific": [40, -160],
  Tasman: [-40, 160],
} as const;

function dotsAt(lat: number, lon: number): boolean {
  const g = millerGrid(DOTS_GRID.cols, DOTS_GRID.latTop, DOTS_GRID.latBottom);
  const p = toGrid(g, lon, lat);
  return dotsLand[Math.floor(p.y) * DOTS_GRID.cols + Math.floor(p.x)] === 1;
}
function globeAt(lat: number, lon: number): boolean {
  const v = toUnit(lon, lat);
  let best = -2, bi = 0;
  lattice.forEach((p, i) => {
    const u = toUnit(p.lon, p.lat);
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    if (d > best) { best = d; bi = i; }
  });
  return globeLand[bi] === 1;
}

test("the data files are baked to the page's frames", () => {
  const g = millerGrid(DOTS_FRAME.cols, DOTS_FRAME.latTop, DOTS_FRAME.latBottom);
  assert.equal(DOTS_GRID.cols, g.cols);
  assert.equal(DOTS_GRID.rows, g.rows);
  assert.equal(DOTS_GRID.latTop, DOTS_FRAME.latTop);
  assert.equal(DOTS_GRID.latBottom, DOTS_FRAME.latBottom);
  assert.equal(GLOBE_DOTS.step, GLOBE_STEP);
  assert.equal(GLOBE_DOTS.count, lattice.length);
  assert.equal(OUTLINE.width, OUTLINE_FRAME.width);
  assert.equal(OUTLINE.latTop, OUTLINE_FRAME.latTop);
  assert.equal(OUTLINE.latBottom, OUTLINE_FRAME.latBottom);
  // The box LocatorMap reserves before a treatment's chunk loads is that treatment's aspect.
  assert.equal(MAP_ASPECT.dots, DOTS_GRID.cols / DOTS_GRID.rows);
  const f = equalEarthFrame(OUTLINE.width, OUTLINE.latTop, OUTLINE.latBottom);
  assert.equal(MAP_ASPECT.outline, f.width / f.height);
});

test("the land counts in the headers are the bits in the files", () => {
  assert.equal(dotsLand.reduce((a, b) => a + b, 0), DOTS_GRID.land);
  assert.equal(globeLand.reduce((a, b) => a + b, 0), GLOBE_DOTS.land);
});

test("the globe is 29 % land, like the Earth", () => {
  // Land is 29.2 % of Earth's surface; the lattice is equal-spaced on the sphere, so its
  // land fraction is an area fraction. Antarctica is in (the globe is not cropped).
  const frac = GLOBE_DOTS.land / GLOBE_DOTS.count;
  assert.ok(Math.abs(frac - 0.292) < 0.02, `globe land fraction ${frac.toFixed(3)}`);
});

test("inland places are land and open ocean is sea, on both dot maps", () => {
  for (const [name, [lat, lon]] of Object.entries(LAND)) {
    assert.ok(dotsAt(lat, lon), `DOTS: ${name} should be land`);
    assert.ok(globeAt(lat, lon), `GLOBE: ${name} should be land`);
  }
  for (const [name, [lat, lon]] of Object.entries(SEA)) {
    assert.ok(!dotsAt(lat, lon), `DOTS: ${name} should be sea`);
    assert.ok(!globeAt(lat, lon), `GLOBE: ${name} should be sea`);
  }
});

test("the outline path: one closed ring per M, every point inside the frame", () => {
  const f = equalEarthFrame(OUTLINE.width, OUTLINE.latTop, OUTLINE.latBottom);
  assert.equal((OUTLINE.d.match(/M/g) ?? []).length, OUTLINE.rings);
  assert.equal((OUTLINE.d.match(/z/g) ?? []).length, OUTLINE.rings);
  assert.ok(OUTLINE.rings >= 50, "the continents and the large islands");
  // Walk the path: M x y l dx dy dx dy ... z (relative after the l).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ring of OUTLINE.d.split("z").filter(Boolean)) {
    const m = ring.match(/^M(-?\d+)(?: |(?=-))(-?\d+)l(.*)$/);
    assert.ok(m, `ring parses: ${ring.slice(0, 30)}`);
    let x = +m[1], y = +m[2];
    const nums = (m[3].match(/-?\d+/g) ?? []).map(Number);
    assert.equal(nums.length % 2, 0);
    const seen = [[x, y]];
    for (let i = 0; i < nums.length; i += 2) {
      x += nums[i];
      y += nums[i + 1];
      seen.push([x, y]);
    }
    for (const [px, py] of seen) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  }
  assert.ok(minX >= -1 && maxX <= f.width + 1, `x ${minX}..${maxX}`);
  assert.ok(minY >= -1 && maxY <= f.height + 1, `y ${minY}..${maxY}`);
  // And the world fills it: Alaska/Chukotka near both sides, the Arctic near the top,
  // Tierra del Fuego near the bottom.
  assert.ok(minX < 0.2 * f.width && maxX > 0.9 * f.width);
  assert.ok(minY < 0.05 * f.height && maxY > 0.95 * f.height);
});

test("provenance: one source, one hash, the generator named in every file", () => {
  const files = ["worldDots", "worldGlobe", "worldOutline"].map((n) => readFileSync(`app/components/map/${n}.ts`, "utf8"));
  const hashes = files.map((t) => t.match(/Source sha256: ([0-9a-f]{64})/)?.[1]);
  assert.ok(hashes.every((h) => h && h === hashes[0]), "all three baked from the same file");
  assert.ok(files.every((t) => t.startsWith("// AUTO-GENERATED by scripts/gen-world.ts")));
  assert.ok(files.every((t) => t.includes("Natural Earth 1:110m land (public domain)")));
});
