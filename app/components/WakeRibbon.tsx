"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clampDelta } from "../lib/jackDynamics";
import type { PointerRig } from "../lib/pointerRig";
import { WAKE, awake, brushFor, capsuleTouches, fieldScale, fieldSize, perFrame, strokeBound, type FieldSize } from "../lib/wakeField";

// The pointer's wake ribbon — Lusion's "fluid" (lusion.co's hero: ScreenPaint + the
// ScreenPaintDistortion post pass, quoted from its bundle). A fast flick leaves a screen-space
// ribbon that keeps travelling after the pointer stops, breaks into filaments and shows thin-
// film fringes at its aged edges; a slow move leaves nothing you can see. Two parts:
//
// FIELD — a quarter-resolution RGBA half-float ping-pong (xy velocity about 0.5, z the long
// weight, w the short "fresh stroke" weight) plus a 1/8-res blurred copy. Each frame paints a
// soft capsule from the previous to the current pointer position, radius and strength from the
// frame's own travel per 60 Hz frame (a brush from 20 px/frame up; wakeField.ts), injects the
// stroke's velocity, advects the field along the blurred copy's velocity (a one-tap semi-
// Lagrangian step) and dissipates. Rates are per 60 Hz frame raised to 60·dt, so the ribbon
// lives ~1.5 s of sim time at any frame rate.
//
// COMPOSITE — over the FINISHED frame. This component owns the render (useFrame priority 1
// stops R3F's own): the scene is drawn to the canvas exactly as before, the drawing buffer is
// copied into a texture (one GPU blit; the MSAA resolve rides along), and a full-screen quad
// writes it back smeared along the field's velocity (nine taps from a noise-jittered start)
// with Lusion's sine fringes. The taps are decoded to linear light and re-encoded on the way
// out — Lusion's renderer is NoToneMapping over linear targets, and its fringe term (≤ 0.018)
// is only visible added before the sRGB encode (wakeField.ts). Wherever the field is empty
// the pass is a byte-exact no-op: the same 8-bit texel is read and written, no decode. When
// the whole field is empty the copy and the quad are skipped altogether, so a still pointer
// costs nothing and the resting frame is PR A's, pixel for pixel.
//
// Lengths are the reference's texel counts scaled by fieldScale (wakeField.ts): on this 273 px
// column a 100 px brush painted 73% of the height in one stroke and read as a full-column
// smear, not a ribbon (flick-0s.png in the report's first run).
//
// House rule: a resting scene costs nothing. The field is the one new reason for the demand
// loop to stay awake, and it knows its own life without a readback — a CPU bound on the long
// weight is 1 on every frame the shader paints (the stroke's stop frame included: Lusion's
// `from` carries the previous radius, so that frame repaints a full disc) and otherwise steps
// with the shader's own formula (monotone, so it stays a bound); it reaches exactly zero ~1.5 s
// after the last paint and the field is reset for the next stroke. A capsule that cannot reach
// the canvas — the pointer is the card's, and the board is two thirds of it — paints nothing
// and arms nothing.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Lusion's frag$n without the (unused on its hero) curl noise. gl_FragCoord is in field texels,
// as are uFrom/uTo (xy position, z radius, w weight); the segment distance is Lusion's sdSegment
// with the zero-length guard (from == to on a still frame divided by zero). The floor turns
// the weights' exponential tail into a linear one so they reach exactly zero.
const PAINT_FRAG = /* glsl */ `
uniform sampler2D tPrev;
uniform sampler2D tLow;
uniform vec2 uTexel;
uniform vec4 uFrom;
uniform vec4 uTo;
uniform float uPush;
uniform vec2 uVel;
uniform vec3 uDecay;
uniform float uFloor;
varying vec2 vUv;
vec2 sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}
void main() {
  vec2 res = sdSegment(gl_FragCoord.xy, uFrom.xy, uTo.xy);
  vec2 radiusWeight = mix(uFrom.zw, uTo.zw, res.y);
  float d = 1.0 - smoothstep(-0.01, radiusWeight.x, res.x);
  vec4 low = texture2D(tLow, vUv);
  vec2 velInv = (0.5 - low.xy) * uPush;
  vec4 data = texture2D(tPrev, vUv + velInv * uTexel);
  data.xy -= 0.5;
  vec4 delta = (uDecay.xxyz - 1.0) * data;
  delta.xy += uVel * d;
  delta.zw += radiusWeight.yy * d;
  delta.zw = sign(delta.zw) * max(vec2(uFloor), abs(delta.zw));
  data += delta;
  data.xy += 0.5;
  gl_FragColor = clamp(data, 0.0, 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

// Lusion's blur9: nine taps at ±k·uDelta, weights summing to 1.0000.
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDelta;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv) * 0.1633;
  vec2 d = uDelta;
  c += (texture2D(tSrc, vUv - d) + texture2D(tSrc, vUv + d)) * 0.1531; d += uDelta;
  c += (texture2D(tSrc, vUv - d) + texture2D(tSrc, vUv + d)) * 0.12245; d += uDelta;
  c += (texture2D(tSrc, vUv - d) + texture2D(tSrc, vUv + d)) * 0.0918; d += uDelta;
  c += (texture2D(tSrc, vUv - d) + texture2D(tSrc, vUv + d)) * 0.051;
  gl_FragColor = c;
}
`;

// the field's rest state: no velocity, no weight
const RESET_FRAG = /* glsl */ `
void main() { gl_FragColor = vec4(0.5, 0.5, 0.0, 0.0); }
`;

const f = (n: number) => n.toFixed(4);
// Lusion's frag$1. weight is the MEAN of the long and short weights; the smear step is in
// FIELD texels (4 CSS px) × uScale, which is why it is the same size at every DPR; the
// fringe's smoothstep(0.4, −0.9, w) is spelled as the legal reversed form of the same curve.
// The taps are sRGB bytes (three's own EOTF/OETF, in every fragment prefix) decoded to linear,
// averaged, fringed, clamped and re-encoded. The one omission is Lusion's −0.001 velocity bias,
// an 8-bit texel's correction for a 0.5 that the byte format cannot store; the half-float field
// stores it exactly, and with the bias a still field would not be a pass-through. The zero-
// weight branch is what makes the pass-through byte-exact: a raw copy, no decode, no average.
// The jitter is a per-pixel hash with a per-frame offset, standing in for Lusion's 128²
// blue-noise texture — it hides the nine-tap banding the same way and costs no asset.
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tFrame;
uniform sampler2D tField;
uniform vec2 uFieldTexel;
uniform float uScale;
uniform vec2 uSeed;
varying vec2 vUv;
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
void main() {
  vec4 data = texture2D(tField, vUv);
  float weight = (data.z + data.w) * 0.5;
  if (weight <= 0.0) { gl_FragColor = texture2D(tFrame, vUv); return; }
  vec2 vel = (0.5 - data.xy) * 2.0 * weight;
  vec2 stp = vel * (${f(WAKE.AMOUNT)} / 4.0) * uFieldTexel * ${f(WAKE.MULT)} * uScale;
  vec2 uv = vUv + hash22(floor(gl_FragCoord.xy) + uSeed) * stp;
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${WAKE.TAPS}; i++) { c += sRGBTransferEOTF(texture2D(tFrame, uv)).rgb; uv += stp; }
  c /= ${f(WAKE.TAPS)};
  float t = clamp((${f(WAKE.FRINGE_HI)} - weight) / ${f(WAKE.FRINGE_HI - WAKE.FRINGE_LO)}, 0.0, 1.0);
  float edge = t * t * (3.0 - 2.0 * t);
  c += sin(vec3(vel.x + vel.y) * ${f(WAKE.FRINGE_FREQ)} + vec3(0.0, 2.0, 4.0) * ${f(WAKE.RGB_SHIFT)}) * edge * ${f(WAKE.SHADE)} * max(abs(vel.x), abs(vel.y));
  gl_FragColor = sRGBTransferOETF(vec4(clamp(c, 0.0, 1.0), 1.0));
}
`;

function material(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
}

function fieldTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

interface Field {
  size: FieldSize;
  cssW: number;
  cssH: number;
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;
  low: THREE.WebGLRenderTarget;
  lowTmp: THREE.WebGLRenderTarget;
}

interface Debug {
  /** the CPU bound on the field's long weight, 0 when the field is empty */
  weight: number;
  alive: boolean;
  /** composited frames so far */
  frames: number;
  /** the last frame's brush: its speed in px per 60 Hz frame (from the frame's travel) and the radius in field texels */
  speed: number;
  radius: number;
  /** the last frame's clamped delta, the field's clock, and its raw delta, the brush's */
  dt: number;
  raw: number;
  /** run the copy + composite even over an empty field (the pass-through hash test) */
  force: boolean;
  /** the next composited (or forced) frame's canvas before and after the pass, as data URLs */
  capture(): Promise<{ plain: string; post: string; simDt: number }>;
}

interface Props {
  /** the card's shared pointer — the brush follows it over the whole card, not just the canvas */
  rig: PointerRig;
  /** the frameloop is "demand" (the card is inside its margin); a false → true is a resume, and the brush re-seeds */
  visible: boolean;
  /** ?jacksDebug=1 — installs window.__wake beside window.__jacks */
  debug: boolean;
}

/**
 * The field's targets are half-float, which WebGL2 renders to only with EXT_color_buffer_float
 * (or the older _half_float). Without it the framebuffers would be incomplete and every field
 * pass an error: the scene is drawn without a ribbon instead, and R3F keeps its own render.
 */
export default function WakeRibbon(props: Props) {
  const gl = useThree((s) => s.gl);
  const ok = useMemo(() => gl.extensions.has("EXT_color_buffer_float") || gl.extensions.has("EXT_color_buffer_half_float"), [gl]);
  return ok ? <Ribbon {...props} /> : null;
}

function Ribbon({ rig, visible, debug }: Props) {
  const { gl, scene, camera, size, invalidate } = useThree();

  const quad = useRef<{ scene: THREE.Scene; camera: THREE.OrthographicCamera; mesh: THREE.Mesh; paint: THREE.ShaderMaterial; copy: THREE.ShaderMaterial; blur: THREE.ShaderMaterial; reset: THREE.ShaderMaterial; composite: THREE.ShaderMaterial } | null>(null);
  const field = useRef<Field | null>(null);
  const frameTex = useRef<THREE.FramebufferTexture | null>(null);
  // the brush: where the pointer was last frame (client px, and canvas CSS px), its radius then, and the stroke's velocity
  const prev = useRef({ cx: 0, cy: 0, x: 0, y: 0, valid: false, radius: 0 });
  // Mirrors Field's firstFrame: the frameloop just went never → demand, so the pointer may have
  // moved a lot since the last rendered frame while this frame's delta says otherwise.
  const resumed = useRef(true);
  useEffect(() => {
    if (visible) resumed.current = true;
  }, [visible]);
  const uVel = useRef(new THREE.Vector2());
  const weight = useRef(0);
  const dbg = useRef({ frames: 0, speed: 0, radius: 0, dt: 0, raw: 0, force: false, pending: null as null | ((r: { plain: string; post: string; simDt: number }) => void) });
  const drawSize = useRef(new THREE.Vector2());

  const quadFor = () => {
    if (quad.current) return quad.current;
    const s = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const paint = material(PAINT_FRAG, {
      tPrev: { value: null }, tLow: { value: null }, uTexel: { value: new THREE.Vector2() },
      uFrom: { value: new THREE.Vector4() }, uTo: { value: new THREE.Vector4() },
      uPush: { value: 0 }, uVel: { value: new THREE.Vector2() }, uDecay: { value: new THREE.Vector3() }, uFloor: { value: 0 },
    });
    const copy = material(COPY_FRAG, { tSrc: { value: null } });
    const blur = material(BLUR_FRAG, { tSrc: { value: null }, uDelta: { value: new THREE.Vector2() } });
    const reset = material(RESET_FRAG, {});
    const composite = material(COMPOSITE_FRAG, { tFrame: { value: null }, tField: { value: null }, uFieldTexel: { value: new THREE.Vector2() }, uScale: { value: 1 }, uSeed: { value: new THREE.Vector2() } });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copy);
    mesh.frustumCulled = false;
    s.add(mesh);
    quad.current = { scene: s, camera: cam, mesh, paint, copy, blur, reset, composite };
    return quad.current;
  };

  /** one full-screen pass of `mat` into `target` (null = the canvas), never clearing */
  const pass = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    const q = quadFor();
    q.mesh.material = mat;
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.setRenderTarget(target);
    gl.render(q.scene, q.camera);
    gl.autoClear = autoClear;
  };

  const resetField = (fd: Field) => {
    const q = quadFor();
    for (const t of [fd.a, fd.b, fd.low, fd.lowTmp]) pass(q.reset, t);
    gl.setRenderTarget(null);
    uVel.current.set(0, 0);
    weight.current = 0;
  };

  /** the field for the canvas's CSS size — rebuilt (and reset) when the column resizes */
  const fieldFor = (): Field => {
    const cur = field.current;
    if (cur && cur.cssW === size.width && cur.cssH === size.height) return cur;
    cur?.a.dispose(); cur?.b.dispose(); cur?.low.dispose(); cur?.lowTmp.dispose();
    const fs = fieldSize(size.width, size.height);
    const fd: Field = { size: fs, cssW: size.width, cssH: size.height, a: fieldTarget(fs.w, fs.h), b: fieldTarget(fs.w, fs.h), low: fieldTarget(fs.lowW, fs.lowH), lowTmp: fieldTarget(fs.lowW, fs.lowH) };
    field.current = fd;
    resetField(fd);
    return fd;
  };

  /** a texture the size of the drawing buffer to copy the finished frame into */
  const frameFor = (): THREE.FramebufferTexture => {
    const d = gl.getDrawingBufferSize(drawSize.current);
    const cur = frameTex.current;
    if (cur && cur.image.width === d.x && cur.image.height === d.y) return cur;
    cur?.dispose();
    const t = new THREE.FramebufferTexture(d.x, d.y);
    // linear for the sub-texel taps; at a texel centre bilinear IS the texel, which the pass-through relies on
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    frameTex.current = t;
    return t;
  };

  useEffect(() => () => {
    const q = quad.current;
    if (q) { q.mesh.geometry.dispose(); for (const m of [q.paint, q.copy, q.blur, q.reset, q.composite]) m.dispose(); }
    const fd = field.current;
    if (fd) { fd.a.dispose(); fd.b.dispose(); fd.low.dispose(); fd.lowTmp.dispose(); }
    frameTex.current?.dispose();
    quad.current = null; field.current = null; frameTex.current = null;
  }, []);

  useEffect(() => {
    if (!debug) return;
    const w = window as unknown as { __wake?: Debug };
    const d = dbg.current;
    w.__wake = {
      get weight() { return weight.current; },
      get alive() { return weight.current > 0; },
      get frames() { return d.frames; },
      get speed() { return d.speed; },
      get radius() { return d.radius; },
      get dt() { return d.dt; },
      get raw() { return d.raw; },
      get force() { return d.force; },
      set force(v: boolean) { d.force = v; },
      capture: () => new Promise((resolve) => { d.pending = resolve; invalidate(); }),
    };
    return () => { delete w.__wake; };
  }, [debug, invalidate]);

  // Priority 1: R3F leaves the render to us. Field's own useFrame (priority 0) has already
  // moved the meshes this frame.
  useFrame((_, rawDelta) => {
    const dt = clampDelta(rawDelta);
    const fd = fieldFor();
    const q = quadFor();
    const canvas = gl.domElement;

    // ---- the brush: this frame's travel over the CARD, in canvas CSS px → field texels. The
    // canvas rect is read only on a frame the pointer moved; speed is the travel over the frame's
    // REAL elapsed time (brushFor — the world's dt is clamped, a hand is not); nothing when the
    // pointer did not move, and nothing on a resume frame (a hidden tab's gap, or the never →
    // demand flag above), whose travel spans the whole pause: it re-seeds the previous point ----
    const p = prev.current;
    const resume = resumed.current;
    resumed.current = false;
    let radius = 0, speed = 0, strength = 0;
    let fromX = 0, fromY = 0, toX = 0, toY = 0;
    let painting = false;
    if (rig.over && fd.cssW > 0 && fd.cssH > 0) {
      const moved = !p.valid || rig.cx !== p.cx || rig.cy !== p.cy;
      let x = p.x, y = p.y;
      if (moved) {
        const r = canvas.getBoundingClientRect();
        x = rig.cx - r.left;
        y = rig.cy - r.top;
      }
      const brush = brushFor(p.valid && moved ? Math.hypot(x - p.x, y - p.y) : 0, rawDelta, resume, fd.size.h);
      speed = brush.speed; radius = brush.radius; strength = brush.strength;
      // re-seed: the stop disc must not be repainted where the pointer was before the pause
      if (resume) p.radius = 0;
      if (p.valid && !resume) {
        fromX = p.x; fromY = p.y;
      } else {
        // the first frame over the card (the rig's own rule: re-entry is not a flick), or a resume
        fromX = x; fromY = y;
      }
      toX = x; toY = y;
      // this frame paints if its capsule — or the disc the stop frame repaints at the previous
      // radius — can reach the canvas; a board flick a brush away from the column arms nothing
      const rTex = Math.max(radius, p.radius);
      painting = rTex > 0 && capsuleTouches(fromX, fromY, toX, toY, (rTex / fd.size.h) * fd.cssH, fd.cssW, fd.cssH);
      p.x = x; p.y = y; p.cx = rig.cx; p.cy = rig.cy; p.valid = true;
    } else {
      p.valid = false;
      p.radius = 0;
    }
    const d = dbg.current;
    d.speed = speed;
    d.radius = radius;
    d.dt = dt;
    d.raw = rawDelta;
    const scale = fieldScale(fd.size.h);

    const alive = awake(weight.current, painting);
    if (!alive && !d.force) {
      // a still, empty field: PR A's frame, and nothing else — no copy, no quad, no invalidate
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      if (d.pending) {
        const plain = canvas.toDataURL();
        d.pending({ plain, post: plain, simDt: dt });
        d.pending = null;
      }
      return;
    }

    if (alive) {
      // ---- step the field: paint + advect + dissipate into the other target, then the 1/8 blur ----
      const fs = fd.size;
      const tx = (v: number) => (v / fd.cssW) * fs.w;
      const ty = (v: number) => (1 - v / fd.cssH) * fs.h;
      const prevT = fd.a, currT = fd.b;
      fd.a = currT;
      fd.b = prevT;
      const u = q.paint.uniforms;
      u.tPrev.value = prevT.texture;
      u.tLow.value = fd.low.texture;
      (u.uTexel.value as THREE.Vector2).set(1 / fs.w, 1 / fs.h);
      (u.uFrom.value as THREE.Vector4).set(tx(fromX), ty(fromY), p.radius, 1);
      (u.uTo.value as THREE.Vector4).set(tx(toX), ty(toY), radius, 1);
      p.radius = radius;
      u.uPush.value = WAKE.PUSH * scale * 60 * dt;
      (u.uDecay.value as THREE.Vector3).set(perFrame(WAKE.DECAY_V, dt), perFrame(WAKE.DECAY_LONG, dt), perFrame(WAKE.DECAY_SHORT, dt));
      u.uFloor.value = WAKE.FLOOR * 60 * dt;
      const v = uVel.current;
      v.multiplyScalar(perFrame(WAKE.ACCEL_DECAY, dt));
      if (radius > 0) {
        v.x += (tx(toX) - tx(fromX)) * (1 / 60) * WAKE.INJECT * strength;
        v.y += (ty(toY) - ty(fromY)) * (1 / 60) * WAKE.INJECT * strength;
      }
      (u.uVel.value as THREE.Vector2).copy(v);
      pass(q.paint, currT);
      q.copy.uniforms.tSrc.value = currT.texture;
      pass(q.copy, fd.low);
      // the 0.25 is Blur.blur's own `c = .25` (bundle, class Blur: u_delta = radius / width × c)
      q.blur.uniforms.tSrc.value = fd.low.texture;
      (q.blur.uniforms.uDelta.value as THREE.Vector2).set(((WAKE.BLUR_RADIUS * scale) / fs.lowW) * 0.25, 0);
      pass(q.blur, fd.lowTmp);
      q.blur.uniforms.tSrc.value = fd.lowTmp.texture;
      (q.blur.uniforms.uDelta.value as THREE.Vector2).set(0, ((WAKE.BLUR_RADIUS * scale) / fs.lowH) * 0.25);
      pass(q.blur, fd.low);
      weight.current = strokeBound(weight.current, painting, dt);
    }

    // ---- the scene, exactly as R3F would draw it ----
    gl.setRenderTarget(null);
    gl.render(scene, camera);

    if (weight.current > 0 || d.force) {
      const plain = d.pending ? canvas.toDataURL() : "";
      // ---- copy the finished frame and write it back through the field ----
      const tex = frameFor();
      gl.copyFramebufferToTexture(tex);
      const c = q.composite.uniforms;
      c.tFrame.value = tex;
      c.tField.value = fd.a.texture;
      (c.uFieldTexel.value as THREE.Vector2).set(1 / fd.size.w, 1 / fd.size.h);
      c.uScale.value = scale;
      (c.uSeed.value as THREE.Vector2).set(Math.random() * 1024, Math.random() * 1024);
      pass(q.composite, null);
      d.frames++;
      if (d.pending) {
        d.pending({ plain, post: canvas.toDataURL(), simDt: dt });
        d.pending = null;
      }
      // the field is the loop's reason to run another frame; Field's own reasons are its own
      if (weight.current > 0) invalidate();
    } else {
      // the stroke has died this frame: the field is all zeros, so the pass would be a no-op —
      // skip it and hand the next stroke a clean field
      resetField(fd);
      if (d.pending) {
        const plain = canvas.toDataURL();
        d.pending({ plain, post: plain, simDt: dt });
        d.pending = null;
      }
    }
  }, 1);

  return null;
}
