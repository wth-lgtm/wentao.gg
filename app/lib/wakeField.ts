// The pointer's wake — the pure half. Lusion's ScreenPaint is a quarter-resolution velocity/
// weight field painted from the previous to the current pointer position each frame, advected
// along its own blurred velocity, and read by a post pass that smears the finished frame along
// the flow and adds thin-film fringes (lusion.co's hero; constants quoted from its bundle,
// bundle-extract-1.txt / frag$1 in the research). Everything below is what the GPU side
// (WakeRibbon.tsx) needs decided in numbers: the brush, the rates, and the one thing the
// house rule adds — a CPU-side bound on the field's weight so the demand loop knows when the
// ribbon has died and can stop asking for frames. Pure so all of it runs in node.
//
// Lusion's rates are per FRAME (0.985 a frame at whatever rate the display runs); here every
// rate is per 60 Hz frame raised to 60·dt, so the ribbon lives the same sim time at 30, 60 and
// 120 Hz — and under software GL, where the harness reads sim time.

export const WAKE = {
  /** the field is the canvas at 1/FIELD_DIV of its CSS size (Lusion: width >> 2) — DPR is not an input */
  FIELD_DIV: 4,
  /** the blurred copy the advection reads, 1/LOW_DIV (Lusion: width >> 3) */
  LOW_DIV: 8,
  /**
   * Lusion's lengths — brush radius, push, smear step, blur radius — are texel counts of a field
   * that was 225 texels tall (a 1440×900 viewport ≫ 2). This column's field is 68 texels tall,
   * and the same counts on it are a different picture: a 100 px brush paints 73% of a 273 px
   * column in one stroke (measured — the flick frame is a full-column smear, not a ribbon) and
   * the advection crosses the field in three frames. Every length below scales by
   * fieldH / (REF_H / FIELD_DIV). At 900 that reproduces the reference's own proportion (the
   * brush 11% of the height, a 30 px brush here); 600 was ruled after review — the brush 17%
   * of the column (45 px), wider fringe bands, closer to the thin-film read at this height.
   */
  REF_H: 600,
  /**
   * Brush radius = fit(speed, SPEED_MIN..SPEED_FULL px per 60 Hz frame → 0..RADIUS_FULL px) as
   * a fraction of REF_H, in field texels (Lusion: radiusDistanceRange 100, minRadius 0,
   * maxRadius 100, ÷ viewportHeight × texture height, from 0). The reference's mapping starts
   * at 0 on a 900 px viewport, where a 25 px band still reads as a thin ribbon; at this scale
   * the same mapping collapsed for ordinary cursor crossings — a 1500 px/s move painted a 1 px
   * seam the width of the card carrying a flick's velocity (brisk-1500pxs.png, 0.78% of pixels
   * along one line). So the brush ramps from SPEED_MIN (20 px/frame, 1200 px/s): below it
   * nothing, above it width AND the velocity it carries (brushStrength) rise together to the
   * full brush at SPEED_FULL, so a ribbon fades in with the hand instead of popping.
   */
  SPEED_MIN: 20,
  SPEED_FULL: 100,
  RADIUS_FULL: 100,
  /** a brush thinner than this many field texels cannot be drawn at the field's resolution and paints nothing */
  RADIUS_MIN_TEX: 0.5,
  /**
   * Injected velocity per frame: (to − from) in texels × (1/60) × INJECT. Lusion multiplies by
   * that frame's dt; at 60 Hz that IS 1/60, and the fixed figure is what makes a stroke deposit
   * the same velocity at 30 Hz (twice the travel a frame, half the frames).
   */
  INJECT: 0.8,
  /** the injected velocity accumulates with this decay per 60 Hz frame (Lusion accelerationDissipation) */
  ACCEL_DECAY: 0.8,
  /** advection: sample the previous field at uv + (0.5 − blurred.xy) × PUSH × scale texels per 60 Hz frame (Lusion pushStrength) */
  PUSH: 25,
  /** dissipation per 60 Hz frame: velocity, long weight (the ribbon's life), short weight (the fresh-stroke mask) */
  DECAY_V: 0.985,
  DECAY_LONG: 0.985,
  DECAY_SHORT: 0.5,
  /**
   * The weights lose at least FLOOR per 60 Hz frame, so an exponential tail becomes a linear
   * one and the field reaches exactly zero — which is what the awake test needs. Lusion's 0.004
   * is its 8-bit texel step (1/255: without it 0.985·w rounds back to w). In a half-float
   * field the floor is free to be the design's lifetime: at 0.004 the long weight reaches zero
   * at 2.57 s and the smear is still 6 px at 1.5 s; at 0.01 the exponential hands over to the
   * line at w 0.667 (0.45 s) and the weight is gone at 1.56 s, the brief's "~1–1.5 s".
   */
  FLOOR: 0.01,
  /**
   * Composite: TAPS samples from a jittered start, stepping vel × AMOUNT/4 × MULT × scale × one
   * FIELD texel (Lusion: amount 20, multiplier 1.25, u_screenPaintTexelSize — the paint
   * texture's texel, 4 CSS px, not the screen's; a saturated stroke smears 25 px a tap on the
   * reference, 7.6 px here, and the same in CSS px at every DPR). In LINEAR light: the fringe
   * term is bounded by edge(w)·SHADE·w ≤ 0.018, invisible added to display values, while the
   * reference's frames swing 20–40 levels across a fringe (lusion-raf-flick-03.png, sampled) —
   * its renderer is NoToneMapping with linear targets, so 0.018 lands before the sRGB encode,
   * where on the #141518 panel it is +23 levels.
   */
  TAPS: 9,
  AMOUNT: 20,
  MULT: 1.25,
  /** fringe: sin((vx + vy) × FRINGE_FREQ + (0, 2, 4) × RGB_SHIFT) × smoothstep × SHADE × max(|vx|, |vy|) */
  FRINGE_FREQ: 40,
  RGB_SHIFT: 1,
  SHADE: 1.25,
  /** the fringe's reversed smoothstep: 0 at weight ≥ FRINGE_HI (the fresh core), rising toward FRINGE_LO */
  FRINGE_HI: 0.4,
  FRINGE_LO: -0.9,
  /** the 1/8 copy's blur: nine taps at ±k × BLUR_RADIUS × scale / width × 0.25 (Lusion blur.blur(8, 1, …)) */
  BLUR_RADIUS: 8,
} as const;

export interface FieldSize {
  w: number;
  h: number;
  lowW: number;
  lowH: number;
}

/** The field's and its blurred copy's texel counts for a canvas of this CSS size; never 0×0. */
export function fieldSize(cssW: number, cssH: number): FieldSize {
  const at = (v: number, div: number) => Math.max(1, Math.floor(Math.max(0, v) / div));
  return { w: at(cssW, WAKE.FIELD_DIV), h: at(cssH, WAKE.FIELD_DIV), lowW: at(cssW, WAKE.LOW_DIV), lowH: at(cssH, WAKE.LOW_DIV) };
}

/** Lusion's math.fit: a clamped linear map. */
export function fit(x: number, a: number, b: number, c: number, d: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return c + (d - c) * t;
}

/** How the reference's texel lengths scale onto a field this tall (REF_H 900 would make it 1 on Lusion's own 225-texel field; at 600 it is 1.5 there). */
export function fieldScale(fieldH: number): number {
  return fieldH / (WAKE.REF_H / WAKE.FIELD_DIV);
}

/**
 * The brush speed in px per 60 Hz frame, from the frame's own travel: a 120 Hz display reads
 * like a 60 Hz one and events coalesced into one frame sum instead of the last one counting.
 * dt is floored at 1/240 s — no display is faster, and a delta below it is a scheduler
 * accident, not a frame. Under swiftshader dt clamps at 1/30 (the world's clock), so a frame's
 * travel reads as half its wall speed; the harness paces its pointer in sim time for that.
 */
export function brushSpeed(travelPx: number, dt: number): number {
  return travelPx / (60 * Math.max(dt, 1 / 240));
}

/** Brush radius in field texels for a speed in px per 60 Hz frame; 0 below SPEED_MIN and below half a texel. */
export function brushRadiusTex(speedPx: number, fieldH: number): number {
  const px = fit(speedPx, WAKE.SPEED_MIN, WAKE.SPEED_FULL, 0, WAKE.RADIUS_FULL);
  const tex = (px / WAKE.REF_H) * fieldH;
  return tex < WAKE.RADIUS_MIN_TEX ? 0 : tex;
}

/** How much of the stroke's velocity a brush of this speed injects: 0 at SPEED_MIN, 1 at SPEED_FULL. */
export function brushStrength(speedPx: number): number {
  return fit(speedPx, WAKE.SPEED_MIN, WAKE.SPEED_FULL, 0, 1);
}

/**
 * Whether a capsule from (fromX, fromY) to (toX, toY) of radius rPx — all in canvas CSS px —
 * can reach the canvas at all. The pointer is the card's, and the board is two thirds of it:
 * a flick that never comes within a brush of the column paints no texel and must not arm the
 * ribbon's frames.
 */
export function capsuleTouches(fromX: number, fromY: number, toX: number, toY: number, rPx: number, cssW: number, cssH: number): boolean {
  return Math.max(fromX, toX) + rPx >= 0 && Math.min(fromX, toX) - rPx <= cssW && Math.max(fromY, toY) + rPx >= 0 && Math.min(fromY, toY) - rPx <= cssH;
}

/** A per-60 Hz-frame rate applied over dt seconds. */
export function perFrame(rate: number, dt: number): number {
  return Math.pow(rate, 60 * dt);
}

/**
 * One frame of the long weight's dissipation, exactly as the paint shader does it: lose the
 * larger of the exponential share and the floor, clamp at zero. Monotone in w, so a value that
 * bounds every texel keeps bounding them (advection is a convex combination, paint saturates at
 * 1, and a painting frame — the stroke's stop frame included, see strokeBound — resets the
 * bound to 1) — the CPU can know the field is empty without reading it back.
 */
export function stepWeight(w: number, dt: number): number {
  if (w <= 0) return 0;
  const lose = Math.max((1 - perFrame(WAKE.DECAY_LONG, dt)) * w, WAKE.FLOOR * 60 * dt);
  return Math.max(0, w - lose);
}

/**
 * The bound after a frame: a painting frame is a full weight (the brush lands after the
 * dissipation and saturates), any other frame decays. "Painting" is the caller's: this frame's
 * capsule OR the previous frame's radius — Lusion's `from` carries the previous radius, so the
 * frame after a stroke stops repaints a full disc where it stopped, and the bound must know.
 */
export function strokeBound(w: number, painting: boolean, dt: number): number {
  return painting ? 1 : stepWeight(w, dt);
}

/** The demand loop's new wake reason: the field is being painted or is still decaying. */
export function awake(weight: number, painting: boolean): boolean {
  return weight > 0 || painting;
}

/** Sim seconds a fresh stroke's long weight takes to reach exactly zero at this frame delta. */
export function lifetimeS(dt: number): number {
  let w = 1, t = 0;
  while (w > 0 && t < 60) { w = stepWeight(w, dt); t += dt; }
  return t;
}

/**
 * The composite's per-texel arithmetic, mirrored for the tests and the report: data is the
 * field texel (xy velocity about 0.5, z long weight, w short weight), texelPx one field texel
 * in CSS px, scale the field's fieldScale. Returns the smear step per tap in CSS px and the
 * fringe amplitude in linear light (before the sine).
 */
export function compositeAt(data: readonly [number, number, number, number], texelPx: number, scale = 1): { weight: number; vel: [number, number]; stepPx: number; fringe: number } {
  const weight = (data[2] + data[3]) * 0.5;
  const vel: [number, number] = [(0.5 - data[0]) * 2 * weight, (0.5 - data[1]) * 2 * weight];
  const stepPx = Math.hypot(vel[0], vel[1]) * (WAKE.AMOUNT / 4) * WAKE.MULT * texelPx * scale;
  // Lusion writes smoothstep(0.4, −0.9, w) — undefined by the spec for edge0 > edge1; this is the same curve spelled legally
  const t = Math.min(1, Math.max(0, (WAKE.FRINGE_HI - weight) / (WAKE.FRINGE_HI - WAKE.FRINGE_LO)));
  const fringe = (3 * t * t - 2 * t * t * t) * WAKE.SHADE * Math.max(Math.abs(vel[0]), Math.abs(vel[1]));
  return { weight, vel, stepPx, fringe };
}
