"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DYN, clampDelta, clickWorld, createWorld, isResting, setKeepOut, setView, stepWorld, type KeepOut, type Pointer, type Vec3, type World } from "../lib/jackDynamics";
import { FIELD, LIGHT_WHITE, SEED_FIELD, atPageTop, fieldCamera, fieldCasting, fieldScales, keepOutFor, onScreen, placeWorld, retarget, solveTargets, type FieldFit, type Rect, type Slot } from "../lib/fieldLayout";
import { DRIFT, driftOffset } from "../lib/fieldDrift";
import { GLASS, GLASS_FRESNEL_GLSL, GLASS_RIM_GLSL, GLASS_UNIFORM_GLSL, glassFinish, glassRecipe } from "../lib/glassLook";
import { KEY, environmentScene, jackGeometry } from "../lib/jackMaterials";
import type { PointerRig } from "../lib/pointerRig";
import { createSampler, sampleFrame } from "../lib/scenePerf";

// The three.js side of the jack field (JackField.tsx is the gate). The card's object — the
// shared geometry, the one key and the one-plane environment (jackMaterials.ts) — worn as
// TINTED GLASS (glassLook.ts: the owner found the card's plastic solid here; the card keeps
// it), ONE layer per pixel: each jack is a depth pre-pass (colour writes off) and then the
// glass at depthFunc LessEqual on the SAME program, so only its nearest front surface is
// composited and the interior — the core sphere, the arm bases, the far walls — is culled by
// the depth test. The first glass round composited every surface of a DoubleSide mesh (three
// draws a transparent DoubleSide mesh as a BackSide pass then a FrontSide pass with depth
// writes off): an arm stacked 2 layers, a tip 4, the junction 6–10 at ≈ 0.99 alpha — the
// dense ball, wider than the arms, the owner asked about; the core itself protrudes ≤ 0.013 u
// (jackGeometry.ts), sub-pixel here, so with one layer the jack is plain. The card's AO bake
// and neighbour-occlusion injection are NOT on the glass either (composed with alpha blending
// they read as a dark solid ball inside every jack — the crotch bakes at 0.65, the bores at
// 0.01–0.2), and glass takes no contact crease. And the card's motion: Lusion's dynamics, the
// ray-only pointer push with the cursor's velocity, the click burst, the swirl × idle
// envelope, the parked-pointer rule, the keep-out band, the shared perf sampler — plus the
// idle drift (fieldDrift.ts): the homes wander a little and the bodies follow, so at rest the
// field idles at DRIFT.IDLE_HZ instead of freezing. What differs from the card is the frame
// (fieldLayout.ts: sixteen letter-sized jacks on a lattice in VIEWPORT space, an edge spawn,
// no dolly) and a transparent canvas that is a fixed layer of the page rather than a panel in
// a section.
//
// The keep-out protects the headline ONLY while the hero's h1 is on screen, and the field
// does not scroll while the page does, so three rules keep that honest:
// - HOMES are solved against the hero's PAGE position (the rects moved to scrollY 0 —
//   fieldLayout.atPageTop), whatever scroll the layout ran at, so the rest state is one
//   composition that is always clear of the name at the top of the page.
// - The BAND follows the rects at the current scroll (measured on any frame where scrollY
//   changed); a box that appears or jumps fades its strength in over RAMP_S of sim time, and
//   the band never drives a body outward faster than DYN.KEEP_VOUT: a headline that has
//   scrolled onto resting jacks eases them out, it does not kick them at the cap (measured
//   before: 5 of 16 resting jacks under the name at scrollY 200–300 at 1440 × 900, then full
//   K_KEEP on the next pointer move — 20 u/s even with the ramp; 6 u/s with the cap).
// - A scroll never wakes the ENVELOPE: on scroll-end (SCROLL_END_MS) the boxes are re-measured
//   and, if any jack sits inside a live band, the loop runs at full rate for the frames it
//   takes to clear it (E stays 0; the band eases). A scroll that leaves nothing under the name
//   changes nothing — the frames keep ticking at the drift's idle cadence regardless, and E
//   stays 0.
// The visitor card gets a half-strength box while on screen so the map is never obscured.
// Everywhere else the jacks pass BEHIND content: text at z-20 stays on top and glass cards
// blur them. The card's own scene sits in an opaque panel, so the field is hidden behind it.
//
// No wake ribbon: WakeRibbon composites its own frame back with alpha forced to 1 — an opaque
// smear over a transparent canvas — and the fluid already is the page's wake.

// The card's idle envelope (ConnectorField.tsx IDLE), the same numbers on purpose.
const IDLE = { ENTRANCE_S: 10, LEAVE_S: 8, VISIBLE_S: 4, DECAY_S: 2, PARKED_S: 3 } as const;
// Lusion never rests; this site's rule WAS that a resting scene costs nothing. The owner
// (2026-09-17) asked for the jacks to drift "ever slightly" at rest, so while DRIFT has an
// amplitude the field idles at DRIFT.IDLE_HZ with the bodies following slowly wandering homes
// (fieldDrift.ts); AMP = AMP_Z = 0 restores rest → freeze. IDLE_FOREVER is the other flip: the
// swirl's envelope never closing.
const IDLE_FOREVER = false;
/** the drift is on: rest → idle cadence (DRIFT.IDLE_HZ) instead of rest → freeze */
const DRIFTING = DRIFT.AMP > 0 || DRIFT.AMP_Z > 0;
// The DPR step-down samples the first frames after the entrance beat (scenePerf.ts has the rule).
const PERF_WINDOW_S = 5;
// The visitor card's band, as a fraction of the headline's.
const CARD_STRENGTH = 0.5;
// A keep-out box that appears, or whose centre jumped more than MOVED_U since the last measure,
// fades its strength in over this much sim time — a nudge, not a kick.
const RAMP_S = 0.4;
const MOVED_U = 0.5;
// The scroll-end debounce: one rect read per scroll, not per scroll event.
const SCROLL_END_MS = 120;
// Occlusion neighbours per jack: none — the glass carries no neighbour-occlusion loop (see the
// header). For the record, the plastic round ran 8 of a possible 15 (the card runs 11 for its
// packed dozen): jackSphereOcc falls as (r/l)², a 0.55 u core three units away darkens ≤ 3%,
// so past the eight nearest the loop was paid for and invisible — 6.7 M sphere-occlusion
// evaluations a frame at 1440 × 900, DPR 2 instead of 12.5 M. Glass: 0.
const NEAR_COUNT_GLASS = 0;
// The environment's intensity per theme. The shared rig is one plane at 4 over a 0.15 floor,
// tuned against the card's dark panel; in the light theme that is a dark room lighting objects
// on a white page. More fill there — the white page bouncing light back — is the honest fix;
// the KEY stays the one analytic light. Keyed on the sixteen resting discs at 1440 × 900
// (scripts/verify-field.mjs `sweep`, linear luminance over each disc's inner 0.75 r): the
// WHITE family — Lusion's light-mode #8e9098 / #a3a5ad, the ones that must sit in the page's
// tonal family — measured a median of 0.053 at 1.0, 0.087 at 1.7, 0.120 at 2.4, 0.151 at 3.0
// (sRGB 0.25 → 0.33 → 0.40 → 0.43); the accents 0.03 → 0.07; the blacks 0.002 → 0.009. The
// review's target for the stones' neutral ramp, an overall median of 0.3–0.45, cannot apply
// to a palette a third of which is black by the owner's choice (the overall median tops out
// at 0.079 at 3.0), so the whites' median is the metric: 3.0 puts it at #70, the top of the
// sweep with no blown highlight on the glossy white in the frame.
const ENV_DARK = 1.0;
const ENV_LIGHT = 3.0;

interface GlassMaterial { material: THREE.MeshPhysicalMaterial; glass: { uGlassOpacity: { value: number }; uGlassRim: { value: number }; uGlassPow: { value: number }; uGlassRimLight: { value: number } } }

/**
 * A slot's glass: a MeshPhysicalMaterial, transparent, alpha-blended, FrontSide (the bore's
 * far wall and floor are front faces seen through the mouth, so the tips still read as
 * hollow), depth-write off, depthFunc LessEqual (three's default, stated) so it lands exactly
 * on the depth the pre-pass (depthPrepassMaterial) wrote for the same triangles, the clearcoat
 * reflecting the one-plane environment, with the Fresnel opacity and rim-light terms injected
 * (glassLook.ts). One program for all sixteen AND the pre-pass (GLASS.PROGRAM_KEY): the
 * injected source is the same for every family, only uniforms differ. No polygonOffset: the
 * two passes run one program on one geometry with one matrix, so gl_Position is bit-identical
 * by construction and LessEqual passes exactly; if the Metal-GPU frame ever showed speckle at
 * the arm edges, the fallback is polygonOffset on THIS colour pass (factor −1, units −1).
 */
function makeGlassMaterial(slot: Slot, theme: "dark" | "light", accent: string): GlassMaterial {
  const r = glassRecipe(slot.family, slot.finish, accent, theme === "light" ? LIGHT_WHITE[slot.finish] : null);
  const material = new THREE.MeshPhysicalMaterial({
    color: r.color,
    transparent: true,
    opacity: r.opacity,
    metalness: 0,
    roughness: r.roughness,
    clearcoat: GLASS.CLEARCOAT,
    clearcoatRoughness: GLASS.CLEARCOAT_ROUGHNESS,
    ior: GLASS.IOR,
    specularIntensity: GLASS.SPECULAR_INTENSITY,
    envMapIntensity: GLASS.ENV_MAP_INTENSITY,
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
  });
  const glass = { uGlassOpacity: { value: r.opacity }, uGlassRim: { value: GLASS.RIM_OPACITY }, uGlassPow: { value: GLASS.FRESNEL_POWER }, uGlassRimLight: { value: GLASS.RIM_LIGHT } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glass);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + GLASS_UNIFORM_GLSL)
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n" + GLASS_FRESNEL_GLSL)
      .replace("#include <opaque_fragment>", GLASS_RIM_GLSL + "\n#include <opaque_fragment>");
  };
  material.customProgramCacheKey = () => GLASS.PROGRAM_KEY;
  return { material, glass };
}

/** recolour a slot's glass in place for a theme/accent flip: tint, opacity and roughness are uniforms */
function tintGlass(m: GlassMaterial, slot: Slot, theme: "dark" | "light", accent: string): void {
  const r = glassRecipe(slot.family, slot.finish, accent, theme === "light" ? LIGHT_WHITE[slot.finish] : null);
  m.material.color.set(r.color);
  m.material.opacity = r.opacity;
  m.glass.uGlassOpacity.value = r.opacity;
  m.material.roughness = r.roughness;
}

/**
 * The depth pre-pass, one material for every jack: the SAME program as the glass — built by
 * makeGlassMaterial (any slot; its tint is never written) with the same onBeforeCompile
 * injection and customProgramCacheKey — so three hands both meshes one WebGLProgram and their
 * gl_Position is bit-identical by construction. Two DIFFERENT programs (a MeshBasicMaterial
 * pre-pass, say) are not guaranteed identical positions by GLSL ES (§4.6.1: invariance only
 * for `invariant` outputs), and a swiftshader frame cannot clear that risk for the owner's
 * Metal GPU. Colour writes off, depth writes on, FrontSide, and still `transparent` so it sits
 * in the transparent render list next to the glass (WebGLRenderLists routes by transmission,
 * then material.transparent; colorWrite is not consulted). The physical fragment shader runs
 * with colour writes off — ≈ 16 × 17 k fragments, negligible. Module-level singleton, never
 * disposed (`dispose={null}` on its meshes).
 */
let prepass: THREE.MeshPhysicalMaterial | null = null;
function depthPrepassMaterial(): THREE.MeshPhysicalMaterial {
  if (!prepass) {
    const m = makeGlassMaterial({ family: "black", finish: "glossy" }, "dark", "#3b82f6").material;
    m.colorWrite = false;
    m.depthWrite = true;
    m.depthTest = true;
    m.side = THREE.FrontSide;
    m.transparent = true;
    prepass = m;
  }
  return prepass;
}

/** the glass table's knobs, as the debug hook exposes them: the family bases, the rim's extra opacity, the frosted finish's extra */
interface GlassTable { black: number; accent: number; white: number; rim: number; frosted: number }

interface Debug {
  simTime: number;
  /** sim seconds since the entrance beat, −1 before it */
  entranceT: number;
  frames: number;
  E: number;
  /** rest → freeze (only when DRIFT is zeroed; with the drift on it never becomes true) */
  frozen: boolean;
  /** the drift's idle cadence is running: settled, E = 0, no live pointer, nothing faster than DRIFT.IDLE_V */
  idle: boolean;
  idleHz: number;
  drifting: boolean;
  /** the undrifted targets, per body — what the drift wanders about */
  homes: Vec3[];
  dPerFont: number;
  unitDiam: number;
  entered: boolean;
  over: boolean;
  camZ: number;
  tier: number;
  /** the jacks drawn: visible groups */
  meshes: number;
  /** visible meshes under visible groups: 2 × the jacks drawn (the depth pre-pass and the glass) */
  passes: number;
  /** the visible groups' renderOrder in body order: the back-to-front rank (a permutation of 0..n−1, ascending with pos.z) */
  renderOrders: number[];
  /** gl.info.programs.length, and how many of them carry GLASS.PROGRAM_KEY (must be 1: the pre-pass added none) */
  programs: number;
  glassPrograms: number;
  /** occlusion neighbours per jack (0: the glass carries no neighbour loop) */
  near: number;
  /** how many times layout() has re-solved (mount, resize, the h1 or the card changing size) */
  layouts: number;
  /** the lattice slots culled at birth (fieldLayout.solveTargets) */
  culled: number[];
  fit: FieldFit | null;
  /** the keep-out boxes in force this frame (the h1's, then the card's at half strength), with their ramped strengths */
  keepOuts: KeepOut[];
  /** every box at its full strength (no ramp still fading) */
  keepOutsSettled: boolean;
  scrollY: number;
  envIntensity: number;
  /** each body's family and finish */
  casting: Slot[];
  /** mean |pos − target| over the bodies — the regather measure */
  spread: number;
  /** the least clearance of any body's disc from the HEADLINE's inflated box (Infinity when the h1 is off screen) */
  clearance: number;
  bodies(): { x: number; y: number; z: number; vx: number; vy: number; vz: number; v: number; scale: number; r: number }[];
  step(dt: number): void;
  /** hand a body a velocity — the harness's flick, so the keep-out can be tested at software-GL frame rates */
  kick(i: number, vx: number, vy: number, vz: number): void;
  /** override the environment's intensity (the light-theme re-key's sweep) */
  setEnvIntensity(v: number): void;
  /** the glass table in force (GLASS.OPACITY / RIM_OPACITY / FROSTED_OPACITY until setGlass overrides it) */
  glass: GlassTable;
  /**
   * the controller's lever for choosing the table by eye on a real GPU: writes every slot's
   * material.opacity and uGlassOpacity from its family's base (+ frosted for the frosted-finish
   * slots, mirroring glassRecipe) and uGlassRim from rim, then invalidates. A theme/accent flip
   * (tintGlass) re-applies glassRecipe's values; the override is a debug-session lever.
   */
  setGlass(t: Partial<GlassTable>): void;
}

/** the rounded-box clearance the keep-out step computes, for the debug hook and the scroll-end check */
function clearanceOf(world: World, box: KeepOut, eyeZ: number): number {
  let worst = Infinity;
  for (const b of world.bodies) {
    const s = eyeZ > 0 ? eyeZ / (eyeZ - b.pos.z) : 1;
    const qx = b.pos.x * s - box.cx, qy = b.pos.y * s - box.cy;
    const ex = Math.abs(qx) - box.hw, ey = Math.abs(qy) - box.hh;
    worst = Math.min(worst, Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - (b.r + DYN.KEEP_PAD));
  }
  return worst;
}

const viewportRect = (el: Element | null): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

interface Ramp { t0: number; cx: number; cy: number }

function Field({ count, accent, theme, visible, rig, debug, tier, onDegrade }: {
  count: number;
  accent: string;
  theme: "dark" | "light";
  visible: boolean;
  rig: PointerRig;
  debug: boolean;
  tier: number;
  onDegrade: () => void;
}) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const geometry = useMemo(jackGeometry, []);
  const scales = useMemo(() => fieldScales(count, SEED_FIELD), [count]);
  const slots = useMemo(() => fieldCasting(count, SEED_FIELD), [count]);
  // Materials are born once per count; the theme and the accent recolour IN PLACE (the card's
  // reason: rebuilding disposed the program and recompiled it on every toggle). Sixteen glass
  // materials, one program (GLASS.PROGRAM_KEY).
  const mats = useMemo(() => slots.map((s) => makeGlassMaterial(s, "dark", "#3b82f6")), [slots]);
  useEffect(() => {
    invalidate();
    return () => mats.forEach((m) => m.material.dispose());
  }, [mats, invalidate]);
  useEffect(() => {
    mats.forEach((m, i) => tintGlass(m, slots[i], theme, accent));
    invalidate();
  }, [accent, theme, mats, slots, invalidate]);
  // one group per slot: the depth pre-pass mesh and the glass mesh on the shared geometry
  const groups = useRef<(THREE.Group | null)[]>([]);
  const prepassMaterial = useMemo(depthPrepassMaterial, []);

  // The world is born in layout() below, once, from the slots the first solve KEEPS (a slot the
  // view's edge cannot free from a band is culled): body j is slot slotOf[j]. Later layouts
  // (a resize, the h1 or the card changing size) re-solve without culling and retarget —
  // bodies are pulled to the new lattice, never moved — and WAKE the loop: no pointermove
  // reaches the page during a drag-resize, and a frozen pack would otherwise sit over
  // reflowed letters until the next move.
  const fitRef = useRef<FieldFit>(fieldCamera(size.width, size.height, null));
  const worldRef = useRef<World | null>(null);
  const slotOf = useRef<number[]>([]);
  const culledRef = useRef<number[]>([]);
  const enteredAt = useRef<number | null>(null);
  const frozen = useRef(false);
  const idle = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the undrifted targets per body: copies of what placeWorld / retarget were handed (both assign fresh objects, so these never drift); fieldDrift adds the wander on top each frame */
  const homes = useRef<Vec3[]>([]);
  const driftTmp = useMemo<Vec3>(() => ({ x: 0, y: 0, z: 0 }), []);
  /** the bodies' back-to-front order, re-sorted in place each frame (no allocation) */
  const order = useRef<number[]>([]);
  const frames = useRef(0);
  const layouts = useRef(0);
  const firstFrame = useRef(true);
  const env = useRef({ E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false, movedAt: -Infinity, rigX: NaN, rigY: NaN });
  const perf = useMemo(createSampler, []);
  const envOverride = useRef<number | null>(null);
  // the glass table in force; the debug hook's setGlass overrides it in place (see Debug.setGlass)
  const glassTable = useRef<GlassTable>({ black: GLASS.OPACITY.black, accent: GLASS.OPACITY.accent, white: GLASS.OPACITY.white, rim: GLASS.RIM_OPACITY, frosted: GLASS.FROSTED_OPACITY });

  // the keep-out: measured when scrollY changed, the layout did, or a box is still ramping
  const keep = useRef<{ scrollY: number; boxes: KeepOut[]; h1: KeepOut | null; stale: boolean; settled: boolean; ramps: { h1: Ramp | null; card: Ramp | null } }>({ scrollY: NaN, boxes: [], h1: null, stale: true, settled: true, ramps: { h1: null, card: null } });

  // pointer state, from the field's rig (the gate's window listener)
  const wasOver = useRef(false);
  const pointerFresh = useRef(true);
  const prevHit = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const pvel = useMemo(() => new THREE.Vector3(), []);

  // the idle timer (DRIFTING): one ref, cleared before every schedule, in wake, on unmount and when the tab hides
  const clearIdleTimer = useRef(() => {
    if (idleTimer.current !== null) { clearTimeout(idleTimer.current); idleTimer.current = null; }
  });
  const wake = useRef(() => {
    frozen.current = false;
    clearIdleTimer.current();
    invalidate();
  });

  // The environment: one PMREM from the shared one-plane rig, once per context, as the card;
  // its intensity per theme (ENV_DARK / ENV_LIGHT).
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(environmentScene(), 0, 0.1, 100);
    scene.environment = target.texture;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  useEffect(() => {
    scene.environmentIntensity = envOverride.current ?? (theme === "light" ? ENV_LIGHT : ENV_DARK);
    invalidate();
  }, [theme, scene, invalidate]);

  // layout(): the camera from the wordmark's computed font size (or the 9 u fallback when no
  // h1 is on the page), the lattice solved against the h1 and the visitor card at their PAGE
  // position (fieldLayout.solveTargets, atPageTop), the soft bounds. The first call births the
  // world from the kept slots and spawns it beyond the edges; later calls retarget and wake.
  const layout = useRef(() => {});
  layout.current = () => {
    layouts.current++;
    const span = document.querySelector<HTMLElement>("[data-hero-h1] span");
    const font = span ? parseFloat(getComputedStyle(span).fontSize) : null;
    const fit = fieldCamera(size.width, size.height, font);
    fitRef.current = fit;
    const sy = window.scrollY;
    const avoid: KeepOut[] = [];
    const h1 = viewportRect(document.querySelector("[data-hero-h1]"));
    if (h1) { const p = atPageTop(h1, sy); if (onScreen(p, fit.width, fit.height)) avoid.push(keepOutFor(p, fit, 1)); }
    const card = viewportRect(document.querySelector("[data-hero-card]"));
    if (card) { const p = atPageTop(card, sy); if (onScreen(p, fit.width, fit.height)) avoid.push(keepOutFor(p, fit, CARD_STRENGTH)); }
    let world = worldRef.current;
    if (!world) {
      const { targets, culled } = solveTargets(fit, count, SEED_FIELD, scales, avoid, true);
      const kept = scales.map((_, i) => i).filter((i) => !culled.includes(i));
      slotOf.current = kept;
      culledRef.current = culled;
      world = createWorld(kept.map((i) => scales[i]), fit, SEED_FIELD);
      placeWorld(world, targets, fit);
      homes.current = targets.map((t) => ({ x: t.x, y: t.y, z: t.z }));
      worldRef.current = world;
    } else {
      setView(world, fit);
      const { targets } = solveTargets(fit, count, SEED_FIELD, scales, avoid, false);
      const mine = slotOf.current.map((slot) => targets[slot]);
      retarget(world, mine);
      homes.current = mine.map((t) => ({ x: t.x, y: t.y, z: t.z }));
    }
    keep.current.stale = true;
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = FIELD.FOV;
    cam.near = FIELD.NEAR;
    cam.far = FIELD.FAR;
    cam.position.set(0, 0, fit.z);
    cam.updateProjectionMatrix();
    firstFrame.current = true;
    wake.current();
  };
  useEffect(() => { layout.current(); }, [size, camera]);
  // The h1 wrapping, a font swap, the visitor card growing after its fetch: re-solve and nudge.
  useEffect(() => {
    const els = [...document.querySelectorAll("[data-hero-h1], [data-hero-card]")];
    if (els.length === 0) return;
    let first = true;
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } layout.current(); });
    els.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);

  // The keep-out boxes for this scroll position: the h1 at full strength, the visitor card at
  // half, each only while any of it is on screen, each fading in over RAMP_S when it appears
  // or jumps. One rect read per box per scroll change (plus one per frame while ramping).
  const measureKeepOut = (now: number) => {
    const k = keep.current;
    const world = worldRef.current;
    if (!world) return;
    const y = window.scrollY;
    // re-measure on a scroll change, a layout change, or while any box is still fading in
    if (!k.stale && k.scrollY === y && k.settled) return;
    const fit = fitRef.current;
    let settled = true;
    const place = (key: "h1" | "card", el: Element | null, strength: number): KeepOut | null => {
      const rect = viewportRect(el);
      if (!rect || !onScreen(rect, fit.width, fit.height)) { k.ramps[key] = null; return null; }
      const box = keepOutFor(rect, fit, strength);
      const prev = k.ramps[key];
      if (!prev || Math.hypot(box.cx - prev.cx, box.cy - prev.cy) > MOVED_U) k.ramps[key] = { t0: now, cx: box.cx, cy: box.cy };
      else { prev.cx = box.cx; prev.cy = box.cy; }
      const ramp = k.ramps[key] as Ramp;
      const s = Math.min(1, Math.max(0, now - ramp.t0) / RAMP_S);
      if (s < 1) settled = false;
      return { ...box, strength: strength * s };
    };
    const boxes: KeepOut[] = [];
    const h1 = place("h1", document.querySelector("[data-hero-h1]"), 1);
    if (h1) boxes.push(h1);
    const card = place("card", document.querySelector("[data-hero-card]"), CARD_STRENGTH);
    if (card) boxes.push(card);
    setKeepOut(world, boxes, fit.z);
    k.h1 = h1;
    k.boxes = boxes;
    k.scrollY = y;
    k.stale = false;
    k.settled = settled;
  };

  // The drift (fieldDrift.ts): every body's target is its undrifted home plus the wander at the
  // world's clock, written INTO the existing target object (no allocation per frame). The pull,
  // the tumble and the click read b.target, so the body follows the wandering home with the
  // dynamics' own lag — that is the "not rigid". Runs before every stepWorld, the harness's
  // step() included, so a stepped second advances the drift too.
  const applyDrift = useCallback((world: World) => {
    if (!DRIFTING) return;
    const hs = homes.current, slots_ = slotOf.current, bodies = world.bodies;
    for (let j = 0; j < bodies.length; j++) {
      const h = hs[j];
      if (!h) continue;
      driftOffset(slots_[j], world.time, SEED_FIELD, driftTmp);
      const tg = bodies[j].target;
      tg.x = h.x + driftTmp.x; tg.y = h.y + driftTmp.y; tg.z = h.z + driftTmp.z;
    }
  }, [driftTmp]);

  // Scroll-end: re-measure the boxes for the new scroll; wake (full rate) only if a jack is
  // inside a live band (the headline landed on resting jacks) — otherwise the scroll changes
  // nothing: the frames tick on at the idle cadence, and E stays 0 either way.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScrollEnd = () => {
      const world = worldRef.current;
      if (!world) return;
      measureKeepOut(world.time);
      if (world.keepOut.some((box) => clearanceOf(world, box, world.eyeZ) < DYN.KEEP_BAND)) { firstFrame.current = true; wake.current(); }
    };
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(onScrollEnd, SCROLL_END_MS); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener("scroll", onScroll); };
  }, []);

  // The field's pointer wakes the loop; a move anywhere over the page is enough.
  useEffect(() => {
    rig.bind(wake.current);
    return () => rig.bind(null);
  }, [rig]);

  // Click: Lusion's burst, only for a click on EMPTY page space — the fluid canvas (fixed,
  // full-viewport, what a click on a pointer-events-none section lands on), or the page
  // itself; never inside a pointer-events-auto subtree, a link or a button.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (enteredAt.current === null) return;
      const t = ev.target instanceof Element ? ev.target : null;
      if (!t || t.closest(".pointer-events-auto, a, button")) return;
      const onFluid = t instanceof HTMLCanvasElement && t !== gl.domElement;
      const onPage = t === document.body || t === document.documentElement || t.tagName === "MAIN";
      if (!onFluid && !onPage) return;
      const world = worldRef.current;
      if (!world) return;
      clickWorld(world);
      wake.current();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [gl]);

  // Back from a hidden tab: the frameloop just went never → demand with the clock reset. One
  // frame at 1/60 restarts whatever was still moving and re-arms the envelope.
  useEffect(() => {
    if (visible) { firstFrame.current = true; pointerFresh.current = true; wake.current(); }
    else clearIdleTimer.current();
  }, [visible]);
  // unmount: no idle timer may wake a loop that is gone
  useEffect(() => () => clearIdleTimer.current(), []);

  // ?jacksDebug=1 → window.__field: the verification clock and the levers (see Debug).
  useEffect(() => {
    if (!debug) return;
    const w = window as unknown as { __field?: Debug };
    const self = env.current;
    const world = () => worldRef.current;
    const bodies = () => world()?.bodies ?? [];
    w.__field = {
      get simTime() { return world()?.time ?? 0; },
      get entranceT() { const wd = world(); return enteredAt.current === null || !wd ? -1 : wd.time - enteredAt.current; },
      get frames() { return frames.current; },
      get E() { return self.E; },
      get frozen() { return frozen.current; },
      get idle() { return idle.current; },
      get idleHz() { return DRIFT.IDLE_HZ; },
      get drifting() { return DRIFTING; },
      get homes() { return homes.current.map((h) => ({ x: h.x, y: h.y, z: h.z })); },
      get dPerFont() { return FIELD.D_PER_FONT; },
      get unitDiam() { return FIELD.UNIT_DIAM; },
      get entered() { return enteredAt.current !== null; },
      get over() { return rig.over; },
      get camZ() { return camera.position.z; },
      get tier() { return tier; },
      get meshes() { return groups.current.filter((g) => g && g.visible).length; },
      get passes() { return groups.current.reduce((n, g) => n + (g && g.visible ? g.children.filter((c) => c.visible).length : 0), 0); },
      get renderOrders() { return slotOf.current.map((slot) => groups.current[slot]?.renderOrder ?? -1); },
      get programs() { return gl.info.programs?.length ?? 0; },
      get glassPrograms() { return (gl.info.programs ?? []).filter((p) => p.cacheKey.includes(GLASS.PROGRAM_KEY)).length; },
      get near() { return NEAR_COUNT_GLASS; },
      get layouts() { return layouts.current; },
      get culled() { return culledRef.current; },
      get fit() { return worldRef.current ? fitRef.current : null; },
      get keepOuts() { return keep.current.boxes; },
      get keepOutsSettled() { return keep.current.settled; },
      get scrollY() { return keep.current.scrollY; },
      get envIntensity() { return scene.environmentIntensity; },
      get casting() { return slotOf.current.map((slot) => slots[slot]); },
      get spread() { const bs = bodies(); return bs.length ? bs.reduce((n, b) => n + Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z), 0) / bs.length : 0; },
      get clearance() { const wd = world(); return wd && keep.current.h1 ? clearanceOf(wd, keep.current.h1, wd.eyeZ) : Infinity; },
      bodies: () => bodies().map((b, j) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, v: Math.hypot(b.vel.x, b.vel.y, b.vel.z), scale: scales[slotOf.current[j]], r: b.r })),
      step: (dt: number) => { const wd = world(); if (!wd) return; measureKeepOut(wd.time); applyDrift(wd); stepWorld(wd, dt, null, self.E); invalidate(); },
      kick: (i: number, vx: number, vy: number, vz: number) => { const wd = world(); const b = wd?.bodies[i]; if (wd && b) { b.vel = { x: vx, y: vy, z: vz }; wd.still = 0; wake.current(); } },
      setEnvIntensity: (v: number) => { envOverride.current = v; scene.environmentIntensity = v; invalidate(); },
      get glass() { return { ...glassTable.current }; },
      setGlass: (t: Partial<GlassTable>) => {
        const table = Object.assign(glassTable.current, t);
        mats.forEach((m, i) => {
          const slot = slots[i];
          const opacity = Math.min(1, table[slot.family] + (glassFinish(slot.finish) === "frosted" ? table.frosted : 0));
          m.material.opacity = opacity;
          m.glass.uGlassOpacity.value = opacity;
          m.glass.uGlassRim.value = table.rim;
        });
        invalidate();
      },
    };
    return () => { delete w.__field; };
  }, [debug, scales, slots, mats, camera, scene, tier, rig, invalidate, gl, applyDrift]);

  useFrame((_, rawDelta) => {
    frames.current++;
    if (!worldRef.current) layout.current();
    const world = worldRef.current;
    if (!world) return;
    const cam = camera as THREE.PerspectiveCamera;

    // The entrance: the first frame after birth — the rIC + 500 ms beat — with the hero in view.
    if (enteredAt.current === null) {
      enteredAt.current = world.time;
      env.current.aliveUntil = world.time + IDLE.ENTRANCE_S;
    }

    if (!frozen.current) {
      // dt rules: the first frame after never → demand and after the pointer arrives is 1/60
      // (R3F resets its clock; 0 is Infinity in the pointer terms, the idle gap a 30× flick).
      const delta = firstFrame.current ? DYN.STEP : rawDelta;
      firstFrame.current = false;
      const dt = clampDelta(delta);

      measureKeepOut(world.time);

      // the cursor ray, only while the pointer is over the page; NDC from the rig's −0.5..0.5
      let ptr: Pointer | null = null;
      if (rig.over) {
        if (!wasOver.current) pointerFresh.current = true;
        dir.set(rig.x * 2, -rig.y * 2, 0.5).unproject(cam).sub(cam.position).normalize();
        if (dir.z < -1e-6) {
          hit.copy(cam.position).addScaledVector(dir, -cam.position.z / dir.z);
          if (pointerFresh.current) { prevHit.copy(hit); pointerFresh.current = false; }
          pvel.copy(hit).sub(prevHit).divideScalar(Math.max(rawDelta, 1e-4));
          prevHit.copy(hit);
          ptr = { origin: cam.position, dir, vel: pvel };
        }
      } else {
        pointerFresh.current = true;
      }
      wasOver.current = rig.over;

      // the envelope, in sim time (see IDLE); a pointer parked for PARKED_S is "away"
      const e = env.current;
      const t = world.time;
      if (rig.x !== e.rigX || rig.y !== e.rigY) { e.rigX = rig.x; e.rigY = rig.y; e.movedAt = t; }
      const over = rig.over && t - e.movedAt < IDLE.PARKED_S;
      if (e.wasOver && !rig.over) e.aliveUntil = Math.max(e.aliveUntil, t + IDLE.LEAVE_S);
      e.wasOver = over;
      if (!e.wasVisible && visible) e.aliveUntil = Math.max(e.aliveUntil, t + IDLE.VISIBLE_S);
      e.wasVisible = visible;
      const alive = IDLE_FOREVER || over || t < e.aliveUntil;
      e.E = alive ? 1 : Math.max(0, e.E - dt / IDLE.DECAY_S);

      applyDrift(world);
      const r = stepWorld(world, delta, ptr, e.E);

      const te = world.time - (enteredAt.current as number);
      if (te < PERF_WINDOW_S && e.E === 1 && !debug && sampleFrame(perf, rawDelta)) onDegrade();

      // Rest. Without the drift: freeze — no step, no invalidate, until a pointer, click,
      // resize, scroll-end or visibility event wakes it; a box still fading in keeps the loop up
      // until it is whole. With the drift (DRIFTING): never freeze — once settled, E = 0, no
      // live pointer (the PARKED-aware `over`, not rig.over, which clears only on document
      // pointerleave: a reader with the mouse resting on the page is idle, and so is the
      // harness's parked mouse) and nothing faster than DRIFT.IDLE_V (a click with a parked
      // pointer, a harness kick and the scroll-end band exit at up to KEEP_VOUT never touch E
      // and must run at full rate, not 0.2–0.8 u a frame), the next frame is a timer away:
      // 1000 / IDLE_HZ − 16 ms. The timer wakes the loop and the frame lands on the NEXT rAF,
      // so the wall gap is timer + 0–16 ms — at 17 ms it stays ≤ 33 ms, clampDelta's DT_MAX is
      // not hit and sim time tracks wall time (a 33 ms timer would run at 0.7–1.0 × wall and
      // stretch the drift's periods). fiber's invalidate returns early under frameloop "never",
      // so a timer that fires in a hidden tab draws nothing; `visible` clears it anyway.
      if (!DRIFTING) {
        if (keep.current.settled && isResting(world, r, e.E)) frozen.current = true;
        else invalidate();
      } else {
        idle.current = keep.current.settled && e.E === 0 && !over && r.maxDpos / r.dt < DRIFT.IDLE_V;
        if (idle.current) {
          clearIdleTimer.current();
          idleTimer.current = setTimeout(() => { idleTimer.current = null; invalidate(); }, 1000 / DRIFT.IDLE_HZ - 16);
        } else invalidate();
      }
    }

    // The groups follow the bodies by slot (spawn positions included, so the first frame shows
    // the set arriving); a culled slot's group stays invisible. Then the back-to-front rank: each
    // visible group's renderOrder is its body's rank by pos.z ascending (the camera sits at
    // (0, 0, fit.z) unrotated, so pos.z is exact view depth), ties by body index — a stable
    // order. three's transparent list sorts by groupOrder (a Group's renderOrder, inherited by
    // its subtree), then renderOrder, then z, so the list interleaves per jack, farthest first:
    // depth pass (renderOrder 0), colour pass (1), next jack… A nearer jack's pre-pass overwrites
    // the depth where it is nearer and its colour pass blends over the farther jack: glass still
    // shows through glass between jacks. Slots k and k + 8 share a lattice z and cross under the
    // drift — a tie or crossing between jacks in different cells is harmless.
    const bodies = world.bodies;
    const slots_ = slotOf.current;
    for (let slot = 0; slot < groups.current.length; slot++) {
      const g = groups.current[slot];
      if (!g) continue;
      const j = slots_.indexOf(slot);
      g.visible = j >= 0;
      if (j < 0) continue;
      const b = bodies[j];
      g.position.set(b.pos.x, b.pos.y, b.pos.z);
      g.quaternion.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    }
    const ord = order.current;
    ord.length = bodies.length;
    for (let j = 0; j < bodies.length; j++) ord[j] = j;
    ord.sort((a, b) => bodies[a].pos.z - bodies[b].pos.z || a - b);
    for (let k = 0; k < ord.length; k++) {
      const g = groups.current[slots_[ord[k]]];
      if (g) g.renderOrder = k;
    }
  });

  return (
    <>
      {slots.map((s, i) => (
        // one group per slot, moved by the frame loop; two meshes on the shared geometry, both at
        // the slot's scale: the depth pre-pass (renderOrder 0) and the glass (1) — see the header
        <group key={`${count}-${i}-${s.family}-${s.finish}`} ref={(el) => { groups.current[i] = el; }}>
          <mesh geometry={geometry} material={prepassMaterial} scale={scales[i]} renderOrder={0} dispose={null} />
          <mesh geometry={geometry} material={mats[i].material} scale={scales[i]} renderOrder={1} dispose={null} />
        </group>
      ))}
    </>
  );
}

export default function JackFieldScene({ count, accent, theme, visible, rig }: {
  /** 16 at ≥ 1280 × 800, 10 below (fieldLayout.fieldCount) */
  count: number;
  /** the theme's --accent token */
  accent: string;
  theme: "dark" | "light";
  /** the document is visible; off → the loop is "never": no render, no step */
  visible: boolean;
  /** the page's pointer (JackField.tsx's window listener) */
  rig: PointerRig;
}) {
  // Measured step-down, held as Canvas props (R3F re-asserts `dpr` on every Canvas render).
  // Tier 1 drops to DPR 1; tier 2 has nothing left to switch off on glass (a documented no-op).
  const [tier, setTier] = useState(0);
  const debug = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("jacksDebug"), []);
  return (
    <Canvas
      dpr={tier >= 1 ? 1 : [1, 2]}
      frameloop={visible ? "demand" : "never"}
      // Transparent: the jacks sit on the page and over the fluid's dye, no panel. Premultiplied
      // alpha so the antialiased silhouettes composite cleanly over both themes. Neutral tone
      // mapping and exposure 1.0 as the card: the same lamp, the same film.
      gl={{ alpha: true, antialias: true, premultipliedAlpha: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }}
      camera={{ fov: FIELD.FOV, near: FIELD.NEAR, far: FIELD.FAR, position: [0, 0, 34] }}
      onCreated={(state) => {
        state.gl.setClearColor(0x000000, 0);
        // The canvas must never take the pointer: the fluid binds mousemove on ITS canvas beneath
        // this one, and react-three-fiber sets pointer-events: auto on its container and canvas
        // regardless of the host's class (measured: a sweep over the hero delivered 0 mousemove
        // events to the fluid canvas with the field mounted, 13 without it — the dye trail and
        // the name's caustic died). The style prop below covers the container; this covers the
        // canvas. Nothing is lost: the field's ray comes from the window rig, not R3F's events.
        state.gl.domElement.style.pointerEvents = "none";
        // a lost context is kept (preventDefault) and, when the browser gives it back, drawn again
        state.gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
        state.gl.domElement.addEventListener("webglcontextrestored", () => state.invalidate());
      }}
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <directionalLight position={KEY.position} intensity={KEY.intensity} />
      <Field count={count} accent={accent} theme={theme} visible={visible} rig={rig} debug={debug} tier={tier} onDegrade={() => setTier((t) => Math.min(2, t + 1))} />
    </Canvas>
  );
}
