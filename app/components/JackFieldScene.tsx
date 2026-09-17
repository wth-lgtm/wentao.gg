"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DYN, clampDelta, clickWorld, createWorld, isResting, setKeepOut, setView, stepWorld, type KeepOut, type Pointer, type World } from "../lib/jackDynamics";
import { FIELD, LIGHT_WHITE, SEED_FIELD, fieldCamera, fieldCasting, fieldScales, keepOutFor, onScreen, placeWorld, retarget, solveTargets, type FieldFit, type Rect, type Slot } from "../lib/fieldLayout";
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
// The keep-out protects the headline ONLY while the hero's h1 is on screen. The layer does not
// scroll, the page does, so the h1's rect is measured again on any frame where scrollY changed
// (one getBoundingClientRect; frames only run while something moves) and converted to a box
// on z = 0; when the hero has scrolled off there is no box. The visitor card gets a half-
// strength box while on screen so the map is never obscured. Everywhere else the jacks pass
// BEHIND content: text at z-20 stays on top and glass cards blur them. The card's own scene
// sits in an opaque panel, so the field is simply hidden behind it — no double scene.
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
  /** the lattice slots culled at birth (fieldLayout.solveTargets) */
  culled: number[];
  fit: FieldFit | null;
  /** the keep-out boxes in force this frame (the h1's, then the card's at half strength) */
  keepOuts: KeepOut[];
  scrollY: number;
  /** mean |pos − target| over the bodies — the regather measure */
  spread: number;
  /** the least clearance of any body's disc from the HEADLINE's inflated box (Infinity when the h1 is off screen) */
  clearance: number;
  bodies(): { x: number; y: number; z: number; vx: number; vy: number; vz: number; v: number; scale: number; r: number }[];
  step(dt: number): void;
  /** hand a body a velocity — the harness's flick, so the keep-out can be tested at software-GL frame rates */
  kick(i: number, vx: number, vy: number, vz: number): void;
}

/** the rounded-box clearance the keep-out step computes, for the debug hook */
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
  const near = Math.max(1, count - 1);
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
  // (a resize) re-solve without culling and retarget — bodies are pulled to the new lattice,
  // never moved — and WAKE the loop: no pointermove reaches the page during a drag-resize, and
  // a frozen pack would otherwise sit over reflowed letters until the next move.
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

  // the keep-out: measured when scrollY changed (or the layout did), in force only while on screen
  const keep = useRef<{ scrollY: number; boxes: KeepOut[]; h1: KeepOut | null; stale: boolean }>({ scrollY: NaN, boxes: [], h1: null, stale: true });

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

  // The environment: one PMREM from the shared one-plane rig, once per context, as the card.
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(environmentScene(), 0, 0.1, 100);
    scene.environment = target.texture;
    scene.environmentIntensity = 1.0;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);

  // layout(): the camera from the wordmark's computed font size (or the 9 u fallback when no
  // h1 is on the page), the lattice solved against whatever of the h1 and the visitor card is
  // on screen right now (fieldLayout.solveTargets), the soft bounds. The first call births the
  // world from the kept slots and spawns it beyond the edges; later calls retarget and wake.
  const layout = useRef(() => {});
  layout.current = () => {
    const span = document.querySelector<HTMLElement>("[data-hero-h1] span");
    const font = span ? parseFloat(getComputedStyle(span).fontSize) : null;
    const fit = fieldCamera(size.width, size.height, font);
    fitRef.current = fit;
    const avoid: KeepOut[] = [];
    const h1 = viewportRect(document.querySelector("[data-hero-h1]"));
    if (h1 && onScreen(h1, fit.width, fit.height)) avoid.push(keepOutFor(h1, fit, 1));
    const card = viewportRect(document.querySelector("[data-hero-card]"));
    if (card && onScreen(card, fit.width, fit.height)) avoid.push(keepOutFor(card, fit, CARD_STRENGTH));
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

  // The keep-out boxes for this scroll position: the h1 at full strength, the visitor card at
  // half, each only while any of it is on screen. One rect read per box per scroll change.
  const measureKeepOut = () => {
    const k = keep.current;
    const world = worldRef.current;
    if (!world) return;
    const y = window.scrollY;
    if (!k.stale && k.scrollY === y) return;
    const fit = fitRef.current;
    const boxes: KeepOut[] = [];
    const h1 = viewportRect(document.querySelector("[data-hero-h1]"));
    k.h1 = h1 && onScreen(h1, fit.width, fit.height) ? keepOutFor(h1, fit, 1) : null;
    if (k.h1) boxes.push(k.h1);
    const card = viewportRect(document.querySelector("[data-hero-card]"));
    if (card && onScreen(card, fit.width, fit.height)) boxes.push(keepOutFor(card, fit, CARD_STRENGTH));
    setKeepOut(world, boxes, fit.z);
    k.boxes = boxes;
    k.scrollY = y;
    k.stale = false;
  };

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
      get culled() { return culledRef.current; },
      get fit() { return worldRef.current ? fitRef.current : null; },
      get keepOuts() { return keep.current.boxes; },
      get scrollY() { return keep.current.scrollY; },
      get spread() { const bs = bodies(); return bs.length ? bs.reduce((n, b) => n + Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z), 0) / bs.length : 0; },
      get clearance() { const wd = world(); return wd && keep.current.h1 ? clearanceOf(wd, keep.current.h1, wd.eyeZ) : Infinity; },
      bodies: () => bodies().map((b, j) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, v: Math.hypot(b.vel.x, b.vel.y, b.vel.z), scale: scales[slotOf.current[j]], r: b.r })),
      step: (dt: number) => { const wd = world(); if (!wd) return; measureKeepOut(); stepWorld(wd, dt, null, self.E); invalidate(); },
      kick: (i: number, vx: number, vy: number, vz: number) => { const wd = world(); const b = wd?.bodies[i]; if (wd && b) { b.vel = { x: vx, y: vy, z: vz }; wd.still = 0; wake.current(); } },
    };
    return () => { delete w.__field; };
  }, [debug, scales, camera, tier, rig, invalidate]);

  useFrame((_, rawDelta) => {
    frames.current++;
    if (!worldRef.current) layout.current();
    const world = worldRef.current;
    if (!world) return;
    const cam = camera as THREE.PerspectiveCamera;

    // The entrance: on the first frame the world exists (the hero is in view on load).
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

      measureKeepOut();

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

      // rest → freeze: no step, no invalidate, until a pointer, click, resize or visibility event wakes it
      if (isResting(world, r, e.E)) frozen.current = true;
      else invalidate();
    }

    // meshes and the neighbour uniforms follow the bodies by slot (spawn positions included, so
    // the first frame shows the set arriving); a culled slot's mesh stays invisible, and the
    // occlusion slots beyond the live neighbours hold a far, negligible sphere
    const bodies = world.bodies;
    const slots = slotOf.current;
    for (let slot = 0; slot < meshes.current.length; slot++) {
      const m = meshes.current[slot];
      if (!m) continue;
      const j = slots.indexOf(slot);
      m.visible = j >= 0;
      if (j < 0) continue;
      const b = bodies[j];
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      m.quaternion.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
      const u = mats[slot].uniforms;
      let k = 0, scalar = 0;
      for (let q = 0; q < bodies.length; q++) {
        if (q === j) continue;
        const o = bodies[q];
        const rr = NEAR_CORE * scales[slots[q]];
        u.uNear.value[k++].set(o.pos.x, o.pos.y, o.pos.z, rr);
        if (NEAR_FALLBACK) {
          const d = Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y, o.pos.z - b.pos.z);
          scalar += (rr * rr) / Math.max(d * d, rr * rr);
        }
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
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <directionalLight position={KEY.position} intensity={KEY.intensity} />
      <Field count={count} accent={accent} theme={theme} visible={visible} rig={rig} debug={debug} tier={tier} onDegrade={() => setTier((t) => Math.min(2, t + 1))} />
    </Canvas>
  );
}
