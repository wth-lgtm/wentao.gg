"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DYN, clampDelta, clickWorld, createWorld, isResting, setKeepOut, setView, stepWorld, type KeepOut, type Pointer, type World } from "../lib/jackDynamics";
import { FIELD, LIGHT_WHITE, SEED_FIELD, atPageTop, fieldCamera, fieldCasting, fieldScales, keepOutFor, onScreen, placeWorld, retarget, solveTargets, type FieldFit, type Rect, type Slot } from "../lib/fieldLayout";
import { KEY, NEAR_CORE, NEAR_FALLBACK, RECIPES, colorFor, environmentScene, jackGeometry, makeMaterial } from "../lib/jackMaterials";
import type { PointerRig } from "../lib/pointerRig";
import { createSampler, sampleFrame } from "../lib/scenePerf";

// The three.js side of the jack field (JackField.tsx is the gate). The card's object and the
// card's look, whole — the shared geometry with its baked AO, the seven recipes and the
// neighbour-occlusion shader, the one key and the one-plane environment (jackMaterials.ts) —
// and the card's motion: Lusion's dynamics, the ray-only pointer push with the cursor's
// velocity, the click burst, the swirl × idle envelope, the parked-pointer rule, rest → zero
// frames, the keep-out band, the shared perf sampler. What differs from the card is the frame
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
// - A scroll wakes the field only when it has to: on scroll-end (SCROLL_END_MS) the boxes are
//   re-measured and, if any jack sits inside a live band, the loop runs the frames it takes to
//   clear it. A scroll that leaves nothing under the name renders no frame.
// The visitor card gets a half-strength box while on screen so the map is never obscured.
// Everywhere else the jacks pass BEHIND content: text at z-20 stays on top and glass cards
// blur them. The card's own scene sits in an opaque panel, so the field is hidden behind it.
//
// No wake ribbon: WakeRibbon composites its own frame back with alpha forced to 1 — an opaque
// smear over a transparent canvas — and the fluid already is the page's wake.

// The card's idle envelope (ConnectorField.tsx IDLE), the same numbers on purpose.
const IDLE = { ENTRANCE_S: 10, LEAVE_S: 8, VISIBLE_S: 4, DECAY_S: 2, PARKED_S: 3 } as const;
// Lusion never rests; this site's rule is that a resting scene costs nothing. One flip.
const IDLE_FOREVER = false;
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
// Occlusion neighbours per jack. The card runs count − 1 (11) because its dozen is packed and
// any of them can touch; on a lattice a quarter-viewport apart, jackSphereOcc falls as (r/l)²
// — a 0.55 u core three units away darkens ≤ 3% — so past the eight nearest the loop is
// paid for and invisible. 8 of 15 cuts the fragment loop 47%: at 1440 × 900, DPR 2, the
// sixteen discs cover ≈ 0.84 M device pixels, 6.7 M sphere-occlusion evaluations a frame
// instead of 12.5 M (the card's panel: 0.75 M px × 11 = 8.3 M).
const NEAR_MAX = 8;
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

/** the slot's colour for a theme: the token for the accents, Lusion's light-mode whites in light, the recipe's hex otherwise */
function slotColor(slot: Slot, theme: "dark" | "light", accent: string): THREE.Color {
  if (theme === "light" && slot.family === "white") return new THREE.Color(LIGHT_WHITE[slot.finish]);
  return colorFor(RECIPES[slot.family][slot.finish], accent);
}

interface Debug {
  simTime: number;
  /** sim seconds since the entrance beat, −1 before it */
  entranceT: number;
  frames: number;
  E: number;
  frozen: boolean;
  entered: boolean;
  over: boolean;
  camZ: number;
  tier: number;
  meshes: number;
  /** occlusion neighbours per jack */
  near: number;
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
  const near = Math.max(1, Math.min(NEAR_MAX, count - 1));
  // Materials are born once per count; the theme and the accent recolour IN PLACE (the card's
  // reason: rebuilding disposed the program and recompiled it on every toggle). Sixteen
  // materials, one program (jackMaterials.makeMaterial's one cache key).
  const mats = useMemo(() => slots.map((s) => makeMaterial(RECIPES[s.family][s.finish], near)), [slots, near]);
  useEffect(() => {
    invalidate();
    return () => mats.forEach((m) => m.material.dispose());
  }, [mats, invalidate]);
  useEffect(() => {
    mats.forEach((m, i) => m.material.color.copy(slotColor(slots[i], theme, accent)));
    invalidate();
  }, [accent, theme, mats, slots, invalidate]);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

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
  const frames = useRef(0);
  const firstFrame = useRef(true);
  const env = useRef({ E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false, movedAt: -Infinity, rigX: NaN, rigY: NaN });
  const perf = useMemo(createSampler, []);
  const envOverride = useRef<number | null>(null);

  // the keep-out: measured when scrollY changed, the layout did, or a box is still ramping
  const keep = useRef<{ scrollY: number; boxes: KeepOut[]; h1: KeepOut | null; stale: boolean; settled: boolean; ramps: { h1: Ramp | null; card: Ramp | null } }>({ scrollY: NaN, boxes: [], h1: null, stale: true, settled: true, ramps: { h1: null, card: null } });

  // pointer state, from the field's rig (the gate's window listener)
  const wasOver = useRef(false);
  const pointerFresh = useRef(true);
  const prevHit = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const pvel = useMemo(() => new THREE.Vector3(), []);

  const wake = useRef(() => {
    frozen.current = false;
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
      worldRef.current = world;
    } else {
      setView(world, fit);
      const { targets } = solveTargets(fit, count, SEED_FIELD, scales, avoid, false);
      retarget(world, slotOf.current.map((slot) => targets[slot]));
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

  // Scroll-end: re-measure the boxes for the new scroll; wake only if a jack is inside a live
  // band (the headline landed on resting jacks) — otherwise the scroll draws nothing.
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

  // Perf tier 2: the neighbour loop off (a uniform, no recompile).
  useEffect(() => {
    mats.forEach((m) => { m.uniforms.uNao.value = tier >= 2 ? 0 : 1; });
    invalidate();
  }, [tier, mats, invalidate]);

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
  }, [visible]);

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
      get entered() { return enteredAt.current !== null; },
      get over() { return rig.over; },
      get camZ() { return camera.position.z; },
      get tier() { return tier; },
      get meshes() { return meshes.current.filter((m) => m && m.visible).length; },
      get near() { return near; },
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
      step: (dt: number) => { const wd = world(); if (!wd) return; measureKeepOut(wd.time); stepWorld(wd, dt, null, self.E); invalidate(); },
      kick: (i: number, vx: number, vy: number, vz: number) => { const wd = world(); const b = wd?.bodies[i]; if (wd && b) { b.vel = { x: vx, y: vy, z: vz }; wd.still = 0; wake.current(); } },
      setEnvIntensity: (v: number) => { envOverride.current = v; scene.environmentIntensity = v; invalidate(); },
    };
    return () => { delete w.__field; };
  }, [debug, scales, slots, near, camera, scene, tier, rig, invalidate]);

  // scratch for the nearest-neighbour pick, reused across frames
  const nearScratch = useMemo<{ d: number; q: number }[]>(() => [], []);

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

      const r = stepWorld(world, delta, ptr, e.E);

      const te = world.time - (enteredAt.current as number);
      if (te < PERF_WINDOW_S && e.E === 1 && !debug && sampleFrame(perf, rawDelta)) onDegrade();

      // rest → freeze: no step, no invalidate, until a pointer, click, resize, scroll-end or
      // visibility event wakes it; a box still fading in keeps the loop up until it is whole
      if (keep.current.settled && isResting(world, r, e.E)) frozen.current = true;
      else invalidate();
    }

    // meshes and the neighbour uniforms follow the bodies by slot (spawn positions included, so
    // the first frame shows the set arriving); a culled slot's mesh stays invisible. Each jack
    // hands its shader the NEAR_MAX nearest others; slots beyond the live neighbours hold a
    // far, negligible sphere.
    const bodies = world.bodies;
    const slots_ = slotOf.current;
    for (let slot = 0; slot < meshes.current.length; slot++) {
      const m = meshes.current[slot];
      if (!m) continue;
      const j = slots_.indexOf(slot);
      m.visible = j >= 0;
      if (j < 0) continue;
      const b = bodies[j];
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      m.quaternion.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
      const u = mats[slot].uniforms;
      nearScratch.length = 0;
      for (let q = 0; q < bodies.length; q++) {
        if (q === j) continue;
        const o = bodies[q];
        nearScratch.push({ d: (o.pos.x - b.pos.x) ** 2 + (o.pos.y - b.pos.y) ** 2 + (o.pos.z - b.pos.z) ** 2, q });
      }
      nearScratch.sort((a, c) => a.d - c.d);
      let k = 0, scalar = 0;
      for (let i = 0; i < nearScratch.length && k < u.uNear.value.length; i++) {
        const o = bodies[nearScratch[i].q];
        const rr = NEAR_CORE * scales[slots_[nearScratch[i].q]];
        u.uNear.value[k++].set(o.pos.x, o.pos.y, o.pos.z, rr);
        if (NEAR_FALLBACK) scalar += (rr * rr) / Math.max(nearScratch[i].d, rr * rr);
      }
      for (; k < u.uNear.value.length; k++) u.uNear.value[k].set(0, 0, 1e3, 1e-3);
      if (NEAR_FALLBACK) u.uNaoScalar.value = Math.min(0.6, scalar);
    }
  });

  return (
    <>
      {slots.map((s, i) => (
        <mesh
          key={`${count}-${i}-${s.family}-${s.finish}`}
          ref={(el) => { meshes.current[i] = el; }}
          geometry={geometry}
          material={mats[i].material}
          scale={scales[i]}
          dispose={null}
        />
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
  // Tier 1 drops to DPR 1, tier 2 switches the neighbour occlusion off.
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
