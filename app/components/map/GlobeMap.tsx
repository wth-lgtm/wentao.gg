"use client";

// GLOBE — an orthographic dot globe turned to face the visitor. SVG, not WebGL (no new
// context): ~3,700 land dots precomputed as unit vectors, so a frame of the settle is one
// rotation per dot and three path strings written straight to the DOM through refs — React
// renders the globe once and never reconciles it per frame.
//
// Motion: a slow settle, not a spin — it eases the last ~35° into place and stops (zero
// frames at rest). A fix too far round the globe to settle toward is cut to, under a short
// fade, and settled from 35° out. Reduced motion: the settled view, no ring.
//
// Light: one source, upper right (ESCAPEMENT law 3) — the sphere's faint shading and the
// dots thinning toward the limb are the only depth cues; nothing glows.

import { memo, useId, useLayoutEffect, useRef, useState } from "react";
import { GLOBE_DOTS } from "./worldGlobe";
import {
  globeCentre,
  globeTether,
  lonDelta,
  pathOf,
  rotate,
  rotation,
  sphereLattice,
  toUnit,
  unpackBits,
  wrapLon,
  type Rotation,
} from "../../lib/mapProjection";
import { HOME, type LatLon } from "../../lib/telemetry";

const LAND: Float64Array = (() => {
  const lattice = sphereLattice(GLOBE_DOTS.step);
  const bits = unpackBits(GLOBE_DOTS.bits, GLOBE_DOTS.count);
  const out: number[] = [];
  lattice.forEach((p, i) => {
    if (bits[i]) out.push(...toUnit(p.lon, p.lat));
  });
  return Float64Array.from(out);
})();

// Graticule every 30°, sampled every 5°: meridians pole to pole, parallels at ±30 / ±60 / 0.
const GRATICULE: Float64Array[] = (() => {
  const lines: Float64Array[] = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const pts: number[] = [];
    for (let lat = -90; lat <= 90; lat += 5) pts.push(...toUnit(lon, lat));
    lines.push(Float64Array.from(pts));
  }
  for (const lat of [-60, -30, 0, 30, 60]) {
    const pts: number[] = [];
    for (let lon = -180; lon <= 180; lon += 5) pts.push(...toUnit(lon, lat));
    lines.push(Float64Array.from(pts));
  }
  return lines;
})();

export const GLOBE_VIEWBOX = 1.04; // half-extent; the disc is radius 1
const REST: LatLon = { lon: -30, lat: 18 }; // no fix (yet): the Atlantic face — the Americas, Europe, Africa
const SETTLE_DEG = 35;
const SETTLE_MS = 1600;
const CUT_BEYOND_DEG = 70;
const DOT = [0.036, 0.03, 0.022]; // near, mid, limb stroke widths (disc radius 1)

type Frame = { land: [string, string, string]; grat: string; tether: string; home: { x: number; y: number } | null };

function drawFrame(centre: LatLon, fix: LatLon | null): Frame {
  const r = rotation(centre.lon, centre.lat);
  const land: [string, string, string] = ["", "", ""];
  for (let i = 0; i < LAND.length; i += 3) {
    const a = LAND[i] * r.c0 + LAND[i + 1] * r.s0;
    const z = r.sp * LAND[i + 2] + r.cp * a;
    if (z <= 0) continue;
    const x = LAND[i + 1] * r.c0 - LAND[i] * r.s0;
    const y = r.cp * LAND[i + 2] - r.sp * a;
    const b = z > 0.55 ? 0 : z > 0.25 ? 1 : 2;
    land[b] += `M${x.toFixed(3)} ${(-y).toFixed(3)}h0`;
  }
  let grat = "";
  for (const g of GRATICULE) grat += visibleLine(g, r);
  let tether = "";
  let home: Frame["home"] = null;
  if (fix) {
    tether = pathOf(globeTether(HOME, fix, r), true, 3);
    const h = rotate(r, toUnit(HOME.lon, HOME.lat));
    if (h.z > 0.05) home = { x: h.x, y: -h.y };
  }
  return { land, grat, tether, home };
}

function visibleLine(pts: Float64Array, r: Rotation): string {
  let d = "";
  let pen = false;
  for (let i = 0; i < pts.length; i += 3) {
    const q = rotate(r, [pts[i], pts[i + 1], pts[i + 2]]);
    if (q.z > 0) {
      d += `${pen ? "L" : "M"}${q.x.toFixed(3)} ${(-q.y).toFixed(3)}`;
      pen = true;
    } else pen = false;
  }
  return d;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function GlobeMap({ lat, lon, reduce }: { lat: number | null; lon: number | null; reduce: boolean }) {
  const id = useId();
  const fixKey = lat !== null && lon !== null ? `${lat.toFixed(3)},${lon.toFixed(3)}` : "";
  const nearRef = useRef<SVGPathElement>(null);
  const midRef = useRef<SVGPathElement>(null);
  const limbRef = useRef<SVGPathElement>(null);
  const gratRef = useRef<SVGPathElement>(null);
  const tetherRef = useRef<SVGPathElement>(null);
  const homeRef = useRef<SVGPathElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const view = useRef<LatLon | null>(null);
  const raf = useRef(0);
  const [settled, setSettled] = useState("");

  // Paint one frame straight into the DOM.
  const paint = useRef((centre: LatLon, fix: LatLon | null) => {
    view.current = centre;
    const f = drawFrame(centre, fix);
    [nearRef, midRef, limbRef].forEach((r, i) => r.current?.setAttribute("d", f.land[i]));
    gratRef.current?.setAttribute("d", f.grat);
    tetherRef.current?.setAttribute("d", f.tether);
    const h = homeRef.current;
    if (h) {
      const s = 0.042;
      h.setAttribute("d", f.home ? `M${f.home.x} ${f.home.y - s}l${s} ${s}l${-s} ${s}l${-s} ${-s}Z` : "");
    }
  });

  useLayoutEffect(() => {
    const fix = lat !== null && lon !== null ? { lat, lon } : null;
    const target = fix ? globeCentre(fix) : REST;
    cancelAnimationFrame(raf.current);
    if (reduce) {
      paint.current(target, fix);
      return;
    }
    // Where the settle starts: first paint with a fix → 35° west of it (the earth turns
    // eastward, the way it does); a later fix → from wherever the globe is now, unless that
    // is too far round, in which case cut to 35° out under a fade.
    let from = view.current ?? (fix ? { lon: target.lon - SETTLE_DEG, lat: target.lat * 0.6 } : REST);
    const dLon = lonDelta(from.lon, target.lon);
    const dLat = target.lat - from.lat;
    const dist = Math.hypot(dLon, dLat);
    if (dist > CUT_BEYOND_DEG) {
      const k = SETTLE_DEG / dist;
      from = { lon: wrapLon(target.lon - dLon * k), lat: target.lat - dLat * k };
      const body = bodyRef.current;
      if (body) body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
    }
    if (!fix) {
      paint.current(target, fix);
      return;
    }
    if (dist < 0.05) {
      // Already facing it (a refinement inside the tilt cap): no settle, but the pin still
      // has to be told this fix is the one at rest — from a frame, not synchronously here.
      paint.current(target, fix);
      raf.current = requestAnimationFrame(() => setSettled(fixKey));
      return () => cancelAnimationFrame(raf.current);
    }
    const start = performance.now();
    const origin = from;
    const span = { lon: lonDelta(origin.lon, target.lon), lat: target.lat - origin.lat };
    const dur = Math.min(SETTLE_MS, 500 + (Math.hypot(span.lon, span.lat) / SETTLE_DEG) * (SETTLE_MS - 500));
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = easeOut(t);
      paint.current({ lon: wrapLon(origin.lon + span.lon * e), lat: origin.lat + span.lat * e }, fix);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setSettled(fixKey);
    };
    paint.current(origin, fix);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [lat, lon, reduce, fixKey]);

  // The pin, once the globe has come to rest facing the visitor (or at once, when reduced).
  const showPin = fixKey !== "" && (reduce || settled === fixKey);
  const pin = showPin && lat !== null && lon !== null ? rotate(rotation(globeCentre({ lat, lon }).lon, globeCentre({ lat, lon }).lat), toUnit(lon, lat)) : null;
  const V = GLOBE_VIEWBOX;

  return (
    <svg viewBox={`${-V} ${-V} ${2 * V} ${2 * V}`} className="block h-full w-full" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={`${id}-sphere`} cx="0.68" cy="0.28" r="0.9">
          <stop offset="0" stopColor="var(--foreground)" stopOpacity="0.1" />
          <stop offset="1" stopColor="var(--foreground)" stopOpacity="0.02" />
        </radialGradient>
      </defs>
      <circle r={1} fill={`url(#${id}-sphere)`} stroke="var(--vc-rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <g ref={bodyRef}>
        <path ref={gratRef} fill="none" stroke="var(--vc-rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path ref={limbRef} fill="none" stroke="var(--vc-land-3)" strokeWidth={DOT[2]} strokeLinecap="round" />
        <path ref={midRef} fill="none" stroke="var(--vc-land-2)" strokeWidth={DOT[1]} strokeLinecap="round" />
        <path ref={nearRef} fill="none" stroke="var(--vc-land)" strokeWidth={DOT[0]} strokeLinecap="round" />
        <path ref={tetherRef} fill="none" stroke="var(--accent)" strokeWidth={0.014} strokeLinecap="round" />
        <path ref={homeRef} fill="var(--accent)" stroke="var(--background)" strokeWidth={0.012} />
      </g>
      {pin && pin.z > 0 && (
        <g transform={`translate(${pin.x.toFixed(3)} ${(-pin.y).toFixed(3)})`} className="vc-gpin">
          <circle r={0.12} fill="color-mix(in srgb, var(--accent) 22%, transparent)" />
          <circle r={0.12} className="vc-gping" fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <circle r={0.055} fill="var(--accent)" stroke="var(--background)" strokeWidth={0.02} />
        </g>
      )}
    </svg>
  );
}

export default memo(GlobeMap);
