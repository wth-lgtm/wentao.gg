"use client";

// OUTLINE's marks: the pin, the tether home and the home diamond, over the land, the sea and
// the graticule already in the server HTML (map/WorldMap.tsx, a server component). Only this
// layer waits for JavaScript: it needs the fix, and it projects with the same
// mapProjection.equalEarthFrame the land was baked to.

import { memo, useMemo } from "react";
import { OUTLINE_FRAME } from "./frames";
import { equalEarthFrame, flatTether, pathOf, toEqualEarth } from "../../lib/mapProjection";
import { HOME, type LatLon } from "../../lib/telemetry";
import { HomeMark, MapPin, tetherVisible } from "./Marks";

const F = equalEarthFrame(OUTLINE_FRAME.width, OUTLINE_FRAME.latTop, OUTLINE_FRAME.latBottom);
const W = F.width;
const H = F.height;
const P = (lon: number, lat: number) => toEqualEarth(F, lon, lat);

function OutlineMarks({ lat, lon }: { lat: number | null; lon: number | null }) {
  const home = useMemo(() => P(HOME.lon, HOME.lat), []);
  const at = useMemo(() => (lat !== null && lon !== null ? P(lon, lat) : null), [lat, lon]);
  const tether = useMemo(() => {
    if (lat === null || lon === null || !at || !tetherVisible(home, at, W)) return null;
    const fix: LatLon = { lat, lon };
    return pathOf(flatTether(HOME, fix, P), false, 1);
  }, [lat, lon, at, home]);
  if (!at) return null;

  return (
    <>
      {tether && (
        <svg viewBox={`0 0 ${W} ${H.toFixed(1)}`} className="absolute inset-0 h-full w-full" aria-hidden="true" preserveAspectRatio="none">
          <path d={tether} pathLength={1} className="vc-tether" stroke="var(--accent)" strokeWidth={3.4} strokeLinecap="round" fill="none" />
        </svg>
      )}
      {tether && <HomeMark at={home} w={W} h={H} />}
      <MapPin key={`${at.x.toFixed(0)},${at.y.toFixed(0)}`} at={at} w={W} h={H} />
    </>
  );
}

export default memo(OutlineMarks);
