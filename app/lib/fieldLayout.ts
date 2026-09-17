// The jack field's frame: a FIXED, page-wide layer, so everything here is in viewport space
// and nothing is anchored to a section's DOM. How big a jack is (from the wordmark's font
// size), where the camera sits, how the packs' raw targets (fieldPacks.ts) are solved against
// what is on screen, how the jacks arrive (beyond the nearest edge), the cast's scales, and
// how a DOM rect becomes a keep-out box while it is on screen. Pure — the scene measures and
// hands things in; every rule runs in node at 1440 × 900, 1024 × 768, 1440 × 700, 1366 × 768.
//
// The object is the card's jack (jackGeometry.ts, jackMaterials.ts) — the owner compared and
// kept it: "the previous one that's exactly the same as lusion looks better with the black
// white and blue color scheme". What this module and fieldPacks.ts change about the card is
// DATA: count, scale, homes, pivots, and a casting that means nothing.

import type { Family, Finish } from "./connectorJacks";
import { DYN, type KeepOut, type Vec3, type World } from "./jackDynamics";
import { rand } from "./seed";

export const FIELD = {
  /** Lusion's lens, as on the card: narrow, fixed, no parallax */
  FOV: 25,
  NEAR: 2,
  FAR: 80,
  /**
   * a unit jack's diameter = this × the h1's computed font size. 1.15 shipped (129 px beside
   * the 112 px wordmark at 1440 × 900); the owner's "slightly bigger" → 1.23 (137.8 px); "a
   * little bigger" again, with the packs → 1.4: 156.8 px (71.27 px/u, z 28.48), the largest
   * jack 180.3 px, the smallest 112.9. Bounded now by the CLAMP, not by a cull: on a short
   * viewport the rule wants a camera nearer than Z_MIN — 1440 × 700: z 22.15 → 24 binds, 65.78
   * px/u, a 144.7 px unit jack; 1366 × 768: z 24.30, unclamped by a hair; 1024 × 768: z 29.53,
   * 129.0 px — and a target the band leaves inside is counted (`Solved.inBand`), not dropped.
   */
  D_PER_FONT: 1.4,
  /** the jack's diameter at scale 1, as the card measures it */
  UNIT_DIAM: 2.2,
  /** without an h1 to measure (a project page), the view is this many units tall */
  FALLBACK_VIEW_H: 9,
  Z_MIN: 24,
  Z_MAX: 40,
  /** the entrance spawns each jack this many of its own diameters beyond its nearest edge */
  SPAWN_D: 1.5,
  /** the WIDE composition (fieldPacks.ts: 21 in two packs) at or above this viewport, NARROW (one ten) below */
  WIDE_W: 1280,
  WIDE_H: 800,
  /** the cast's scales */
  SCALE_MIN: 0.72,
  SCALE_MAX: 1.15,
} as const;

/** one seed for the scales, the casting, the spirals, the orientations and the click kicks */
export const SEED_FIELD = 17;

/**
 * Scales for `count` jacks over [SCALE_MIN, SCALE_MAX], stratified — the i-th of `count` draws
 * from the i-th `count`-th of the range, then the order is shuffled — so any count covers the
 * whole range and no two draws collide.
 */
export function fieldScales(count: number, seed: number): number[] {
  const n = Math.max(0, Math.floor(count));
  const strata = Array.from({ length: n }, (_, i) => FIELD.SCALE_MIN + ((FIELD.SCALE_MAX - FIELD.SCALE_MIN) * (i + rand(i, seed + 11))) / n);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand(i, seed + 12) * (i + 1));
    [strata[i], strata[j]] = [strata[j], strata[i]];
  }
  return strata;
}

/** what a body wears: the card's three families and two finishes (fieldPacks.packCasting decides) */
export interface Slot { family: Family; finish: Finish }

/**
 * Light theme: the card's white family was tuned against its opaque panel; on the page's
 * #ffffff a #d4d6db matte white's lit face vanished (measured in v1: a tenth of its pixels
 * within 8% of the page). Lusion's own light-mode toggle values for the whites, as a
 * field-side override — the card is untouched. Roughness and clearcoat stay the recipe's.
 */
export const LIGHT_WHITE: Readonly<Record<Finish, string>> = { matte: "#8e9098", glossy: "#a3a5ad" };

export interface FieldFit {
  z: number;
  /** the view's width and height in world units at z 0 */
  viewW: number;
  viewH: number;
  pxPerUnit: number;
  /** the canvas, CSS px */
  width: number;
  height: number;
}

/**
 * The camera for a viewport of `width × height`: px/u from the size rule when an h1 is there
 * to measure (`h1FontPx`), else height / FALLBACK_VIEW_H; z from the height at that px/u,
 * clamped to [Z_MIN, Z_MAX], and px/u re-solved from the clamped view when the clamp binds.
 * 1440 × 900 with the 112 px h1: 71.27 px/u, z 28.48; 1024 × 768 (92.16 px): 58.65 px/u,
 * z 29.53; 1440 × 700 wants z 22.15 and gets 24 (65.78 px/u); no h1 at 900 tall: 100 px/u
 * wants z 20.3, gets 24 → 84.6 px/u.
 */
export function fieldCamera(width: number, height: number, h1FontPx: number | null): FieldFit {
  const tan = Math.tan((FIELD.FOV / 2) * (Math.PI / 180));
  const w = width > 0 && Number.isFinite(width) ? width : 1440;
  const h = height > 0 && Number.isFinite(height) ? height : 900;
  const font = h1FontPx !== null && h1FontPx > 0 && Number.isFinite(h1FontPx) ? h1FontPx : null;
  const want = font !== null ? (FIELD.D_PER_FONT * font) / FIELD.UNIT_DIAM : h / FIELD.FALLBACK_VIEW_H;
  const z = Math.min(FIELD.Z_MAX, Math.max(FIELD.Z_MIN, h / (want * 2 * tan)));
  const viewH = 2 * z * tan;
  const viewW = viewH * (w / h);
  return { z, viewW, viewH, pxPerUnit: h / viewH, width: w, height: h };
}

/** a DOM rect in viewport CSS px */
export interface Rect { left: number; top: number; right: number; bottom: number }

/** a viewport rect as a keep-out box on z = 0 (y up), with the band's strength for it */
export function keepOutFor(rect: Rect, fit: FieldFit, strength = 1): KeepOut {
  const px = (x: number) => (x - fit.width / 2) / fit.pxPerUnit;
  const py = (y: number) => (fit.height / 2 - y) / fit.pxPerUnit;
  const x0 = px(rect.left), x1 = px(rect.right), y0 = py(rect.bottom), y1 = py(rect.top);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2, strength };
}

/** true when any of the rect is inside the viewport — the keep-out exists only then */
export function onScreen(rect: Rect, width: number, height: number): boolean {
  return rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height;
}

/**
 * A viewport rect moved to where it sits at scrollY 0 — the hero is the top of the page, so
 * this is its PAGE position. Homes are solved against it (not against the rect at whatever
 * scroll the layout ran at), so the rest state is one composition whatever the scroll, and a
 * mid-page resize does not hand out homes that lie behind the name at the top.
 */
export function atPageTop(rect: Rect, scrollY: number): Rect {
  return { left: rect.left, right: rect.right, top: rect.top + scrollY, bottom: rect.bottom + scrollY };
}

/** signed distance from a disc of radius r (plus the pad) at (x, y) to the box's inflated edge — the world's own measure — and the outward normal at the nearest face */
function boxClearance(x: number, y: number, r: number, k: KeepOut): { d: number; gx: number; gy: number } {
  const qx = x - k.cx, qy = y - k.cy;
  const ex = Math.abs(qx) - k.hw, ey = Math.abs(qy) - k.hh;
  const outside = Math.hypot(Math.max(ex, 0), Math.max(ey, 0));
  const d = outside + Math.min(Math.max(ex, ey), 0) - (r + DYN.KEEP_PAD);
  if (ex > 0 && ey > 0) return { d, gx: (ex / outside) * Math.sign(qx), gy: (ey / outside) * Math.sign(qy) };
  if (ex > ey) return { d, gx: Math.sign(qx) || 1, gy: 0 };
  return { d, gx: 0, gy: Math.sign(qy) || 1 };
}

export interface Solved {
  /** one per body, in body order — every raw target is kept */
  targets: Vec3[];
  /** the targets whose disc the view clamp left more than 0.25 D inside a band: the band holds that jack off its home while the box is on screen (empty at all four fixtures — 1440 × 900, 1024 × 768, 1440 × 700, 1366 × 768 — with the deepest intrusion 0.000 u; the brief's 0.57 u at 1440 × 700 did not occur) */
  inBand: number[];
}

/**
 * The packs' raw targets (fieldPacks.packTargets), made to live with what is on screen when
 * they are solved (mount, resize): each target's disc is pushed out of every `avoid` box's band
 * to exactly KEEP_BAND — where the band's force is zero, so a jack rests ON its target — along
 * the nearest face, or along the perpendicular face when the nearest one would put the disc
 * outside the view (never at the four fixtures or QUADS: every pushed target kept its x, 0
 * perpendicular pushes measured); four passes because a push out of one box
 * can land in another's band; then the disc is clamped inside the view. The nearest-face push
 * keeps x and sets y to the band edge, so the lower pack's upper targets form a LINE along the
 * h1's band (spiral x kept) — the pack hugs the name from below. Nothing is culled: a target
 * the clamp leaves more than 0.25 D inside a band is reported in `inBand`. The band is
 * evaluated where the CAMERA sees the target: a target at depth z projects onto z = 0 by
 * proj = z_cam / (z_cam − z), so the clearance is taken at q·proj with the push divided by proj
 * — a z −1.25 target sits 4% nearer the centre than its world x says, a z +1.25 one 5% further
 * out. Solved once per layout, never on scroll: the layer is fixed, the page moves under it,
 * and a jack's home must not move when the hero scrolls off.
 */
export function solveTargets(fit: FieldFit, raw: readonly Vec3[], scales: readonly number[], avoid: readonly KeepOut[]): Solved {
  const targets: Vec3[] = [];
  const inBand: number[] = [];
  raw.forEach((t, i) => {
    const r = DYN.BODY_R * (scales[i] ?? 1);
    const D = FIELD.UNIT_DIAM * (scales[i] ?? 1);
    const proj = fit.z / (fit.z - t.z);
    const mx = fit.viewW / 2 - r, my = fit.viewH / 2 - r;
    const inView = (px: number, py: number) => Math.abs(px) <= mx + 1e-9 && Math.abs(py) <= my + 1e-9;
    let x = t.x, y = t.y;
    for (let pass = 0; pass < 4; pass++) {
      for (const k of avoid) {
        const c = boxClearance(x * proj, y * proj, r, k);
        if (c.d >= DYN.KEEP_BAND) continue;
        const push = (DYN.KEEP_BAND - c.d) / proj;
        let nx = x + c.gx * push, ny = y + c.gy * push;
        if (!inView(nx, ny) && (c.gx === 0 || c.gy === 0)) {
          // the perpendicular face, to the band's edge on the side the target already leans to
          const reach = r + DYN.KEEP_PAD + DYN.KEEP_BAND;
          const ax = c.gx === 0
            ? { x: (k.cx + Math.sign(x * proj - k.cx || 1) * (k.hw + reach)) / proj, y }
            : { x, y: (k.cy + Math.sign(y * proj - k.cy || 1) * (k.hh + reach)) / proj };
          if (inView(ax.x, ax.y)) { nx = ax.x; ny = ax.y; }
        }
        x = nx; y = ny;
      }
      x = Math.min(mx, Math.max(-mx, x));
      y = Math.min(my, Math.max(-my, y));
    }
    let deepest = 0;
    for (const k of avoid) deepest = Math.max(deepest, DYN.KEEP_BAND - boxClearance(x * proj, y * proj, r, k).d);
    if (deepest > 0.25 * D) inBand.push(i);
    targets.push({ x, y, z: t.z });
  });
  return { targets, inBand };
}

/**
 * The entrance, no dolly (a dolly changes the CSS→world mapping the keep-out depends on):
 * each body spawns beyond its NEAREST viewport edge by SPAWN_D of its own diameter, the other
 * coordinate kept, with Lusion's vel = SPAWN_VEL·(pos − target). Orientations keep
 * createWorld's seeded draw. Fourteen members converging on one 2 u disc overlap by up to
 * 1.14 u for two frames (the card's own fly-in peaks at 0.48 u for one) — accepted; after
 * settling the worst interpenetration is 0.001 u.
 */
export function placeWorld(world: World, targets: readonly Vec3[], fit: FieldFit): void {
  world.bodies.forEach((b, i) => {
    const t = targets[i];
    if (!t) return;
    const D = FIELD.UNIT_DIAM * (b.r / DYN.BODY_R);
    const edges = [fit.viewW / 2 + t.x, fit.viewW / 2 - t.x, fit.viewH / 2 + t.y, fit.viewH / 2 - t.y]; // left, right, bottom, top
    const nearest = edges.indexOf(Math.min(...edges));
    const pos = { x: t.x, y: t.y, z: t.z };
    if (nearest === 0) pos.x = -fit.viewW / 2 - FIELD.SPAWN_D * D;
    else if (nearest === 1) pos.x = fit.viewW / 2 + FIELD.SPAWN_D * D;
    else if (nearest === 2) pos.y = -fit.viewH / 2 - FIELD.SPAWN_D * D;
    else pos.y = fit.viewH / 2 + FIELD.SPAWN_D * D;
    b.target = { x: t.x, y: t.y, z: t.z };
    b.pos = pos;
    b.vel = { x: DYN.SPAWN_VEL * (pos.x - t.x), y: DYN.SPAWN_VEL * (pos.y - t.y), z: DYN.SPAWN_VEL * (pos.z - t.z) };
  });
}

/** New targets for a live world — the pull nudges bodies to them, nothing teleports. */
export function retarget(world: World, targets: readonly Vec3[]): void {
  world.bodies.forEach((b, i) => {
    const t = targets[i];
    if (t) b.target = { x: t.x, y: t.y, z: t.z };
  });
}

/**
 * The swirl's pivot and gain per body (jackDynamics Body.pivot / swirlGain) — the field hands
 * each body its pack's SOLVED centroid (fieldPacks.packCentroids) and its pack's gain, after
 * birth and on every relayout beside `retarget`. Fresh objects, as retarget assigns.
 */
export function repivot(world: World, pivots: readonly Vec3[], gains: readonly number[]): void {
  world.bodies.forEach((b, i) => {
    const p = pivots[i];
    if (p) b.pivot = { x: p.x, y: p.y, z: p.z };
    const g = gains[i];
    if (g !== undefined && Number.isFinite(g)) b.swirlGain = g;
  });
}
