// The jacks' dynamics: Lusion's sphere-body model (lusion.co's hero, HomeBalloonsBody /
// HomeBalloonsPhysics), ported as RATES so the feel is the same at 30, 60 and 120 Hz, with
// the two additions the house rule "a resting scene costs nothing" needs — a resting-contact
// treatment so touching bodies can actually stop, and a rest test on what moved — and one the
// hero needs: an optional keep-out band that holds bodies off a rectangle of text (the card
// passes none and is untouched). Pure, no physics library: 66 sphere pairs a substep is
// nothing, and every rule below runs in node.
//
// Mass is (4/3)·π·r³ (Lusion: volume = π·r·1.333, mass = volume·r²). It is what makes the
// central pull K 40 read as ω 2.87 rad/s, ζ 0.28 and a 2.2 s period for a unit jack — heavy
// fruit settling — where r³ alone made springs 4.2× stiffer, tumbles 4× faster and click
// kicks 8× larger.

import { rand } from "./seed";

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

export interface Body {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /** the pull's target: (i − 5.5)·0.6 along x by default, so the card's pack keeps a statistical oldest-left drift; the hero places its own (heroLayout.ts) */
  target: Vec3;
  /** the collision radius, BODY_R × the mesh scale */
  r: number;
  m: number;
  /** 0.4·m·r², Lusion's; the tumble is cross(pos − target, vel)/I */
  I: number;
  /** Lusion's contact friction: + T per contact, halved per 60 Hz step, softens the pull */
  frictionTot: number;
  /** the swirl's sign alternates by index — two interleaved counter-rotating streams */
  swirl: 1 | -1;
}

/** A ray from the camera through the cursor, and the cursor's velocity on the z = 0 plane. */
export interface Pointer {
  origin: Vec3;
  /** unit */
  dir: Vec3;
  /** u/s, from the REAL frame delta (unclamped), zero on the first frame after enter */
  vel: Vec3;
}

/**
 * A box on the z = 0 plane bodies are held off, in world units. Each body inflates it by its
 * own radius plus KEEP_PAD, which makes the inflated shape a rounded rectangle with corners of
 * that radius — the set of centres whose disc touches the box — so no corner radius is stored.
 */
export interface KeepOut {
  cx: number;
  cy: number;
  /** half-extents */
  hw: number;
  hh: number;
  /** the band's acceleration for this box as a fraction of K_KEEP; absent = 1 (the stone field's visitor card runs at 0.5) */
  strength?: number;
}

export interface World {
  bodies: Body[];
  seed: number;
  /** simulated seconds — the sum of CLAMPED frame deltas */
  time: number;
  /** soft bound half-extents in x and y: 1.3× the visible half-extents at z 0 */
  boundX: number;
  boundY: number;
  /** sim time until which the speed cap is CAP_CLICK */
  capUntil: number;
  clicks: number;
  /** sim seconds of consecutive frames that met the rest test */
  still: number;
  /** boxes bodies are held off (the hero's wordmark); empty for the card */
  keepOut: KeepOut[];
  /** the camera's z the keep-out is seen from, so a body is tested where the camera projects it onto z = 0; 0 tests x, y as they are */
  eyeZ: number;
}

export interface StepResult {
  steps: number;
  /** the clamped frame delta the world integrated */
  dt: number;
  /** the largest |Δpos| of any body over the frame, world units */
  maxDpos: number;
  /** the largest angle any body turned over the frame, radians */
  maxDang: number;
}

export const DYN = {
  /** Lusion's GRAVITY_FACTOR: vel += (target − pos)·K/m per second */
  K_PULL: 40,
  /** velocity keeps this fraction per second — τ 0.62 s */
  DAMP: 0.2,
  /**
   * Tangential contact friction as the idle envelope closes: a touching pair loses
   * 1 − e^(−REST_FRICTION·h·(1 − E)) of its tangential relative velocity per substep — nothing
   * at E = 1 (Lusion's frictionless model, exactly), 74% per 60 Hz step at E = 0. Measured
   * without it the pack never rests: twelve frictionless spheres pulled to twelve different
   * points on a line are under permanent shear (a body 1.8 u from its target with two
   * contacts had 1.65 u of that pull tangential to them) and slide around each other at the
   * tangential pull × τ, 0.05–0.4 u/s, still 1.3–3.9e-3 u/frame after 30 s — more velocity
   * damping only moved the terminal speed. Friction lets the pack JAM, as real jacks do.
   */
  REST_FRICTION: 80,
  /**
   * Extra velocity damping as the envelope closes, SETTLE^(h·(1 − E)): nothing at E = 1, a
   * total rate of 9.7/s (τ 0.10 s) at E = 0. Friction stops bodies sliding on each other but
   * not a jammed clump moving as one: two of eleven scale sets (all-floor, one random) kept
   * a whole-pack drift of 0.085–0.10 u/s under the pull's torque for 30 s with friction
   * alone; τ 0.10 s puts the same drift under the rest test. Alone (measured first) this
   * did nothing for the sliding creep — a terminal speed moves with τ, its drive does not.
   */
  SETTLE: 3e-4,
  /** the swirl's rate: angle = h·fit(|pos|,0,2,0,1)·SWIRL·(1 − |â·p̂|) about (1,1,1) */
  SWIRL: 0.5,
  /** Lusion's contact friction T = √(f₁·f₂) with f 2 */
  T_FRICTION: 2,
  /** Lusion's nominal restitution; with the /(1+T) split touching bodies keep 40% of their closing speed — they decelerate, they never bounce */
  RESTITUTION: 0.8,
  /** a pair closing slower than this is a resting contact: its normal relative velocity is zeroed, so the pull's per-step push does not accumulate as a fictitious 0.17 u/s */
  CLOSING_MIN: 0.3,
  /** Lusion's MOUSE_RADIUS: bodies within r + this of the ray are under the cursor */
  POINTER_PAD: 0.025,
  /** Lusion's 0.1·pen displacement per 60 Hz frame, as a rate */
  POINTER_SHOVE: 6,
  /** Lusion's 0.012·pen/dt perpendicular velocity per 60 Hz frame (0.72·pen), as a rate */
  POINTER_KICK: 43,
  /** Lusion's 0.12·(pointer travel per frame) — 0.12·v_pointer per 60 Hz frame — as a rate */
  POINTER_DRAG: 7.2,
  /** u/s; Lusion's flicks reach 25–40, the entrance passes through at ~13 — 12 clipped both */
  CAP: 20,
  CAP_CLICK: 25,
  CAP_CLICK_S: 0.3,
  /** |z| beyond this is turned back (a jack at z +6 near-clips a z 9.5 camera) */
  Z_BOUND: 3,
  /** the soft bounds' spring, no mass */
  K_BOUND: 20,
  /** x/y soft bound as a multiple of the visible half-extents at z 0 */
  BOUND_VIEW: 1.3,
  /** Lusion's applyImpulse: vel = −vel + (−(pos − target)·CLICK_PULL + (rand − 0.5)·CLICK_KICK)/m */
  CLICK_PULL: 10,
  CLICK_KICK: 80,
  /** frame delta clamp: a 0 delta is Infinity in the pointer terms, a 30× one a fake flick */
  DT_MIN: 1e-3,
  DT_MAX: 1 / 30,
  /** substep length; every rate above equals Lusion's per-frame value at this step */
  STEP: 1 / 60,
  /**
   * Rest: nothing moving faster than REST_V (u/s) or turning faster than REST_W (rad/s) for
   * REST_S seconds of sim time with E = 0 — the design's 1e-3 u and 1e-3 rad per 60 Hz frame
   * over 30 frames, written as rates so a 30 Hz device (or software GL integrating the 1/30
   * clamp every frame) judges the same creep the same way.
   */
  REST_V: 0.06,
  REST_W: 0.06,
  REST_S: 0.5,
  /** Lusion's body radius for a unit jack — the arms reach 1.0, the sphere covers the tips */
  BODY_R: 1.05,
  INERTIA: 0.4,
  /** the pull targets' x pitch, 0.6 u: well under a 2.1 u diameter, so bodies overlap their neighbours' targets and pack */
  TARGET_PITCH: 0.6,
  /** spawn box (viewW × 2·viewH × SPAWN_DEPTH) about the origin, vel = SPAWN_VEL·pos — Lusion's 12×12×6 with −2·pos */
  SPAWN_DEPTH: 6,
  SPAWN_VEL: -2,
  /**
   * The keep-out band: inside KEEP_BAND of a KeepOut box (inflated by the body's radius and
   * KEEP_PAD) a body gets an OUTWARD acceleration K_KEEP·s², s = 1 − d/KEEP_BAND, identically
   * zero at d ≥ KEEP_BAND and full strength over the letters. An acceleration, not a force
   * over m, so a 0.86 and a 1.2 jack decelerate alike. The s² ramp integrates to
   * K_KEEP·KEEP_BAND/3 of v²/2 across the band: a CAP 20 flick carries 200, so the panel's 120
   * absorbed 60 and a body went 0.49–0.59 u INTO the inflated box (scales 0.86–1.2) before the
   * pull and the τ 0.62 s damping stopped it; 200 still let the 1.2 jack reach 0.21 u; 240 is
   * the first round step that holds every cast scale under 0.2 u — 0.07–0.10 u at CAP 20,
   * stopped 0.12 s after entering the band (node, straight approach from the band's edge, the
   * pull behind the body). The band is not a wall, and the setup decides the depth: at
   * CAP_CLICK 25 the same approach reaches 0.10–0.14 u; launched from mid-band 0.25 u; with
   * the pull INTO the box (a target behind the letters) 0.24–0.33 u; and a body already
   * parked at the inflated edge when a burst hits it goes 0.59 u in — half a radius over the
   * letters for a tenth of a second. K_KEEP is not raised for that case: 480 would still
   * leave 0.2 u there and would make every ordinary flick read as a wall.
   */
  KEEP_BAND: 1.5,
  K_KEEP: 240,
  KEEP_PAD: 0.15,
} as const;

const AXIS = 1 / Math.sqrt(3); // the swirl axis (1,1,1) normalised

/** The frame delta the world will integrate: [1e-3, 1/30], and 1e-3 for anything that is not a number. */
export function clampDelta(delta: number): number {
  if (!Number.isFinite(delta)) return DYN.DT_MIN;
  return Math.min(DYN.DT_MAX, Math.max(DYN.DT_MIN, delta));
}

/**
 * Twelve bodies in Lusion's spawn box, flying toward the centre, with a random initial
 * orientation each (texture, not data: a six-way jack is symmetric under 90° turns, so
 * twelve identity quaternions would fly in as one aligned set). `bodyR` is the unit body's
 * collision radius — BODY_R for the jack, whose arm tips lie on the 1.05 sphere; the stone
 * field passes its own (stoneGeometry.ts STONE.R).
 */
export function createWorld(scales: readonly number[], view: { viewW: number; viewH: number }, seed: number, bodyR: number = DYN.BODY_R): World {
  const n = scales.length;
  const bodies: Body[] = scales.map((s, i) => {
    const r = bodyR * s;
    const m = (4 / 3) * Math.PI * r * r * r;
    const pos = {
      x: (rand(i, seed + 1) - 0.5) * view.viewW,
      y: (rand(i, seed + 2) - 0.5) * 2 * view.viewH,
      z: (rand(i, seed + 3) - 0.5) * DYN.SPAWN_DEPTH,
    };
    // a uniform random rotation from three draws (Shoemake)
    const u1 = rand(i, seed + 4), u2 = rand(i, seed + 5), u3 = rand(i, seed + 6);
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    return {
      pos,
      vel: { x: DYN.SPAWN_VEL * pos.x, y: DYN.SPAWN_VEL * pos.y, z: DYN.SPAWN_VEL * pos.z },
      quat: { x: a * Math.sin(2 * Math.PI * u2), y: a * Math.cos(2 * Math.PI * u2), z: b * Math.sin(2 * Math.PI * u3), w: b * Math.cos(2 * Math.PI * u3) },
      target: { x: (i - (n - 1) / 2) * DYN.TARGET_PITCH, y: 0, z: 0 },
      r,
      m,
      I: DYN.INERTIA * m * r * r,
      frictionTot: 0,
      swirl: i % 2 ? -1 : 1,
    };
  });
  return {
    bodies,
    seed,
    time: 0,
    boundX: (DYN.BOUND_VIEW * view.viewW) / 2,
    boundY: (DYN.BOUND_VIEW * view.viewH) / 2,
    capUntil: -1,
    clicks: 0,
    still: 0,
    keepOut: [],
    eyeZ: 0,
  };
}

/** The soft bounds follow the canvas; nothing else about a live world does. */
export function setView(world: World, view: { viewW: number; viewH: number }): void {
  world.boundX = (DYN.BOUND_VIEW * view.viewW) / 2;
  world.boundY = (DYN.BOUND_VIEW * view.viewH) / 2;
}

/**
 * The boxes bodies are held off, replaced whole (the hero re-measures its DOM on resize).
 * `eyeZ` > 0 tests each body where a camera on the z axis at that height sees it on z = 0 —
 * a body 3 u nearer a z 32 camera projects 10% further from the centre, and it is the
 * projection that must stay off the letters, not the world x.
 */
export function setKeepOut(world: World, boxes: readonly KeepOut[], eyeZ = 0): void {
  world.keepOut = boxes.map((k) => ({ ...k }));
  world.eyeZ = Number.isFinite(eyeZ) && eyeZ > 0 ? eyeZ : 0;
}

/**
 * One frame. `delta` is the frame's wall delta in seconds (clamped here), `pointer` the
 * cursor ray while it is over the canvas, `E` the idle envelope in [0, 1] that scales the
 * swirl. Semi-implicit Euler per substep — symplectic, stable to ω·h < 2 (0.05 here).
 */
export function stepWorld(world: World, delta: number, pointer: Pointer | null, E: number): StepResult {
  const dt = clampDelta(delta);
  const steps = Math.max(1, Math.ceil(dt / DYN.STEP - 1e-9));
  const h = dt / steps;
  const bodies = world.bodies;
  const n = bodies.length;
  const prev = bodies.map((b) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z }));
  const turned = new Array<number>(n).fill(0);
  const e = Number.isFinite(E) ? Math.min(1, Math.max(0, E)) : 0;
  const damp = Math.pow(DYN.DAMP, h) * Math.pow(DYN.SETTLE, h * (1 - e));
  const grip = 1 - Math.exp(-DYN.REST_FRICTION * h * (1 - e));
  const frictionDecay = Math.pow(0.5, 60 * h);

  for (let s = 0; s < steps; s++) {
    const cap = world.time < world.capUntil ? DYN.CAP_CLICK : DYN.CAP;

    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const p = b.pos, v = b.vel;
      // 1. the pull, softened by contact friction
      const f = ((DYN.K_PULL / b.m) * h) / (1 + b.frictionTot);
      v.x += (b.target.x - p.x) * f;
      v.y += (b.target.y - p.y) * f;
      v.z += (b.target.z - p.z) * f;
      // 2. the swirl about (1,1,1) through the ORIGIN (Lusion's form — about a per-body home
      //    it would vanish at rest), scaled by the idle envelope
      if (e > 0) {
        const len = Math.hypot(p.x, p.y, p.z);
        if (len > 1e-9) {
          const along = Math.abs((p.x + p.y + p.z) * AXIS) / len;
          const ang = h * Math.min(1, len / 2) * DYN.SWIRL * (1 - along) * b.swirl * e;
          const c = Math.cos(ang), sn = Math.sin(ang), k = (p.x + p.y + p.z) * AXIS * (1 - c);
          // Rodrigues: p·cos + (â × p)·sin + â·(â·p)·(1 − cos), minus p
          v.x += p.x * c + (p.z - p.y) * AXIS * sn + AXIS * k - p.x;
          v.y += p.y * c + (p.x - p.z) * AXIS * sn + AXIS * k - p.y;
          v.z += p.z * c + (p.y - p.x) * AXIS * sn + AXIS * k - p.z;
        }
      }
    }

    // 3. contacts: separate fully (0.5·pen each), then Lusion's impulse split by mass over
    //    (1 + T) for a pair closing faster than CLOSING_MIN or separating; a slower closing
    //    pair is a resting contact and shares one normal velocity, or the pull's push would
    //    accumulate as a fictitious steady velocity and rest would never come.
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        let nx = a.pos.x - b.pos.x, ny = a.pos.y - b.pos.y, nz = a.pos.z - b.pos.z;
        let d = Math.hypot(nx, ny, nz);
        const sum = a.r + b.r;
        if (d >= sum) continue;
        if (d < 1e-9) { nx = 1; ny = 0; nz = 0; d = 1; }
        nx /= d; ny /= d; nz /= d;
        const half = 0.5 * (sum - d);
        a.pos.x += nx * half; a.pos.y += ny * half; a.pos.z += nz * half;
        b.pos.x -= nx * half; b.pos.y -= ny * half; b.pos.z -= nz * half;
        const M = a.vel.x * nx + a.vel.y * ny + a.vel.z * nz;
        const S = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
        const rel = M - S; // < 0 closing
        let dA: number, dB: number;
        if (rel < 0 && rel > -DYN.CLOSING_MIN) {
          const vcm = (a.m * M + b.m * S) / (a.m + b.m);
          dA = vcm - M; dB = vcm - S;
        } else {
          const w = DYN.RESTITUTION;
          const EA = (a.m * M + b.m * S - b.m * (M - S) * w) / (a.m + b.m);
          const EB = (a.m * M + b.m * S - a.m * (S - M) * w) / (a.m + b.m);
          dA = (EA - M) / (1 + DYN.T_FRICTION); dB = (EB - S) / (1 + DYN.T_FRICTION);
        }
        a.vel.x += nx * dA; a.vel.y += ny * dA; a.vel.z += nz * dA;
        b.vel.x += nx * dB; b.vel.y += ny * dB; b.vel.z += nz * dB;
        if (grip > 0) {
          // the tangential relative velocity, shared out by mass so momentum is kept
          const rvx = a.vel.x - b.vel.x, rvy = a.vel.y - b.vel.y, rvz = a.vel.z - b.vel.z;
          const rn = rvx * nx + rvy * ny + rvz * nz;
          const tx = (rvx - nx * rn) * grip, ty = (rvy - ny * rn) * grip, tz = (rvz - nz * rn) * grip;
          const fa = b.m / (a.m + b.m), fb = a.m / (a.m + b.m);
          a.vel.x -= tx * fa; a.vel.y -= ty * fa; a.vel.z -= tz * fa;
          b.vel.x += tx * fb; b.vel.y += ty * fb; b.vel.z += tz * fb;
        }
        a.frictionTot += DYN.T_FRICTION;
        b.frictionTot += DYN.T_FRICTION;
      }
    }

    // 4. the pointer: bodies within r + PAD of the ray are shoved perpendicular to it and
    //    handed the cursor's velocity — nothing else touches the cursor, no hover, no lerp
    if (pointer) {
      const o = pointer.origin, r = pointer.dir;
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        const wx = b.pos.x - o.x, wy = b.pos.y - o.y, wz = b.pos.z - o.z;
        const t = wx * r.x + wy * r.y + wz * r.z;
        let px = wx - r.x * t, py = wy - r.y * t, pz = wz - r.z * t;
        const dist = Math.hypot(px, py, pz);
        const pen = b.r + DYN.POINTER_PAD - dist;
        if (pen <= 0) continue;
        if (dist < 1e-6) {
          // dead centre: any perpendicular will do, pick the one across the ray's up
          px = r.y; py = -r.x; pz = 0;
          const l = Math.hypot(px, py, pz) || 1;
          px /= l; py /= l; pz /= l;
        } else {
          px /= dist; py /= dist; pz /= dist;
        }
        const shove = DYN.POINTER_SHOVE * pen * h;
        b.pos.x += px * shove; b.pos.y += py * shove; b.pos.z += pz * shove;
        const kick = DYN.POINTER_KICK * pen * h, drag = DYN.POINTER_DRAG * h;
        b.vel.x += px * kick + pointer.vel.x * drag;
        b.vel.y += py * kick + pointer.vel.y * drag;
        b.vel.z += pz * kick + pointer.vel.z * drag;
      }
    }

    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const p = b.pos, v = b.vel;
      // 5. damping, the cap, the soft bounds, then the position
      v.x *= damp; v.y *= damp; v.z *= damp;
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > cap) { const k = cap / speed; v.x *= k; v.y *= k; v.z *= k; }
      if (Math.abs(p.z) > DYN.Z_BOUND) v.z -= (p.z - DYN.Z_BOUND * Math.sign(p.z)) * DYN.K_BOUND * h;
      if (Math.abs(p.x) > world.boundX) v.x -= (p.x - world.boundX * Math.sign(p.x)) * DYN.K_BOUND * h;
      if (Math.abs(p.y) > world.boundY) v.y -= (p.y - world.boundY * Math.sign(p.y)) * DYN.K_BOUND * h;
      // the keep-out band (DYN.KEEP_BAND): the rounded-box distance from the body's disc to each
      // box, and an outward push along the nearest face (the corner's diagonal outside a corner)
      for (let k = 0; k < world.keepOut.length; k++) {
        const box = world.keepOut[k];
        const proj = world.eyeZ > 0 ? world.eyeZ / (world.eyeZ - p.z) : 1;
        const qx = p.x * proj - box.cx, qy = p.y * proj - box.cy;
        const ex = Math.abs(qx) - box.hw, ey = Math.abs(qy) - box.hh;
        const outside = Math.hypot(Math.max(ex, 0), Math.max(ey, 0));
        const d = outside + Math.min(Math.max(ex, ey), 0) - (b.r + DYN.KEEP_PAD);
        if (d >= DYN.KEEP_BAND) continue;
        const t = 1 - Math.max(d, 0) / DYN.KEEP_BAND;
        const a = DYN.K_KEEP * (box.strength ?? 1) * t * t * h;
        if (ex > 0 && ey > 0) { v.x += (ex / outside) * Math.sign(qx) * a; v.y += (ey / outside) * Math.sign(qy) * a; }
        else if (ex > ey) v.x += (Math.sign(qx) || 1) * a;
        else v.y += (Math.sign(qy) || 1) * a;
      }
      p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
      // 6. the tumble: bodies roll with their travel about the target, never spin in place
      const rx = p.x - b.target.x, ry = p.y - b.target.y, rz = p.z - b.target.z;
      let wx = (ry * v.z - rz * v.y) / b.I, wy = (rz * v.x - rx * v.z) / b.I, wz = (rx * v.y - ry * v.x) / b.I;
      const wl = Math.hypot(wx, wy, wz);
      if (wl > 1e-12) {
        const ang = wl * h;
        turned[i] += ang;
        wx /= wl; wy /= wl; wz /= wl;
        const sh = Math.sin(ang / 2), ch = Math.cos(ang / 2);
        // q ← (axis, ang) ⊗ q
        const qx = wx * sh, qy = wy * sh, qz = wz * sh, qw = ch;
        const q = b.quat;
        const x = qw * q.x + qx * q.w + qy * q.z - qz * q.y;
        const y = qw * q.y - qx * q.z + qy * q.w + qz * q.x;
        const z = qw * q.z + qx * q.y - qy * q.x + qz * q.w;
        const w = qw * q.w - qx * q.x - qy * q.y - qz * q.z;
        const l = Math.hypot(x, y, z, w) || 1;
        q.x = x / l; q.y = y / l; q.z = z / l; q.w = w / l;
      }
      b.frictionTot *= frictionDecay;
    }
    world.time += h;
  }

  let maxDpos = 0, maxDang = 0;
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    maxDpos = Math.max(maxDpos, Math.hypot(b.pos.x - prev[i].x, b.pos.y - prev[i].y, b.pos.z - prev[i].z));
    maxDang = Math.max(maxDang, turned[i]);
  }
  return { steps, dt, maxDpos, maxDang };
}

/**
 * The rest test, accumulated across frames: true once REST_S seconds of consecutive frames
 * with E = 0 moved nothing faster than REST_V and turned nothing faster than REST_W. The
 * caller then freezes the loop; any pointer or visibility event re-arms E and the clock
 * restarts.
 */
export function isResting(world: World, r: StepResult, E: number): boolean {
  world.still = E <= 0 && r.maxDpos / r.dt < DYN.REST_V && r.maxDang / r.dt < DYN.REST_W ? world.still + r.dt : 0;
  return world.still >= DYN.REST_S - 1e-9;
}

/**
 * Lusion's click, exactly: every velocity flips and takes a centre pull plus a random kick
 * over its mass — ±8 u/s per axis for a unit jack — and the cap lifts for CAP_CLICK_S so the
 * burst keeps its variance. Deterministic per click count, like everything else here.
 */
export function clickWorld(world: World): void {
  const k = world.clicks++;
  world.bodies.forEach((b, i) => {
    const im = 1 / b.m;
    const rx = (rand(i + 100 * k, world.seed + 7) - 0.5) * DYN.CLICK_KICK;
    const ry = (rand(i + 100 * k, world.seed + 8) - 0.5) * DYN.CLICK_KICK;
    const rz = (rand(i + 100 * k, world.seed + 9) - 0.5) * DYN.CLICK_KICK;
    b.vel.x = -b.vel.x + (-(b.pos.x - b.target.x) * DYN.CLICK_PULL + rx) * im;
    b.vel.y = -b.vel.y + (-(b.pos.y - b.target.y) * DYN.CLICK_PULL + ry) * im;
    b.vel.z = -b.vel.z + (-(b.pos.z - b.target.z) * DYN.CLICK_PULL + rz) * im;
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    if (speed > DYN.CAP_CLICK) { const c = DYN.CAP_CLICK / speed; b.vel.x *= c; b.vel.y *= c; b.vel.z *= c; }
  });
  world.capUntil = world.time + DYN.CAP_CLICK_S;
  world.still = 0;
}
