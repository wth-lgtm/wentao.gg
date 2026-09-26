// The marks every flat treatment shares, as DOM overlays over the map's SVG: sized in CSS
// px so the pin is the same pin at 310 px and at 460 px, positioned in PERCENT of a box
// whose aspect ratio equals the map's viewBox (LocatorMap sets it), so a percentage is an
// exact map coordinate. Styles and keyframes: globals.css "VISITOR CARD".

import type { XY } from "../../lib/mapProjection";

/** Percent coordinates of a viewBox point. */
export const pct = (p: XY, w: number, h: number) => ({ left: `${(p.x / w) * 100}%`, top: `${(p.y / h) * 100}%` });

export function MapPin({ at, w, h, range = true }: { at: XY; w: number; h: number; range?: boolean }) {
  return (
    <span aria-hidden className="vc-pin" style={pct(at, w, h)}>
      {range && <span className="vc-pin-range" />}
      <span className="vc-pin-ping" />
      <span className="vc-pin-dot" />
    </span>
  );
}

// Wentao's end of the tether: a small diamond, so the two ends read as different things —
// a fixed survey mark here, a live pin at the visitor's end.
export function HomeMark({ at, w, h }: { at: XY; w: number; h: number }) {
  return (
    <span aria-hidden className="vc-home" style={pct(at, w, h)}>
      <span />
    </span>
  );
}

// Below this separation (as a fraction of the map's width) the diamond would peek out from
// under the pin like a rendering fault, and the tether would be a stub — draw neither. At
// 310 px that is ~9 px: a visitor in Los Angeles gets the pin alone, one in Chicago the line.
export const MIN_TETHER_FRACTION = 0.03;
export function tetherVisible(a: XY, b: XY, width: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) / width >= MIN_TETHER_FRACTION;
}
