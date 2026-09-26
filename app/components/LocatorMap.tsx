"use client";

// The visitor card's map: the WHOLE world, always — the first thing it has to say is "this
// is a world map", at a glance, on a phone. Three treatments sit behind a review query,
// `?map=dots | globe | outline` (map/frames.ts); DEFAULT_TREATMENT is the one shipped.
//
// OUTLINE ships, chosen by eye at 375–1920 in both themes: filled continents are the
// highest-contrast figure the card can draw, so the shapes register in the first glance
// even at 308 px wide; the Equal Earth silhouette and its graticule are the atlas picture
// everyone already carries; the pin sits on solid land rather than between dots; and a
// filled path stays crisp on a DPR-1 laptop, where the 2.8 px dot lattice falls off the
// pixel grid and renders as uneven 1–2 px squares. DOTS keeps the old dot-matrix idea done right (the whole world, lit neighbourhood);
// GLOBE is the most charming and the least informative — half the world, at a smaller size.
//
// No wheel zoom, no drag pan, no buttons any more. With the world always in frame they
// had nothing left to find, and the wheel handler held the page's scroll hostage whenever
// the cursor crossed the card. The map is decoration for sighted readers (aria-hidden on
// the box): every fact on it is also a line of text below it.
//
// OUTLINE's land, sea and graticule never change, so they are drawn with no JavaScript, in the
// server HTML: a server component (map/WorldMap.tsx) renders them and Hero.tsx passes them down
// as the `outline` slot. On a phone on a slow connection the first glance is already a world
// map, not an empty box under "LOCATING YOU…" (review round 2: the land used to wait ~2.1 s
// for the page's JavaScript and a lazy chunk on slow 4G). Only the pin and the tether wait for
// JavaScript (they need the fix), and so do the `?map=dots | globe` review treatments, each its
// own client-only chunk that is never fetched unless asked for. The box is reserved at the
// treatment's aspect ratio, so nothing shifts when a chunk lands. Its fill is 80 % background —
// more than the glass around it — so the rain behind the card doesn't read as extra dots on the
// map.

import dynamic from "next/dynamic";
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { MAP_ASPECT, MAP_ASPECT_CSS, TREATMENTS, type MapTreatment } from "./map/frames";

export const DEFAULT_TREATMENT: MapTreatment = "outline";

const DotsMap = dynamic(() => import("./map/DotsMap"), { ssr: false });
const GlobeMap = dynamic(() => import("./map/GlobeMap"), { ssr: false });
const OutlineMarks = dynamic(() => import("./map/OutlineMarks"), { ssr: false });

function readTreatment(): MapTreatment {
  const q = new URLSearchParams(window.location.search).get("map");
  return (TREATMENTS as readonly string[]).includes(q ?? "") ? (q as MapTreatment) : DEFAULT_TREATMENT;
}
const noSubscribe = () => () => {};

export default function LocatorMap({ lat, lon, reduce, outline }: { lat: number | null; lon: number | null; reduce: boolean; outline?: ReactNode }) {
  const treatment = useSyncExternalStore(noSubscribe, readTreatment, () => DEFAULT_TREATMENT);
  return (
    <div
      data-map={treatment}
      aria-hidden="true"
      className="vc-map relative overflow-hidden rounded-xl bg-background/80 ring-1 ring-border/60"
      // --vc-aspect: the map's height limit on short windows is set as a width (globals.css).
      style={{ aspectRatio: MAP_ASPECT_CSS[treatment], "--vc-aspect": MAP_ASPECT[treatment].toFixed(4) } as CSSProperties}
    >
      {treatment === "outline" && (
        <>
          {outline}
          <OutlineMarks lat={lat} lon={lon} />
        </>
      )}
      {treatment === "dots" && <DotsMap lat={lat} lon={lon} />}
      {treatment === "globe" && <GlobeMap lat={lat} lon={lon} reduce={reduce} />}
    </div>
  );
}
