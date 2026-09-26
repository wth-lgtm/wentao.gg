// The visitor card's three map projections, their lattices and the tether, as pure maths.
// Shared by the data generator (scripts/gen-world.ts), the three map treatments
// (app/components/map/*) and the tests, so the land the generator baked and the pin the
// card drops are projected by the same lines of code.
//
// Conventions: longitudes and latitudes in degrees; projected `y` is NORTH-UP (a map
// frame flips it for SVG); every function is total over finite input and never throws.

import { greatCirclePoints, type LatLon } from "./telemetry";

export type XY = { x: number; y: number };
const RAD = Math.PI / 180;

// ── Miller cylindrical (the DOTS map) ────────────────────────────────────────
// Mercator's familiar shape — Europe and North America as tall as people picture them —
// without Mercator's infinite poles. x = λ, y = 1.25·ln tan(π/4 + 0.4φ).
export function miller(lon: number, lat: number): XY {
  return { x: lon * RAD, y: 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD)) };
}

export function millerInverse(x: number, y: number): LatLon {
  return { lon: x / RAD, lat: (2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI) / RAD };
}

// ── Equal Earth (the OUTLINE map) ────────────────────────────────────────────
// Šavrič, Patterson & Jenny (2018): an equal-area pseudocylindric with the rounded sides
// of an atlas world map. Unit sphere: x ∈ ±2.7066 at the equator, y(±90°) = ±1.3173.
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const EE_M = Math.sqrt(3) / 2;

export function equalEarth(lon: number, lat: number): XY {
  const l = lon * RAD;
  const t = Math.asin(EE_M * Math.sin(lat * RAD));
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  return {
    x: (l * Math.cos(t)) / (EE_M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
    y: t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)),
  };
}

// ── Orthographic (the GLOBE) ─────────────────────────────────────────────────
// The unit vector of a lon/lat (X toward 0°E, Y toward 90°E, Z north), computed once per
// dot so a frame of the settle costs a rotation, not trigonometry.
export type Vec3 = [number, number, number];
export function toUnit(lon: number, lat: number): Vec3 {
  const p = lat * RAD;
  const l = lon * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

// The view centred on (lon0, lat0): x right, y up, z toward the viewer (visible when z > 0).
export type Rotation = { c0: number; s0: number; cp: number; sp: number };
export function rotation(lon0: number, lat0: number): Rotation {
  return { c0: Math.cos(lon0 * RAD), s0: Math.sin(lon0 * RAD), cp: Math.cos(lat0 * RAD), sp: Math.sin(lat0 * RAD) };
}
export function rotate(r: Rotation, v: Vec3): { x: number; y: number; z: number } {
  const a = v[0] * r.c0 + v[1] * r.s0; // toward the centre meridian
  const b = v[1] * r.c0 - v[0] * r.s0; // east of it
  return { x: b, y: r.cp * v[2] - r.sp * a, z: r.sp * v[2] + r.cp * a };
}
export function orthographic(lon: number, lat: number, lon0: number, lat0: number) {
  return rotate(rotation(lon0, lat0), toUnit(lon, lat));
}

// The globe never tips further than this toward a pole: a visitor in Tromsø still gets a
// globe with an equator on it, not a polar cap that reads as nothing in particular.
export const GLOBE_MAX_TILT = 45;
export function globeCentre(fix: LatLon): LatLon {
  return { lon: wrapLon(fix.lon), lat: Math.max(-GLOBE_MAX_TILT, Math.min(GLOBE_MAX_TILT, fix.lat)) };
}

export function wrapLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon; // exact: no float residue from a no-op wrap
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
}

/** The signed shortest turn from one longitude to another, in (-180, 180]. */
export function lonDelta(from: number, to: number): number {
  const d = wrapLon(to - from);
  return d === -180 ? 180 : d;
}

// ── Lattices the generator bakes and the treatments rebuild ──────────────────
// The GLOBE's dots: rings of latitude `step` degrees apart, each ring holding as many
// dots as its circumference allows at the same spacing, so the dots stay evenly spaced
// on the sphere rather than crowding at the poles. The data file carries one bit per
// dot in this exact order; the order is the contract, so it lives here, once.
export function sphereLattice(step: number): LatLon[] {
  const out: LatLon[] = [];
  const rings = Math.round(180 / step);
  for (let k = 0; k < rings; k++) {
    const lat = 90 - (k + 0.5) * (180 / rings);
    const n = Math.max(1, Math.round((360 * Math.cos(lat * RAD)) / step));
    for (let i = 0; i < n; i++) out.push({ lat, lon: -180 + ((i + 0.5) * 360) / n });
  }
  return out;
}

// The DOTS map's grid: square cells on the Miller plane, `cols` across the full 360°,
// from latTop down to (about) latBottom — the row count is rounded so cells stay square.
export type MillerGrid = { cols: number; rows: number; yTop: number; cell: number };
export function millerGrid(cols: number, latTop: number, latBottom: number): MillerGrid {
  const cell = (2 * Math.PI) / cols;
  const yTop = miller(0, latTop).y;
  const rows = Math.round((yTop - miller(0, latBottom).y) / cell);
  return { cols, rows, yTop, cell };
}
/** A lon/lat in grid units (0..cols, 0..rows, y down), unclamped. */
export function toGrid(g: MillerGrid, lon: number, lat: number): XY {
  const p = miller(lon, lat);
  return { x: (p.x + Math.PI) / g.cell, y: (g.yTop - p.y) / g.cell };
}
/** The lon/lat at the centre of grid cell (c, r). */
export function cellCentre(g: MillerGrid, c: number, r: number): LatLon {
  return millerInverse(-Math.PI + (c + 0.5) * g.cell, g.yTop - (r + 0.5) * g.cell);
}

// The OUTLINE map's frame: Equal Earth scaled so the equator spans `width` units, cropped
// to [latBottom, latTop]; y down.
export type EqualEarthFrame = { width: number; height: number; scale: number; yTop: number };
export function equalEarthFrame(width: number, latTop: number, latBottom: number): EqualEarthFrame {
  const scale = width / (2 * equalEarth(180, 0).x);
  const yTop = equalEarth(0, latTop).y;
  return { width, height: (yTop - equalEarth(0, latBottom).y) * scale, scale, yTop };
}
export function toEqualEarth(f: EqualEarthFrame, lon: number, lat: number): XY {
  const p = equalEarth(lon, lat);
  return { x: f.width / 2 + p.x * f.scale, y: (f.yTop - p.y) * f.scale };
}

// ── Bits ─────────────────────────────────────────────────────────────────────
// One bit per lattice point, most significant bit first, base64. Both directions live here
// so the generator and the page cannot disagree about the packing.
export function packBits(bits: ArrayLike<boolean | number>): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function unpackBits(b64: string, n: number): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return out;
}

// ── The tether ───────────────────────────────────────────────────────────────
// Home → visitor along the TRUE great circle (telemetry.greatCirclePoints), projected
// flat and cut wherever it crosses the antimeridian, so a Tokyo visitor's line leaves one
// edge and enters the other instead of being dragged backwards across the whole map.
export function flatTether(
  from: LatLon,
  to: LatLon,
  project: (lon: number, lat: number) => XY,
  steps = 96
): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] = [];
  let prev: LatLon | null = null;
  for (const p of greatCirclePoints(from, to, steps)) {
    if (prev && Math.abs(p.lon - prev.lon) > 180) {
      // Close the run exactly on the seam: interpolate the crossing latitude.
      const east = prev.lon > 0 ? 180 : -180;
      const span = 360 - Math.abs(p.lon - prev.lon);
      const t = span > 0 ? Math.abs(east - prev.lon) / span : 0;
      const lat = prev.lat + (p.lat - prev.lat) * t;
      run.push(project(east, lat));
      if (run.length > 1) runs.push(run);
      run = [project(-east, lat)];
    }
    run.push(project(p.lon, p.lat));
    prev = p;
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** The visible (z > 0) runs of the tether on the globe, in unit-disc coordinates. */
export function globeTether(from: LatLon, to: LatLon, r: Rotation, steps = 96): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] = [];
  for (const p of greatCirclePoints(from, to, steps)) {
    const q = rotate(r, toUnit(p.lon, p.lat));
    if (q.z > 0) run.push({ x: q.x, y: q.y });
    else if (run.length) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export function pathOf(runs: XY[][], flipY = false, digits = 2): string {
  let d = "";
  for (const run of runs) {
    run.forEach((p, i) => {
      d += `${i ? "L" : "M"}${p.x.toFixed(digits)} ${(flipY ? -p.y : p.y).toFixed(digits)}`;
    });
  }
  return d;
}
