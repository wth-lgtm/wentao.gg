// OUTLINE's world: the land, the sea and a 30° graticule on Equal Earth, drawn in the SERVER
// HTML. This is a server component (no "use client"): Hero.tsx renders it and hands it down
// the hero's client components as a slot (HeroClient → VisitorIntel → LocatorMap), so the
// ~12 KB of path data (worldOutline.ts, baked by scripts/gen-world.ts) is in the page's HTML
// and its RSC payload, and in no client bundle.
//
// Why inline SVG and not an image: the land has to be on screen with the card's first paint
// (review round 2: on a phone on slow 4G the lazy-chunk land arrived ~2.1 s after the card box,
// and a mask image preloaded from <head> still ~0.6 s after it). And an image — <img>, a CSS
// background or mask — is a largest-contentful-paint candidate: at 308 × 135 px on a phone it
// outsizes the h1, and the h1 is the page's LCP element by design. Inline SVG paths are not
// candidates, and they paint with the HTML.
//
// The colours are the card's theme tokens (globals.css "VISITOR CARD"), so both themes follow.
// The pin, the tether and the home diamond are drawn over this by map/OutlineMarks.tsx.

import { OUTLINE } from "./worldOutline";

export default function WorldMap() {
  return (
    <svg
      viewBox={`0 0 ${OUTLINE.width} ${OUTLINE.height}`}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path d={OUTLINE.sea} fill="var(--vc-sea)" stroke="var(--vc-rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={OUTLINE.grid} fill="none" stroke="var(--vc-rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={OUTLINE.d} fill="var(--vc-land)" />
    </svg>
  );
}
