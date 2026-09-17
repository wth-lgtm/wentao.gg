// The jack field's frame: a FIXED, page-wide layer, so everything here is in viewport space
// and nothing is anchored to a section's DOM. How big a jack is (from the wordmark's font
// size), where the camera sits, where the sixteen settle (a jittered lattice, solved against
// what is on screen), how they arrive (beyond the nearest edge), which recipe each wears, and
// how a DOM rect becomes a keep-out box while it is on screen. Pure — the scene measures and
// hands things in; every rule runs in node at 1440 × 900, 1024 × 768, 1440 × 700, 1366 × 768.
//
// The object is the card's jack (jackGeometry.ts, jackMaterials.ts) — the owner compared and
// kept it: "the previous one that's exactly the same as lusion looks better with the black
// white and blue color scheme". What this module changes about the card is DATA: count, scale,
// homes, and a casting that means nothing.

import type { Family, Finish } from "./connectorJacks";
import { DYN, type KeepOut, type Vec3, type World } from "./jackDynamics";
import { rand } from "./seed";

export const FIELD = {
  /** Lusion's lens, as on the card: narrow, fixed, no parallax */
  FOV: 25,
  NEAR: 2,
  FAR: 80,
  /**
   * a unit jack's diameter = this × the h1's computed font size — between the hero's 1.25
   * (seven jacks) and the stones' 1.1 (sixteen), because sixteen jacks with arms read larger
   * than sixteen stones. 1.15 shipped (129 px beside the 112 px wordmark at 1440 × 900); the
   * owner asked for "slightly bigger" → 1.23 (137.8 px, +7% linear, +14% area). The ceiling is
   * the SHORT viewport, not taste: the view narrows in world units as the camera comes in and
   * the fixed h1/card boxes swallow cells. Measured on tests/field-layout.test.ts with only
   * this constant changed: 1.30 culls slots 0, 7, 8 at 1440 × 700 and clamps z at Z_MIN
   * (unclamped 23.86); 1.25 still culls slot 7; 1.24 fails the "12 u wall is escapable"
   * assertion; 1.23 is the largest that keeps every fixture whole. A 900 px display minus
   * browser chrome is ≈ 780–800 px tall, so dropping jacks there is not "slightly bigger".
   */
  D_PER_FONT: 1.23,
  /** the jack's diameter at scale 1, as the card measures it */
  UNIT_DIAM: 2.2,
  /** without an h1 to measure (a project page), the view is this many units tall */
  FALLBACK_VIEW_H: 9,
  Z_MIN: 24,
  Z_MAX: 40,
  /** the entrance spawns each jack this many of its own diameters beyond its nearest edge */
  SPAWN_D: 1.5,
  /** sixteen at or above this viewport, ten below */
  WIDE_W: 1280,
  WIDE_H: 800,
  /** the lattice keeps this fraction of the viewport clear on each side */
  MARGIN: 0.08,
  /** a target may sit this far off its lattice cell's centre, as a fraction of the cell */
  JITTER: 0.3,
  /** the cast's scales */
  SCALE_MIN: 0.72,
  SCALE_MAX: 1.15,
  /** the depth slots, ± alternating */
  Z_MAX_ABS: 2,
} as const;

/** one seed for the scales, the casting, the jitter, the orientations and the click kicks */
export const SEED_FIELD = 17;

export function fieldCount(viewportW: number, viewportH: number): number {
  return viewportW >= FIELD.WIDE_W && viewportH >= FIELD.WIDE_H ? 16 : 10;
}

/**
 * Scales for `count` jacks over [SCALE_MIN, SCALE_MAX], stratified — the i-th of sixteen
 * draws from the i-th sixteenth of the range, then the order is shuffled — so ten or sixteen
 * cover the whole range and no two draws collide. A prefix of the sixteen for ten.
 */
export function fieldScales(count: number, seed: number): number[] {
  const n = 16;
  const strata = Array.from({ length: n }, (_, i) => FIELD.SCALE_MIN + ((FIELD.SCALE_MAX - FIELD.SCALE_MIN) * (i + rand(i, seed + 11))) / n);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand(i, seed + 12) * (i + 1));
    [strata[i], strata[j]] = [strata[j], strata[i]];
  }
  return strata.slice(0, Math.max(0, Math.min(count, n)));
}

export interface Slot { family: Family; finish: Finish }
const cast = (family: Family, finish: Finish, n: number): Slot[] => Array.from({ length: n }, () => ({ family, finish }));
/**
 * The casting's shares — the card's black / white / cobalt, matte majority, glossy accents.
 * Sixteen: accent 5 (4 matte, 1 glossy), white 6 (5 matte, 1 glossy), black 5 (3 matte,
 * 2 glossy). Ten: accent 3 (2/1), white 4 (3/1), black 3 (2/1). Never data.
 */
export const CAST_16: readonly Slot[] = [...cast("accent", "matte", 4), ...cast("accent", "glossy", 1), ...cast("white", "matte", 5), ...cast("white", "glossy", 1), ...cast("black", "matte", 3), ...cast("black", "glossy", 2)];
export const CAST_10: readonly Slot[] = [...cast("accent", "matte", 2), ...cast("accent", "glossy", 1), ...cast("white", "matte", 3), ...cast("white", "glossy", 1), ...cast("black", "matte", 2), ...cast("black", "glossy", 1)];

const FAMILIES: readonly Family[] = ["accent", "white", "black"];

/** the lattice's cells (row-major index) that touch cell c across an edge, and across an edge or a corner */
function neighbours(c: number, cols: number, rows: number): { four: number[]; eight: number[] } {
  const col = c % cols, row = Math.floor(c / cols);
  const four: number[] = [], eight: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const r = row + dr, q = col + dc;
    if (r < 0 || r >= rows || q < 0 || q >= cols) continue;
    const i = r * cols + q;
    eight.push(i);
    if (!dr || !dc) four.push(i);
  }
  return { four, eight };
}

/**
 * Which family each slot wears, decided ON THE LATTICE rather than in slot order: the v3
 * casting shuffled families with one seed and cells with another, and the replayed 4 × 4 grid
 * put three of the five accents in one 2 × 2 block (the frame showed it). This walks the cells
 * in the lattice's own visiting order (latticeOrder — slot k is that cell) and assigns each the
 * most-plentiful remaining family that no already-assigned edge neighbour wears, preferring
 * one no corner neighbour wears either; the one HARD rule is that two accents never share an
 * edge (a depth-first search backtracks rather than break it — five accents on a 4 × 4 can
 * never avoid each other's corners too: a 2 × 2 block is a clique on corners, so 8-connected
 * independence tops out at four). Finishes: within a family, the glossy pieces go to the
 * members at evenly spread positions of the walk. Deterministic; a prefix rule is not needed
 * because ten and sixteen use different lattices.
 */
export function fieldCasting(count: number, seed: number): Slot[] {
  const base = count >= 16 ? CAST_16 : CAST_10;
  const { cols, rows } = latticeShape(count);
  const order = latticeOrder(count, seed);
  const n = Math.min(count, order.length, base.length);
  const pool: Record<Family, number> = { accent: 0, white: 0, black: 0 };
  const glossy: Record<Family, number> = { accent: 0, white: 0, black: 0 };
  for (const s of base.slice(0, n)) { pool[s.family]++; if (s.finish === "glossy") glossy[s.family]++; }
  const assigned: (Family | null)[] = Array.from({ length: cols * rows }, () => null);
  const result: Family[] = [];
  const dfs = (k: number): boolean => {
    if (k === n) return true;
    const c = order[k];
    const nb = neighbours(c, cols, rows);
    const worn4 = new Set(nb.four.map((i) => assigned[i]).filter(Boolean) as Family[]);
    const worn8 = new Set(nb.eight.map((i) => assigned[i]).filter(Boolean) as Family[]);
    const cands = FAMILIES.filter((f) => pool[f] > 0).sort((a, b) => {
      const ka = (worn4.has(a) ? 4 : 0) + (worn8.has(a) ? 1 : 0), kb = (worn4.has(b) ? 4 : 0) + (worn8.has(b) ? 1 : 0);
      return ka - kb || pool[b] - pool[a] || FAMILIES.indexOf(a) - FAMILIES.indexOf(b);
    });
    for (const f of cands) {
      if (f === "accent" && worn4.has("accent")) continue;
      assigned[c] = f; pool[f]--; result[k] = f;
      if (dfs(k + 1)) return true;
      assigned[c] = null; pool[f]++;
    }
    return false;
  };
  if (!dfs(0)) {
    // unreachable for the shipped counts and lattices; the plain greedy keeps the field drawable
    result.length = 0;
    for (let k = 0; k < n; k++) { const f = FAMILIES.filter((g) => pool[g] > 0).sort((a, b) => pool[b] - pool[a])[0]; pool[f]--; result[k] = f; }
  }
  const glossyAt = new Set<number>();
  for (const f of FAMILIES) {
    const members = result.map((g, k) => (g === f ? k : -1)).filter((k) => k >= 0);
    for (let j = 0; j < glossy[f]; j++) glossyAt.add(members[Math.floor(((j + 0.5) * members.length) / glossy[f])]);
  }
  return result.map((f, k) => ({ family: f, finish: glossyAt.has(k) ? "glossy" : "matte" }));
}

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
 * 1440 × 900 with the 112 px h1: 62.6 px/u, z 32.4; 1024 × 768 (92.16 px): 51.5 px/u,
 * z 33.6; 1440 × 700: z 25.2; no h1 at 900 tall: 100 px/u wants z 20.3, gets 24 → 84.6 px/u.
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
 * mid-page resize does not hand out cells that lie behind the name at the top.
 */
export function atPageTop(rect: Rect, scrollY: number): Rect {
  return { left: rect.left, right: rect.right, top: rect.top + scrollY, bottom: rect.bottom + scrollY };
}

/** the lattice's shape for a count: 4 × 4 for sixteen, 5 × 2 for ten (five across a 1024-wide viewport, two rows) */
export function latticeShape(count: number): { cols: number; rows: number } {
  return count >= 16 ? { cols: 4, rows: 4 } : { cols: 5, rows: 2 };
}

/** the seeded order in which the lattice's cells are visited — slot k is cell order[k] (row-major); the targets and the casting share it so both see the same grid */
export function latticeOrder(count: number, seed: number): number[] {
  const { cols, rows } = latticeShape(count);
  const cells = cols * rows;
  const order = Array.from({ length: cells }, (_, i) => i);
  for (let i = cells - 1; i > 0; i--) {
    const j = Math.floor(rand(i, seed + 21) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Raw pull targets: a jittered lattice across the viewport inside MARGIN, one jack per cell
 * in a seeded order, each within JITTER of its cell's centre; z alternates in sign down the
 * list with magnitudes 0.25, 0.75, 1.25, 1.75 (of Z_MAX_ABS 2) so no two neighbours share a
 * depth. Never anchored to the page's DOM — the layer is fixed.
 */
export function latticeTargets(fit: FieldFit, count: number, seed: number): Vec3[] {
  const { cols, rows } = latticeShape(count);
  const cells = cols * rows;
  const order = latticeOrder(count, seed);
  const spanW = fit.viewW * (1 - 2 * FIELD.MARGIN), spanH = fit.viewH * (1 - 2 * FIELD.MARGIN);
  const cellW = spanW / cols, cellH = spanH / rows;
  const out: Vec3[] = [];
  for (let k = 0; k < Math.min(count, cells); k++) {
    const c = order[k];
    const col = c % cols, row = Math.floor(c / cols);
    const cx = -spanW / 2 + cellW * (col + 0.5), cy = spanH / 2 - cellH * (row + 0.5);
    const jx = (rand(k, seed + 22) - 0.5) * 2 * FIELD.JITTER * cellW;
    const jy = (rand(k, seed + 23) - 0.5) * 2 * FIELD.JITTER * cellH;
    const mag = (FIELD.Z_MAX_ABS * (((k >> 1) % 4) + 0.5)) / 4;
    out.push({ x: cx + jx, y: cy + jy, z: k % 2 ? -mag : mag });
  }
  return out;
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
  /** one per KEPT slot, in slot order */
  targets: Vec3[];
  /** the lattice slots dropped: their disc would still sit more than a quarter-diameter into a band after the pushes and the clamp */
  culled: number[];
}

/**
 * The lattice, made to live with what is on screen when it is solved (mount, resize): each
 * target's disc is pushed out of every `avoid` box's band to exactly KEEP_BAND — where the
 * band's force is zero, so a jack rests ON its target — along the nearest face, or along the
 * perpendicular face when the nearest one would put the disc outside the view (on a 700 px
 * viewport the visitor card's band reaches both edges, and a slot in its column can only leave
 * sideways); four passes because a push out of one box can land in another's band; then the
 * disc is clamped inside the view; then a slot whose disc the clamp left more than 0.25 D
 * inside a band is culled (the band would hold that jack off its home for as long as the box
 * is on screen). The band is evaluated where the CAMERA sees the target: a slot at depth z
 * projects onto z = 0 by proj = z_cam / (z_cam − z), so the clearance is taken at q·proj with
 * the push divided by proj — a z −1.75 target sits 5% nearer the centre than its world x says,
 * a z +1.75 one 6% further out. Solved once per layout, never on scroll: the layer is fixed,
 * the page moves under it, and a jack's home must not move when the hero scrolls off.
 */
export function solveTargets(fit: FieldFit, count: number, seed: number, scales: readonly number[], avoid: readonly KeepOut[], cull = true): Solved {
  const raw = latticeTargets(fit, count, seed);
  const targets: Vec3[] = [];
  const culled: number[] = [];
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
    if (cull && deepest > 0.25 * D) culled.push(i);
    else targets.push({ x, y, z: t.z });
  });
  return { targets, culled };
}

/**
 * The entrance, no dolly (a dolly changes the CSS→world mapping the keep-out depends on):
 * each body spawns beyond its NEAREST viewport edge by SPAWN_D of its own diameter, the other
 * coordinate kept, with Lusion's vel = SPAWN_VEL·(pos − target). Orientations keep
 * createWorld's seeded draw.
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
