// The three treatments' frames, as data with no map data attached: LocatorMap reserves the
// map's box from these before any treatment chunk has loaded (so nothing shifts when it
// arrives), and scripts/gen-world.ts bakes the land to the same numbers.

import { equalEarthFrame, millerGrid } from "../../lib/mapProjection";

export type MapTreatment = "dots" | "globe" | "outline";
export const TREATMENTS: readonly MapTreatment[] = ["dots", "globe", "outline"];

export const DOTS_FRAME = { cols: 150, latTop: 84, latBottom: -58 } as const;
export const OUTLINE_FRAME = { width: 1000, latTop: 84, latBottom: -58 } as const;
export const GLOBE_STEP = 1.8; // degrees between the globe's dots

const dots = millerGrid(DOTS_FRAME.cols, DOTS_FRAME.latTop, DOTS_FRAME.latBottom);
const outline = equalEarthFrame(OUTLINE_FRAME.width, OUTLINE_FRAME.latTop, OUTLINE_FRAME.latBottom);

/** width / height of each treatment's box. */
export const MAP_ASPECT: Record<MapTreatment, number> = {
  dots: dots.cols / dots.rows,
  outline: outline.width / outline.height,
  globe: 16 / 9,
};

/** The same ratios as CSS `aspect-ratio` strings ("w / h"). A bare number is re-serialised by
 *  the browser as "2.2864 / 1", which React then reports as a hydration mismatch. */
export const MAP_ASPECT_CSS: Record<MapTreatment, string> = {
  dots: `${dots.cols} / ${dots.rows}`,
  outline: `${outline.width} / ${outline.height.toFixed(2)}`,
  globe: "16 / 9",
};
