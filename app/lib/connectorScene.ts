// The connector scene's frame, shared by the canvas (which builds it) and the card (which
// paints the column before the canvas mounts and decides whether the column exists at all).
// Pure: CommitHeatmap may only reach the three.js side through dynamic(), so anything the
// card needs to know about the scene lives here.

/**
 * The scene's backdrop in BOTH themes — the reference is a dark inset on a light page, and
 * one opaque panel is what makes the light theme first-class by construction: no material,
 * exposure or environment forks, and the wake ribbon (PR B) composites over a finished
 * frame. Between --background #0a0a0b and --card #18181b. One line to theme it later.
 */
export const PANEL = "#141518";

/**
 * The legend sits ON the panel, not on the card, so it follows the panel and not the theme:
 * this is the dark theme's --legend (globals.css). The light theme's #52525b would be 2.5:1
 * on #141518.
 */
export const PANEL_LEGEND = "#a1a1aa";

/** Two columns only when the block leaves this much beside the board (plus the 32 px gap). */
export const COLUMN_MIN_PX = 340;

/**
 * The pack the camera is solved for: twelve bodies on x-biased targets settle ≈ 9–10 u wide
 * × 4–5 u tall, 2–3 deep (measured in node: 8.4 × 3.3 u between centres at rest, plus a
 * body radius each side).
 */
export const PACK = { w: 10, h: 5 } as const;

export const CAMERA = {
  /** Lusion's lens: a narrow FOV, fixed, no parallax — size and overlap carry the depth */
  FOV: 25,
  NEAR: 2,
  FAR: 40,
  /**
   * The pack must overflow the view by this factor on the binding axis. The design's 1.05
   * measured 50% jack coverage at both card widths (Playwright mask vs the panel colour) —
   * the pack's edge touched the frame but the crosses' own gaps left half the column panel;
   * 1.12 cleared the design's 55% at 691 (57%) but not at 519 (53%); 1.18 is the step that
   * clears it at both.
   */
  OVERFLOW: 1.18,
  /**
   * The design's floor 9.5 overrode its own width rule at 691×273 (8.49) and left 10% of
   * the width unfilled; 8.5 lets the rule bind there. A 2.2 u jack then spans 58% of the
   * column at 691 and 49% at 519 — inside the reference's 45–63%.
   */
  Z_MIN: 8.5,
  Z_MAX: 12.5,
  /** the entrance dolly starts this far out — Lusion's 25 → 17.5 */
  DOLLY_FROM: 1.43,
} as const;

export interface CameraFit {
  z: number;
  /** the view's width and height in world units at z 0 */
  viewW: number;
  viewH: number;
  pxPerUnit: number;
}

/**
 * Camera distance for a canvas: the largest z at which the pack still overflows the view
 * by OVERFLOW on the binding axis, clamped. At 691×273 the width rule wants 7.55 and the
 * floor holds (8.5: 72.4 px/u); at 520 and 380 wide the height rule binds at 9.56
 * (64.4 px/u, a 2.2 u jack 52% of the column).
 */
export function cameraFor(width: number, height: number): CameraFit {
  const tan = Math.tan((CAMERA.FOV / 2) * (Math.PI / 180));
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const zH = PACK.h / CAMERA.OVERFLOW / (2 * tan);
  const zW = PACK.w / CAMERA.OVERFLOW / (2 * tan * aspect);
  const z = Math.min(CAMERA.Z_MAX, Math.max(CAMERA.Z_MIN, Math.min(zW, zH)));
  const viewH = 2 * z * tan;
  const viewW = viewH * aspect;
  return { z, viewW, viewH, pxPerUnit: height > 0 ? height / viewH : 0 };
}
