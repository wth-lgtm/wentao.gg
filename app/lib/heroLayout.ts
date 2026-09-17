// The hero's frame for the connector jacks: how big a jack is next to the wordmark, where the
// camera sits, where the seven settle, what they keep off, and how they arrive. Pure — the
// scene (HeroConnectors.tsx) measures its DOM and hands the rects in, so every rule here runs
// in node against fixture rects at 1440 × 900 and 1024 × 768.
//
// The card (connectorScene.ts) solves its camera so a pack of twelve overflows a column; the
// hero solves it so ONE jack is letter-sized: a unit jack's diameter is D_PER_FONT × the h1's
// computed font size (140 px beside a 112 px "I'm Wentao" at 1440 × 900 — 64 px/u, the card's
// own 64–72 px/u band, so a hero jack and a card jack are the same family of sizes). The seven
// mean nothing and are cast once; the difference from the card is DATA, not object.

import { DYN, type KeepOut, type Vec3, type World } from "./jackDynamics";
import type { Family, Finish } from "./connectorJacks";

export const HERO = {
  /** Lusion's lens, as on the card: narrow, fixed, no parallax */
  FOV: 25,
  NEAR: 2,
  /** the card's 40 was solved for a z 8.5–9.6 camera; the hero's sits at 24–40 */
  FAR: 80,
  /** jack diameter (UNIT_DIAM at scale 1) = this × the h1's computed font size */
  D_PER_FONT: 1.25,
  UNIT_DIAM: 2.2,
  /** the camera's clamp: past Z_MAX the size rule yields to the view and px/u is re-solved from it */
  Z_MIN: 24,
  Z_MAX: 40,
  /** the entrance spawns each jack this many of its own diameters beyond its nearest view edge */
  SPAWN_D: 1.5,
  /** seven jacks at or above this viewport, five below (T6 and T7 dropped) */
  WIDE_W: 1280,
  WIDE_H: 800,
  /** a target keeps its disc at least this far inside the canvas edge, in diameters */
  EDGE_D: 0.55,
} as const;

/** one seed for the orientations and the click kicks; distinct from the card's so the two bursts differ */
export const SEED_HERO = 17;

export interface Slot { family: Family; finish: Finish; scale: number; z: number }
/**
 * The casting, in target order T1..T7 — Lusion's two-thirds-matte ratio with the single
 * glossy accent nearest the wordmark (T3) and no glossy white, the one recipe that vanishes on
 * #ffffff. Scales are cast, not computed, from the card's SCALE_MIN..SCALE_MIN + SCALE_SPAN
 * range. z per slot: ±1.5–2 u of depth reads as 0.91–1.10× size from a z ~32 camera, the
 * card's depth cue.
 */
export const CASTING: readonly Slot[] = [
  { family: "white", finish: "matte", scale: 1.2, z: 0 },
  { family: "black", finish: "matte", scale: 1.0, z: 0 },
  { family: "accent", finish: "glossy", scale: 0.9, z: 1.5 },
  { family: "black", finish: "glossy", scale: 0.95, z: -1.5 },
  { family: "accent", finish: "matte", scale: 1.05, z: 0 },
  { family: "white", finish: "matte", scale: 0.9, z: -1 },
  { family: "black", finish: "matte", scale: 0.86, z: -2 },
];

export function heroCount(viewportW: number, viewportH: number): number {
  return viewportW >= HERO.WIDE_W && viewportH >= HERO.WIDE_H ? 7 : 5;
}

export interface HeroFit {
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
 * The camera for a canvas of `width × height` beside an h1 of `h1FontPx`: px/u from the size
 * rule, z from the canvas height at that px/u, clamped to [Z_MIN, Z_MAX] — and when the clamp
 * binds, px/u is re-solved from the clamped view (a 2560 × 1440 window wants z 51; at 40 a
 * unit jack is 179 px, 1.6 × the 112 px font, rather than the 140 the rule asked for).
 */
export function heroCamera(width: number, height: number, h1FontPx: number): HeroFit {
  const tan = Math.tan((HERO.FOV / 2) * (Math.PI / 180));
  const w = width > 0 && Number.isFinite(width) ? width : 1440;
  const h = height > 0 && Number.isFinite(height) ? height : 900;
  const font = h1FontPx > 0 && Number.isFinite(h1FontPx) ? h1FontPx : 112;
  const want = (HERO.D_PER_FONT * font) / HERO.UNIT_DIAM;
  const z = Math.min(HERO.Z_MAX, Math.max(HERO.Z_MIN, h / (want * 2 * tan)));
  const viewH = 2 * z * tan;
  const viewW = viewH * (w / h);
  return { z, viewW, viewH, pxPerUnit: h / viewH, width: w, height: h };
}

/** a DOM rect in CSS px relative to the canvas (the section) */
export interface Rect { left: number; top: number; right: number; bottom: number }
/** a box in world units on z = 0, y UP: y1 is the rect's top */
export interface Box { x0: number; x1: number; y0: number; y1: number }

export function cssToWorld(rect: Rect, fit: HeroFit): Box {
  const px = (x: number) => (x - fit.width / 2) / fit.pxPerUnit;
  const py = (y: number) => (fit.height / 2 - y) / fit.pxPerUnit;
  return { x0: px(rect.left), x1: px(rect.right), y0: py(rect.bottom), y1: py(rect.top) };
}

export interface HeroRects {
  h1: Rect;
  /** the role line's box (the SplitFlap's min-h container) */
  role: Rect;
  /** the visitor card */
  card: Rect;
  /** the "Get in touch" pill's row */
  cta: Rect;
}

const unionBox = (a: Box, b: Box): KeepOut => {
  const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y1, b.y1);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 };
};

/** The keep-out: the h1 ∪ role-line rect as one box. The card is glass and NOT a wall. */
export function keepOut(rects: HeroRects, fit: HeroFit): KeepOut {
  return unionBox(cssToWorld(rects.h1, fit), cssToWorld(rects.role, fit));
}

/**
 * The visitor card ∪ its CTA row — not a wall (a jack the pointer shoves behind the glass
 * shows blurred through it, a feature), but no TARGET parks a disc inside it: measured at
 * 1440 × 900 the brief's T7 anchor (h1.right + 0.3 D = x 831 px) put 50 px of its 121 px disc
 * under the "Get in touch" pill (cta.left 835), a blurred black body behind a control's text
 * in both themes. Targets clear this box to d ≥ 0 along the nearest face.
 */
export function cardBox(rects: HeroRects, fit: HeroFit): KeepOut {
  return unionBox(cssToWorld(rects.card, fit), cssToWorld(rects.cta, fit));
}

/** signed distance from a disc of radius r (plus the pad) at (x, y) to the box's inflated edge — the world's own measure */
function clearance(x: number, y: number, r: number, k: KeepOut): { d: number; gx: number; gy: number } {
  const qx = x - k.cx, qy = y - k.cy;
  const ex = Math.abs(qx) - k.hw, ey = Math.abs(qy) - k.hh;
  const outside = Math.hypot(Math.max(ex, 0), Math.max(ey, 0));
  const d = outside + Math.min(Math.max(ex, ey), 0) - (r + DYN.KEEP_PAD);
  if (ex > 0 && ey > 0) return { d, gx: (ex / outside) * Math.sign(qx), gy: (ey / outside) * Math.sign(qy) };
  if (ex > ey) return { d, gx: Math.sign(qx) || 1, gy: 0 };
  return { d, gx: 0, gy: Math.sign(qy) || 1 };
}

/**
 * Pull targets for the first `count` slots, on z = 0 (plus the slot's z), from the live rects.
 * Anchors in units of D — the slot's own diameter — as the panel placed them, with screen y
 * (downward) converted to world y (up):
 *   T1 (1.2, white matte): h1.left + 0.6 D, role.bottom + 0.7 D — the big settled one under the role line, left-aligned to the I
 *   T2 (1.0, black matte): T1 + (0.75 D, +0.15 D) — TOUCHING T1: the hero's one resting contact, the occlusion crease
 *   T3 (0.9, accent glossy): h1.left + 1.6 D, h1.top − 0.75 D, z +1.5 — above the name, the one glossy accent
 *   T4 (0.95, black glossy): card.right − 0.5 D, card.top − 0.8 D, z −1.5
 *   T5 (1.05, accent matte): card.left + 0.4 D, cta.bottom + 0.8 D
 *   T6 (0.9, white matte): T5 + (0.8 D, −0.1 D), z −1 — a second resting pair under the card
 *   T7 (0.86, black matte): h1.right + 0.3 D, role.bottom + 1.5 D, z −2 — low, between the columns
 * Then three corrections the panel's numbers did not carry. CLAMP: the disc stays EDGE_D inside
 * the canvas. CARD: the disc clears the card ∪ CTA box (cardBox — T7 was under the pill).
 * CLEARANCE: the band's force must be exactly zero at rest, so a target closer than KEEP_BAND
 * to the inflated keep-out is moved out along the nearest face to exactly KEEP_BAND — measured
 * at 1440 × 900 the brief's T1 sat 0.44 u from the inflated edge (1.85 u below role.bottom
 * against r 1.26 + 0.15 + 1.5 = 2.91 u wanted) and T3 0.39 u above the h1 (1.49 u against
 * 2.60), both well inside the 1.5 u band; T1 moves down 1.06 u (0.40 D), T3 up 1.11 u
 * (0.56 D). T2 rides with T1's shift so the pair still touches, T6 with T5's.
 */
export function targetsFor(rects: HeroRects, fit: HeroFit, count: number): Vec3[] {
  const h1 = cssToWorld(rects.h1, fit), role = cssToWorld(rects.role, fit), card = cssToWorld(rects.card, fit), cta = cssToWorld(rects.cta, fit);
  const D = CASTING.map((s) => HERO.UNIT_DIAM * s.scale);
  const raw: { x: number; y: number }[] = [
    { x: h1.x0 + 0.6 * D[0], y: role.y0 - 0.7 * D[0] },
    { x: 0, y: 0 }, // T2 from T1 below
    { x: h1.x0 + 1.6 * D[2], y: h1.y1 + 0.75 * D[2] },
    { x: card.x1 - 0.5 * D[3], y: card.y1 + 0.8 * D[3] },
    { x: card.x0 + 0.4 * D[4], y: cta.y0 - 0.8 * D[4] },
    { x: 0, y: 0 }, // T6 from T5 below
    { x: h1.x1 + 0.3 * D[6], y: role.y0 - 1.5 * D[6] },
  ];
  const k = keepOut(rects, fit);
  const glass = cardBox(rects, fit);
  const settle = (i: number, p: { x: number; y: number }) => {
    const r = DYN.BODY_R * CASTING[i].scale;
    const mx = fit.viewW / 2 - HERO.EDGE_D * D[i], my = fit.viewH / 2 - HERO.EDGE_D * D[i];
    const q = { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
    const g = clearance(q.x, q.y, r, glass);
    if (g.d < 0) { q.x -= g.gx * g.d; q.y -= g.gy * g.d; }
    const c = clearance(q.x, q.y, r, k);
    if (c.d < DYN.KEEP_BAND) { const push = DYN.KEEP_BAND - c.d; q.x += c.gx * push; q.y += c.gy * push; }
    return q;
  };
  const out: Vec3[] = [];
  const t1 = settle(0, raw[0]);
  out.push({ ...t1, z: CASTING[0].z });
  out.push({ ...settle(1, { x: t1.x + 0.75 * D[1], y: t1.y - 0.15 * D[1] }), z: CASTING[1].z });
  out.push({ ...settle(2, raw[2]), z: CASTING[2].z });
  out.push({ ...settle(3, raw[3]), z: CASTING[3].z });
  const t5 = settle(4, raw[4]);
  out.push({ ...t5, z: CASTING[4].z });
  out.push({ ...settle(5, { x: t5.x + 0.8 * D[5], y: t5.y + 0.1 * D[5] }), z: CASTING[5].z });
  // T7 is the between-the-columns jack, and the column gap (gap-x-10, 40 px) is narrower than
  // its 121 px disc, so the card box catches it wherever it shows. It steps LEFT out of the
  // box, not along the nearest face: measured at 1440 × 900 on the live rects, the nearest-face
  // push went mostly down (−36 px) and put its target 91 px from T5's (radii 128 px) — the
  // T5/T6/T7 trio jammed and lifted T5 84 px, its resting disc 33 px into the pill's row.
  // Stepping left (x 769 px, disc 711–827) clears the pill and leaves T5 on its target.
  const r7 = DYN.BODY_R * CASTING[6].scale;
  const leftOfGlass = glass.cx - glass.hw - (r7 + DYN.KEEP_PAD);
  const meetsGlassY = raw[6].y + r7 + DYN.KEEP_PAD > glass.cy - glass.hh;
  out.push({ ...settle(6, { x: meetsGlassY ? Math.min(raw[6].x, leftOfGlass) : raw[6].x, y: raw[6].y }), z: CASTING[6].z });
  return out.slice(0, Math.max(0, Math.min(count, CASTING.length)));
}

/**
 * The entrance, without a dolly (a dolly changes the CSS→world mapping the DOM-measured zones
 * depend on): each body spawns beyond its NEAREST view edge by SPAWN_D of its own diameter,
 * the other coordinate kept, with Lusion's vel = SPAWN_VEL·(pos − target) — so no fly-in
 * crosses the name (T3 drops from above it, T1/T2 rise from below) and the first frame already
 * shows the set arriving. Orientations keep createWorld's seeded draw.
 */
export function placeWorld(world: World, targets: readonly Vec3[], fit: HeroFit): void {
  world.bodies.forEach((b, i) => {
    const t = targets[i];
    if (!t) return;
    const D = HERO.UNIT_DIAM * (b.r / DYN.BODY_R);
    const edges = [fit.viewW / 2 + t.x, fit.viewW / 2 - t.x, fit.viewH / 2 + t.y, fit.viewH / 2 - t.y]; // left, right, bottom, top
    const nearest = edges.indexOf(Math.min(...edges));
    const pos = { x: t.x, y: t.y, z: t.z };
    if (nearest === 0) pos.x = -fit.viewW / 2 - HERO.SPAWN_D * D;
    else if (nearest === 1) pos.x = fit.viewW / 2 + HERO.SPAWN_D * D;
    else if (nearest === 2) pos.y = -fit.viewH / 2 - HERO.SPAWN_D * D;
    else pos.y = fit.viewH / 2 + HERO.SPAWN_D * D;
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
