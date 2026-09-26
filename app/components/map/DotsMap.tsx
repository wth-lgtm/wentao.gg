"use client";

// DOTS — the whole world as a dot matrix on the Miller plane (Mercator's familiar shapes
// without its poles), always the whole world: no zoom, so the continents never leave the
// frame. The visitor's own neighbourhood lights up in accent around the pin — the pin says
// where, the lit dots say "this patch of land", at any card size.
//
// Every land dot is ONE <path> ("M x y h0" per dot, round caps) — 3,600 dots cost one DOM
// node, not 3,600 circles, and theme with currentColor-style tokens.

import { memo, useMemo } from "react";
import { DOTS_GRID } from "./worldDots";
import { flatTether, millerGrid, pathOf, toGrid, unpackBits } from "../../lib/mapProjection";
import { HOME, type LatLon } from "../../lib/telemetry";
import { HomeMark, MapPin, tetherVisible } from "./Marks";

const G = millerGrid(DOTS_GRID.cols, DOTS_GRID.latTop, DOTS_GRID.latBottom);
const W = G.cols;
const H = G.rows;
const LAND = unpackBits(DOTS_GRID.bits, W * H);
const DOT = 0.64; // dot diameter, in cells

const LAND_D = (() => {
  let d = "";
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (LAND[r * W + c]) d += `M${c + 0.5} ${r + 0.5}h0`;
  return d;
})();

// The lit neighbourhood: land cells within LIT_R cells of the pin, in two rings — the
// dots' own range disc (the pin here carries no translucent one; the lit land is it).
const LIT_R = 9;
function litPaths(at: { x: number; y: number }): [string, string] {
  let near = "";
  let far = "";
  const c0 = Math.floor(at.x);
  const r0 = Math.floor(at.y);
  for (let r = r0 - LIT_R; r <= r0 + LIT_R; r++) {
    if (r < 0 || r >= H) continue;
    for (let c = c0 - LIT_R; c <= c0 + LIT_R; c++) {
      const cc = ((c % W) + W) % W;
      if (!LAND[r * W + cc]) continue;
      const dist = Math.hypot(c + 0.5 - at.x, r + 0.5 - at.y);
      if (dist <= LIT_R * 0.5) near += `M${cc + 0.5} ${r + 0.5}h0`;
      else if (dist <= LIT_R) far += `M${cc + 0.5} ${r + 0.5}h0`;
    }
  }
  return [near, far];
}

function DotsMap({ lat, lon }: { lat: number | null; lon: number | null }) {
  const home = useMemo(() => toGrid(G, HOME.lon, HOME.lat), []);
  const at = useMemo(() => (lat !== null && lon !== null ? toGrid(G, lon, lat) : null), [lat, lon]);
  const lit = useMemo(() => (at ? litPaths(at) : null), [at]);
  const tether = useMemo(() => {
    if (lat === null || lon === null || !at || !tetherVisible(home, at, W)) return null;
    const fix: LatLon = { lat, lon };
    return pathOf(flatTether(HOME, fix, (x, y) => toGrid(G, x, y)));
  }, [lat, lon, at, home]);

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true" preserveAspectRatio="none">
        <path d={LAND_D} stroke="var(--vc-dot)" strokeWidth={DOT} strokeLinecap="round" fill="none" />
        {lit && (
          <>
            <path d={lit[1]} stroke="color-mix(in srgb, var(--accent) 55%, transparent)" strokeWidth={DOT} strokeLinecap="round" fill="none" />
            <path d={lit[0]} stroke="var(--accent)" strokeWidth={DOT} strokeLinecap="round" fill="none" />
          </>
        )}
        {tether && (
          <path d={tether} pathLength={1} className="vc-tether" stroke="var(--accent)" strokeWidth={0.5} strokeLinecap="round" fill="none" />
        )}
      </svg>
      {tether && <HomeMark at={home} w={W} h={H} />}
      {at && <MapPin key={`${at.x.toFixed(1)},${at.y.toFixed(1)}`} at={at} w={W} h={H} range={false} />}
    </div>
  );
}

export default memo(DotsMap);
