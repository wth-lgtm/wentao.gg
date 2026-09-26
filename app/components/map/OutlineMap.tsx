"use client";

// OUTLINE — the continents as filled shapes on Equal Earth: the atlas silhouette, rounded
// sides and all, inside a faint sea and a 30° graticule. The land is one baked path
// (worldOutline.ts, Natural Earth 110m simplified); the sea, the graticule, the pin and the
// tether are projected here with the same mapProjection.equalEarthFrame.

import { memo, useMemo } from "react";
import { OUTLINE } from "./worldOutline";
import { equalEarthFrame, flatTether, pathOf, toEqualEarth, type XY } from "../../lib/mapProjection";
import { HOME, type LatLon } from "../../lib/telemetry";
import { HomeMark, MapPin, tetherVisible } from "./Marks";

const F = equalEarthFrame(OUTLINE.width, OUTLINE.latTop, OUTLINE.latBottom);
const W = F.width;
const H = F.height;
const P = (lon: number, lat: number) => toEqualEarth(F, lon, lat);

function line(pts: XY[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
}
const span = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

// The sea: the cropped world's own outline — flat top and bottom, curved sides.
const SEA_D = (() => {
  const top = OUTLINE.latTop;
  const bot = OUTLINE.latBottom;
  const pts = [
    ...span(-180, 180, 2).map((lon) => P(lon, top)),
    ...span(top, bot, 48).map((lat) => P(180, lat)),
    ...span(180, -180, 2).map((lon) => P(lon, bot)),
    ...span(bot, top, 48).map((lat) => P(-180, lat)),
  ];
  return `${line(pts)}Z`;
})();

const GRATICULE_D = (() => {
  let d = "";
  for (let lon = -150; lon <= 150; lon += 30) d += line(span(OUTLINE.latBottom, OUTLINE.latTop, 32).map((lat) => P(lon, lat)));
  for (const lat of [-30, 0, 30, 60]) d += line(span(-180, 180, 2).map((lon) => P(lon, lat)));
  return d;
})();

function OutlineMap({ lat, lon }: { lat: number | null; lon: number | null }) {
  const home = useMemo(() => P(HOME.lon, HOME.lat), []);
  const at = useMemo(() => (lat !== null && lon !== null ? P(lon, lat) : null), [lat, lon]);
  const tether = useMemo(() => {
    if (lat === null || lon === null || !at || !tetherVisible(home, at, W)) return null;
    const fix: LatLon = { lat, lon };
    return pathOf(flatTether(HOME, fix, P), false, 1);
  }, [lat, lon, at, home]);

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${W} ${H.toFixed(1)}`} className="absolute inset-0 h-full w-full" aria-hidden="true" preserveAspectRatio="none">
        <path d={SEA_D} fill="var(--vc-sea)" stroke="var(--vc-rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={GRATICULE_D} fill="none" stroke="var(--vc-rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={OUTLINE.d} fill="var(--vc-land)" />
        {tether && (
          <path d={tether} pathLength={1} className="vc-tether" stroke="var(--accent)" strokeWidth={3.4} strokeLinecap="round" fill="none" />
        )}
      </svg>
      {tether && <HomeMark at={home} w={W} h={H} />}
      {at && <MapPin key={`${at.x.toFixed(0)},${at.y.toFixed(0)}`} at={at} w={W} h={H} />}
    </div>
  );
}

export default memo(OutlineMap);
