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
// the cursor crossed the card. The map is decoration for sighted readers (aria-hidden):
// every fact on it is also a line of text below it.
//
// Each treatment is its own lazy chunk (client-only), so its land data never rides in the
// home page's first chunk or its HTML, and a treatment nobody asked for is never fetched.
// The box is reserved at the treatment's exact aspect ratio first, so nothing shifts when
// the chunk lands. Its fill is 80 % background — more than the glass around it — so the
// rain behind the card doesn't read as extra dots on the map.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { MAP_ASPECT, TREATMENTS, type MapTreatment } from "./map/frames";

export const DEFAULT_TREATMENT: MapTreatment = "outline";

const DotsMap = dynamic(() => import("./map/DotsMap"), { ssr: false });
const GlobeMap = dynamic(() => import("./map/GlobeMap"), { ssr: false });
const OutlineMap = dynamic(() => import("./map/OutlineMap"), { ssr: false });

function readTreatment(): MapTreatment {
  const q = new URLSearchParams(window.location.search).get("map");
  return (TREATMENTS as readonly string[]).includes(q ?? "") ? (q as MapTreatment) : DEFAULT_TREATMENT;
}
const noSubscribe = () => () => {};

export default function LocatorMap({ lat, lon, reduce }: { lat: number | null; lon: number | null; reduce: boolean }) {
  const treatment = useSyncExternalStore(noSubscribe, readTreatment, () => DEFAULT_TREATMENT);
  return (
    <div
      data-map={treatment}
      className="relative overflow-hidden rounded-xl bg-background/80 ring-1 ring-border/60"
      style={{ aspectRatio: MAP_ASPECT[treatment] }}
    >
      {treatment === "dots" && <DotsMap lat={lat} lon={lon} />}
      {treatment === "outline" && <OutlineMap lat={lat} lon={lon} />}
      {treatment === "globe" && <GlobeMap lat={lat} lon={lon} reduce={reduce} />}
    </div>
  );
}
