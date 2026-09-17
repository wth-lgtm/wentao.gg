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
   * Brush radius = fit(speed, 0..SPEED_FULL px per 60 Hz frame → 0..RADIUS_FULL px), then scaled
   * by canvasH into field texels (Lusion: radiusDistanceRange 100, minRadius 0, maxRadius 100,
   * ÷ viewportHeight × texture height). A slow move is a hairline, a flick a 100 px brush.
   */
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
  /** advection: sample the previous field at uv + (0.5 − blurred.xy) × PUSH texels per 60 Hz frame (Lusion pushStrength) */
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
   * Composite: TAPS samples from a jittered start, stepping vel × AMOUNT/4 × MULT × one FIELD
   * texel (Lusion: amount 20, multiplier 1.25, u_screenPaintTexelSize — the paint texture's
   * texel, 4 CSS px, not the screen's; that is why a saturated stroke smears 25 px a tap, 200 px
   * over the nine, and why the smear is the same in CSS px at every DPR).
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
  /** the 1/8 copy's blur: nine taps at ±k × BLUR_RADIUS / width × 0.25 (Lusion blur.blur(8, 1, …)) */
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

/**
 * The brush speed in px per 60 Hz frame: the faster of the pointer rig's own reading (px per
 * move event — exact for a rAF-aligned pointer at 60 Hz) and the frame's travel normalised to
 * 60 Hz (right on a 120 Hz display or a 30 fps GPU, where events and frames disagree). A burst
 * of events inside one frame reads as its own speed, not the frame's average.
 */
export function brushSpeed(eventSpeedPx: number, travelPx: number, dt: number): number {
  return Math.max(eventSpeedPx, travelPx / Math.max(1e-6, 60 * dt));
}

/** Brush radius in field texels for a speed in px per 60 Hz frame; 0 below half a texel. */
export function brushRadiusTex(speedPx: number, canvasH: number, fieldH: number): number {
  if (canvasH <= 0) return 0;
  const px = fit(speedPx, 0, WAKE.SPEED_FULL, 0, WAKE.RADIUS_FULL);
  const tex = (px / canvasH) * fieldH;
  return tex < WAKE.RADIUS_MIN_TEX ? 0 : tex;
}

/** A per-60 Hz-frame rate applied over dt seconds. */
export function perFrame(rate: number, dt: number): number {
  return Math.pow(rate, 60 * dt);
}

/**
 * One frame of the long weight's dissipation, exactly as the paint shader does it: lose the
 * larger of the exponential share and the floor, clamp at zero. Monotone in w, so a value that
 * bounds every texel keeps bounding them (advection is a convex combination, paint saturates at
 * 1) — the CPU can know the field is empty without reading it back.
 */
export function stepWeight(w: number, dt: number): number {
  if (w <= 0) return 0;
  const lose = Math.max((1 - perFrame(WAKE.DECAY_LONG, dt)) * w, WAKE.FLOOR * 60 * dt);
  return Math.max(0, w - lose);
}

/** The bound after a frame: a painting frame is a full weight (the brush lands after the dissipation), any other frame decays. */
export function paintOrDecay(w: number, radiusTex: number, dt: number): number {
  return radiusTex > 0 ? 1 : stepWeight(w, dt);
}

/** The demand loop's new wake reason: the field is being painted or is still decaying. */
export function awake(weight: number, radiusTex: number): boolean {
  return weight > 0 || radiusTex > 0;
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
 * in CSS px. Returns the smear step per tap in CSS px and the fringe amplitude (before the sine).
 */
export function compositeAt(data: readonly [number, number, number, number], texelPx: number): { weight: number; vel: [number, number]; stepPx: number; fringe: number } {
  const weight = (data[2] + data[3]) * 0.5;
  const vel: [number, number] = [(0.5 - data[0]) * 2 * weight, (0.5 - data[1]) * 2 * weight];
  const stepPx = Math.hypot(vel[0], vel[1]) * (WAKE.AMOUNT / 4) * WAKE.MULT * texelPx;
  // Lusion writes smoothstep(0.4, −0.9, w) — undefined by the spec for edge0 > edge1; this is the same curve spelled legally
  const t = Math.min(1, Math.max(0, (WAKE.FRINGE_HI - weight) / (WAKE.FRINGE_HI - WAKE.FRINGE_LO)));
  const fringe = (3 * t * t - 2 * t * t * t) * WAKE.SHADE * Math.max(Math.abs(vel[0]), Math.abs(vel[1]));
  return { weight, vel, stepPx, fringe };
}
