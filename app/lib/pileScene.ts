// The pile's world and the camera fitted to it, kept pure so the DOM can decide whether a
// tray is worth mounting and the tests can check the framing without a WebGL context.
//
// The tray is world-fixed: a 7.0 × 2.6 u inner floor with its top at y = 0 and the origin
// at its centre. The old scene did it the other way round — the box was sized from the
// viewport — so every height in it (mouth, ceiling, floor, escape test, DOM gate) was a
// screen-plane quantity that a tilted camera made false. Here the canvas only ever moves
// the camera.

export const WORLD = {
  /** inner floor, x */
  W: 7.0,
  /** inner floor, z */
  D: 2.6,
  /** lip thickness, outward from the inner face */
  LIP: 0.25,
  /** front and side lips: low enough that a 40° camera sees the floor and the front lane */
  LIP_H: 0.28,
  /** the back lip is taller — a quiet horizon behind the heap */
  BACK_H: 0.45,
  /** floor slab thickness (its top is y = 0) */
  SLAB_T: 0.12,
  /** where a two-layer heap crests (coverage 1.8 of the floor, see trayFit) */
  CREST: 0.9,
  /** the three pour lanes in z, back to front, and the jitter around each */
  LANES: [-0.8, 0, 0.8] as const,
  LANE_JITTER: 0.15,
  /** toy-block gravity: a 3 u fall in ~0.3 s. Real scale for 0.3 u pieces would be an
   *  8-frame drop nobody sees; 60 is a legibility compromise, not a die analogy. */
  G: 60,
} as const;

export const CAMERA = {
  /** vertical field of view, degrees — a long lens: 13° is 32° horizontal on the 2.53:1
   *  tray, against the 92.7° the old fov-45 camera spread across it */
  FOV: 13,
  /** elevation above the floor plane, degrees — the board's rotateX 50 seen from 40° */
  ELEVATION: 40,
  LOOK_AT: { x: 0, y: 0.3, z: 0 },
  NEAR: 4,
  FAR: 40,
  /** the tray's outer width spans this much of the canvas: an object on a card, not a
   *  band edge to edge */
  WIDTH_FILL: 0.84,
  /** the legend's line at the top of the tray column and a breath at the bottom */
  LEGEND_PX: 28,
  BOTTOM_PX: 12,
  /** pointer drift, degrees, an orbit about the look-at */
  YAW_DRIFT: 3,
  PITCH_DRIFT: 1.5,
} as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** A camera orbiting the look-at: `yaw` about the vertical axis (positive = toward +x),
 *  `elevation` above the floor plane, `distance` from the look-at. */
export interface Pose {
  position: Vec3;
  /** camera-space basis (three's lookAt convention): x right, y up, z toward the viewer */
  right: Vec3;
  up: Vec3;
  back: Vec3;
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function poseFor(distance: number, yawDeg = 0, elevationDeg: number = CAMERA.ELEVATION, lookAt: Vec3 = CAMERA.LOOK_AT): Pose {
  const y = yawDeg * DEG;
  const e = elevationDeg * DEG;
  const back = norm({ x: Math.sin(y) * Math.cos(e), y: Math.sin(e), z: Math.cos(y) * Math.cos(e) });
  const position = { x: lookAt.x + back.x * distance, y: lookAt.y + back.y * distance, z: lookAt.z + back.z * distance };
  const right = norm(cross({ x: 0, y: 1, z: 0 }, back));
  const up = cross(back, right);
  return { position, right, up, back };
}

/** Normalised device coordinates of `p` for a perspective camera at `pose`. */
export function projectNdc(p: Vec3, pose: Pose, aspect: number, fovDeg: number = CAMERA.FOV): { x: number; y: number; depth: number } {
  const v = { x: p.x - pose.position.x, y: p.y - pose.position.y, z: p.z - pose.position.z };
  const depth = -dot(v, pose.back);
  const t = Math.tan((fovDeg / 2) * DEG);
  return { x: dot(v, pose.right) / (depth * t * aspect), y: dot(v, pose.up) / (depth * t), depth };
}

/** Every point the frame must hold: the tray's outer box, the taller back lip and the
 *  crest of a two-layer heap over the inner floor. */
export function sceneVertices(): Vec3[] {
  const hx = WORLD.W / 2 + WORLD.LIP;
  const hz = WORLD.D / 2 + WORLD.LIP;
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push({ x: sx * hx, y: -WORLD.SLAB_T, z: sz * hz });
      out.push({ x: sx * hx, y: WORLD.LIP_H, z: sz * hz });
      out.push({ x: sx * (WORLD.W / 2), y: WORLD.CREST, z: sz * (WORLD.D / 2) });
    }
    // the back lip's top edge, outer and inner faces
    out.push({ x: sx * hx, y: WORLD.BACK_H, z: -hz });
    out.push({ x: sx * hx, y: WORLD.BACK_H, z: -WORLD.D / 2 });
  }
  out.push({ x: 0, y: WORLD.CREST, z: -WORLD.D / 2 });
  return out;
}

/** The rest pose and the four corners of the drift envelope. The drift is an orbit about
 *  the look-at, so the framing barely moves with it (the back crest's screen height changes
 *  ~1.5% over ±1.5° of pitch); the budget still checks every corner rather than assume. */
export function driftPoses(distance: number): Pose[] {
  const out: Pose[] = [poseFor(distance)];
  for (const sy of [-1, 1]) for (const sp of [-1, 1]) out.push(poseFor(distance, sy * CAMERA.YAW_DRIFT, CAMERA.ELEVATION + sp * CAMERA.PITCH_DRIFT));
  return out;
}

export interface CameraFit {
  /** camera distance from the look-at */
  distance: number;
  /** the distance the width rule alone would give, and the height rule alone */
  dWidth: number;
  dHeight: number;
  position: Vec3;
  /** pixels per world unit in the look-at plane */
  pxPerUnit: number;
  /** the height budget shrank the tray to no less than 65% of the canvas width; below that
   *  a too-short tray column would draw a strip, and the DOM keeps the board alone */
  headroomOk: boolean;
  aspect: number;
  heightPx: number;
}

// The width fill is a composition choice, so it is measured at REST; the top and bottom
// reserves guard the clip edges, so they are measured over the whole drift envelope.
function extents(distance: number, aspect: number) {
  let maxX = 0;
  let maxY = -Infinity;
  let minY = Infinity;
  const verts = sceneVertices();
  const poses = driftPoses(distance);
  for (const v of verts) {
    const rest = projectNdc(v, poses[0], aspect);
    if (Math.abs(rest.x) > maxX) maxX = Math.abs(rest.x);
    for (const pose of poses) {
      const n = projectNdc(v, pose, aspect);
      if (n.y > maxY) maxY = n.y;
      if (n.y < minY) minY = n.y;
    }
  }
  return { maxX, maxY, minY };
}

// Extents shrink monotonically with distance, so a bisection finds the distance at which
// the tightest rule is exactly met.
function solve(pred: (d: number) => boolean): number {
  let lo = 2;
  let hi = 80;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (pred(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Fit the camera two ways and keep the farther: `dWidth` makes the tray's outer width span
 * WIDTH_FILL of the canvas; `dHeight` keeps every scene vertex, at every drift pose, under
 * the legend reserve at the top and above the breath at the bottom. At the live 1440 px
 * card (691 × 273, aspect 2.53) the width rule binds at d ≈ 16.6 u (≈ 72 px/u), set by the
 * slab's FRONT-bottom corners, which sit ~0.9 u nearer the camera than the look-at plane
 * and so project wider than the tray's nominal 7.5 u would at that plane. The design
 * expected ≈ 91 px/u from d ≈ 12.7 — a distance at which its own budget put the back crest
 * 12 px from the top edge, under the legend.
 */
export function fitCamera(aspect: number, heightPx = 273): CameraFit {
  const legend = CAMERA.LEGEND_PX / (heightPx / 2);
  const bottom = CAMERA.BOTTOM_PX / (heightPx / 2);
  const dWidth = solve((d) => extents(d, aspect).maxX <= CAMERA.WIDTH_FILL);
  const dHeight = solve((d) => {
    const e = extents(d, aspect);
    return e.maxY <= 1 - legend && e.minY >= -1 + bottom;
  });
  const distance = Math.max(dWidth, dHeight);
  const pose = poseFor(distance);
  const pxPerUnit = heightPx / (2 * distance * Math.tan((CAMERA.FOV / 2) * DEG));
  return {
    distance,
    dWidth,
    dHeight,
    position: pose.position,
    pxPerUnit,
    headroomOk: dWidth / distance >= 0.65 / CAMERA.WIDTH_FILL,
    aspect,
    heightPx,
  };
}

/**
 * The world y at which the frame's top edge crosses the vertical line x = 0 at depth `z`,
 * for the rest pose at `distance`. Lane-dependent under a tilted camera: at d 15.5 the top
 * edge sits at y ≈ 1.5 over the back wall and ≈ 3.4 over the front lip.
 */
export function frameTopY(distance: number, z: number): number {
  const e = CAMERA.ELEVATION * DEG;
  const t = Math.tan((CAMERA.FOV / 2) * DEG);
  const ce = Math.cos(e);
  const se = Math.sin(e);
  // (y − Ly)·cos e − z·sin e = t·(d − (y − Ly)·sin e − z·cos e), solved for y
  return CAMERA.LOOK_AT.y + (t * distance + z * (se - t * ce)) / (ce + t * se);
}

/**
 * Where a train's lowest piece appears: just above the frame's top edge over the front lip,
 * plus the half-diagonal of a tumbled level-4 stick (≈ 1.07 k) so no corner shows before
 * it falls in. Read at release time from the live fit, never baked into the layout — a
 * layout that changed with the canvas re-ran setTranslation on every settled body.
 */
export function mouthFor(fit: CameraFit, k: number): number {
  return frameTopY(fit.distance, WORLD.D / 2 + WORLD.LIP) + 1.1 * k;
}

/**
 * Speed caps after a shove, from the frame budget rather than a constant: a piece launched
 * from the crest rises V²/(2g), so V_CAP = √(2·g·rise) with `rise` the headroom the frame's
 * top edge leaves over the crest at the BACK wall — the lane with the least of it. W_CAP
 * turns that into a spin the largest half-extent (a level-4 stick's) cannot exceed.
 */
export function capsFor(fit: CameraFit, k: number): { vCap: number; wCap: number; rise: number } {
  const rise = Math.max(0.2, frameTopY(fit.distance, -WORLD.D / 2) - WORLD.CREST);
  const vCap = Math.sqrt(2 * WORLD.G * rise);
  const halfExtent = 1.035 * k; // a level-4 box at its tallest jitter, halved
  return { vCap, wCap: vCap / halfExtent, rise };
}
