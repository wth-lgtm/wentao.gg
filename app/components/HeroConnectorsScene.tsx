"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DYN, clampDelta, clickWorld, createWorld, isResting, setKeepOut, setView, stepWorld, type KeepOut, type Pointer, type World } from "../lib/jackDynamics";
import { CASTING, HERO, SEED_HERO, heroCamera, keepOut, placeWorld, retarget, targetsFor, type HeroFit, type HeroRects, type Rect, type Slot } from "../lib/heroLayout";
import { KEY, NEAR_CORE, NEAR_FALLBACK, RECIPES, colorFor, environmentScene, jackGeometry, makeMaterial, type Recipe } from "../lib/jackMaterials";
import type { PointerRig } from "../lib/pointerRig";
import { createSampler, sampleFrame } from "../lib/scenePerf";

// Seven of the card's six-way connector jacks around the wordmark: the same object, the same
// look (jackMaterials.ts), the same dynamics (jackDynamics.ts) and the same idle envelope as
// ConnectorField.tsx; what differs is everything around the object — the frame (heroLayout.ts:
// letter-sized, DOM-anchored targets, an edge spawn without a dolly), a keep-out band that
// holds bodies off the letters, and a TRANSPARENT canvas over the page and the fluid instead
// of the card's opaque panel. Seven meshes, one shared geometry, one program; zero frames at
// rest.
//
// No wake ribbon here, and honestly why: WakeRibbon.tsx copies the canvas's own finished frame
// and composites it back with alpha forced to 1 (`vec4(c, 1.0)` before the sRGB encode). Over
// an opaque panel that IS the frame; over this transparent canvas a flick through empty air
// would paint an opaque smear of the clear colour, and the ribbon could never distort the
// fluid or the text, which live in other layers and other contexts. The fluid already IS the
// hero's pointer wake; two wakes on one cursor is the opposite of restraint.

// The card's idle envelope (ConnectorField.tsx IDLE), the same numbers on purpose — two rooms,
// one clock: E = 1 while the pointer moves over the hero and LEAVE_S after it leaves,
// ENTRANCE_S after the entrance, VISIBLE_S on every return to the screen, then a linear fall
// over DECAY_S. A hand parked for PARKED_S counts as away, which matters more here than on
// the card: the hero is the landing viewport and the cursor is usually over it.
const IDLE = { ENTRANCE_S: 10, LEAVE_S: 8, VISIBLE_S: 4, DECAY_S: 2, PARKED_S: 3 } as const;
// Lusion never rests; this site's rule is that a resting scene costs nothing. One flip.
const IDLE_FOREVER = false;
// The DPR step-down samples the first frames after the entrance beat (scenePerf.ts has the rule).
const PERF_WINDOW_S = 5;

// Light theme. The card's recipes were tuned against its opaque PANEL #141518, which made the
// card theme-free by construction; the hero's canvas is transparent, so its whites sit on
// --background #ffffff. The brief's gate: measure matte white #d4d6db on #ffffff and, if the
// lit face is within 8% of the page white, swap the two matte whites for graphite in the
// hero only. Measured (production build, swiftshader, 1440 × 900 light, the resting T1 at
// scale 1.2): over its 18 413 px disc the luminance quartiles were p25 130, p50 199, p75 255,
// with 28.5% of the disc within 8% of white against 24.4% for the black-matte control (whose
// only near-white pixels are the page between its arms) — so about a tenth of the jack's own
// pixels, its key-lit faces, are indistinguishable from the page; the body read by its shade
// side and bores alone. Graphite it is, in the hero only: #52525b is the light theme's
// --legend, so the swap stays inside the palette. The recipe is the legibility proposal's.
const LIGHT_GRAPHITE = true;
const LIGHT_WHITE_MATTE: Recipe = { color: "#52525b", roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5 };
const recipeFor = (slot: Slot, theme: "dark" | "light"): Recipe =>
  LIGHT_GRAPHITE && theme === "light" && slot.family === "white" && slot.finish === "matte" ? LIGHT_WHITE_MATTE : RECIPES[slot.family][slot.finish];

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
  fit: HeroFit | null;
  keepOut: KeepOut | null;
  /** mean |pos − target| over the bodies — the regather measure */
  spread: number;
  /** the least clearance of any body's disc from the inflated keep-out, as the world measures it (negative = over the letters) */
  clearance: number;
  bodies(): { x: number; y: number; z: number; vx: number; vy: number; vz: number; v: number; scale: number; r: number }[];
  step(dt: number): void;
  /** hand a body a velocity — the harness's flick, so the keep-out can be tested without a real pointer at software-GL frame rates */
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

function Field({ count, accent, theme, visible, inView, rig, debug, tier, onDegrade }: {
  count: number;
  accent: string;
  theme: "dark" | "light";
  visible: boolean;
  inView: boolean;
  rig: PointerRig;
  debug: boolean;
  tier: number;
  onDegrade: () => void;
}) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const geometry = useMemo(jackGeometry, []);
  const slots = useMemo(() => CASTING.slice(0, count), [count]);
  const near = Math.max(1, slots.length - 1);
  // Materials are born once per count; the theme and the accent recolour IN PLACE (the card's
  // reason: rebuilding disposed the program and recompiled it on every toggle). The graphite
  // swap is a colour, a roughness and two clearcoat amounts — all uniforms, no recompile.
  const mats = useMemo(() => slots.map((s) => makeMaterial(recipeFor(s, "dark"), near)), [slots, near]);
  useEffect(() => {
    invalidate();
    return () => mats.forEach((m) => m.material.dispose());
  }, [mats, invalidate]);
  useEffect(() => {
    mats.forEach((m, i) => {
      const r = recipeFor(slots[i], theme);
      m.material.color.copy(colorFor(r, accent));
      m.material.roughness = r.roughness;
      m.material.clearcoat = r.clearcoat;
      m.material.clearcoatRoughness = r.clearcoatRoughness;
      m.material.specularIntensity = r.specularIntensity ?? 0.8;
    });
    invalidate();
  }, [accent, theme, mats, slots, invalidate]);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  // The world is born once per count with a provisional fit; its targets, spawn and keep-out
  // come from the DOM in layout() below, before its first frame. Only the soft bounds, the
  // targets and the keep-out follow a resize — bodies are pulled to new points, never moved.
  const fitRef = useRef<HeroFit>(heroCamera(size.width, size.height, 112));
  const keepRef = useRef<KeepOut | null>(null);
  const placed = useRef(false);
  const world = useMemo<World>(() => createWorld(slots.map((s) => s.scale), fitRef.current, SEED_HERO), [slots]);
  const enteredAt = useRef<number | null>(null);
  const frozen = useRef(false);
  const frames = useRef(0);
  const firstFrame = useRef(true);
  const env = useRef({ E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false, movedAt: -Infinity, rigX: NaN, rigY: NaN });
  const perf = useMemo(createSampler, []);
  useEffect(() => { enteredAt.current = null; placed.current = false; env.current = { E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false, movedAt: -Infinity, rigX: NaN, rigY: NaN }; frozen.current = false; }, [world]);

  // pointer state, from the hero rig (the gate's window listener)
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

  // The environment: one PMREM from the shared module scene, once per context, as the card.
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

  // layout(): the DOM rects of the h1, the role line, the card and its CTA (HeroClient.tsx's
  // data-hero-* attributes), relative to the SECTION — the host is its inset-0, so the section's
  // box is the canvas — and the h1's computed font size, into heroLayout's fit, targets and
  // keep-out. The first call places the
  // world (spawn beyond the edges); later calls retarget it. Runs on mount, on a canvas
  // resize, and from a ResizeObserver on the section and the four elements, so the visitor
  // card growing after its fetch nudges the jacks under it rather than snapping them.
  const layout = useRef(() => {});
  layout.current = () => {
    const section = gl.domElement.closest("section");
    const h1 = section?.querySelector<HTMLElement>("[data-hero-h1]") ?? null;
    const role = section?.querySelector<HTMLElement>("[data-hero-role]") ?? null;
    const card = section?.querySelector<HTMLElement>("[data-hero-card]") ?? null;
    const cta = section?.querySelector<HTMLElement>("[data-hero-cta]") ?? null;
    if (!section || !h1 || !role || !card || !cta) return;
    const base = section.getBoundingClientRect();
    if (base.width === 0 || base.height === 0) return;
    const rel = (el: HTMLElement): Rect => { const r = el.getBoundingClientRect(); return { left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top }; };
    const rects: HeroRects = { h1: rel(h1), role: rel(role), card: rel(card), cta: rel(cta) };
    // the size rule reads the wordmark's span (HERO_NAME_METRICS), not the h1 container
    const font = parseFloat(getComputedStyle(h1.querySelector("span") ?? h1).fontSize);
    const fit = heroCamera(base.width, base.height, font);
    fitRef.current = fit;
    setView(world, fit);
    const ko = keepOut(rects, fit);
    keepRef.current = ko;
    setKeepOut(world, [ko], fit.z);
    const targets = targetsFor(rects, fit, world.bodies.length);
    if (!placed.current) { placeWorld(world, targets, fit); placed.current = true; }
    else retarget(world, targets);
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = HERO.FOV;
    cam.near = HERO.NEAR;
    cam.far = HERO.FAR;
    cam.position.set(0, 0, fit.z);
    cam.updateProjectionMatrix();
    invalidate();
  };
  useEffect(() => {
    layout.current();
    const section = gl.domElement.closest("section");
    if (!section) return;
    const ro = new ResizeObserver(() => layout.current());
    ro.observe(section);
    section.querySelectorAll("[data-hero-h1], [data-hero-role], [data-hero-card], [data-hero-cta]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [gl, world, size, camera]);

  // Perf tier 2: the neighbour loop off (a uniform, no recompile).
  useEffect(() => {
    mats.forEach((m) => { m.uniforms.uNao.value = tier >= 2 ? 0 : 1; });
    invalidate();
  }, [tier, mats, invalidate]);

  // The hero's pointer wakes the loop; a move anywhere over the section is enough.
  useEffect(() => {
    rig.bind(wake.current);
    return () => rig.bind(null);
  }, [rig]);

  // Click: Lusion's burst, only for a click on EMPTY hero space. The section is
  // pointer-events-none, so such a click lands on the fluid canvas beneath it (or, were that
  // ever absent, the section itself); anything inside a pointer-events-auto subtree, a link or
  // a button — the visitor card, the "Get in touch" pill, the nav, the scroll arrow — is
  // someone else's click. Gated by the section's rect too: the fluid canvas is fixed and
  // full-viewport, so a click on empty space three sections down also lands on it.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (enteredAt.current === null) return;
      const t = ev.target instanceof Element ? ev.target : null;
      if (!t || t.closest(".pointer-events-auto, a, button")) return;
      const section = gl.domElement.closest("section");
      if (!section) return;
      const onFluid = t instanceof HTMLCanvasElement && t !== gl.domElement;
      if (!onFluid && t !== section) return;
      const r = section.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      clickWorld(world);
      wake.current();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [gl, world]);

  // Back on screen: the frameloop just went never → demand with the clock reset. One frame
  // at 1/60 restarts whatever was still moving and re-arms the envelope.
  useEffect(() => {
    if (visible) { firstFrame.current = true; pointerFresh.current = true; wake.current(); }
  }, [visible]);

  // The entrance starts on the beat the ≥ 30%-visible observer fires.
  useEffect(() => {
    if (inView && enteredAt.current === null) {
      enteredAt.current = world.time;
      env.current.aliveUntil = world.time + IDLE.ENTRANCE_S;
      wake.current();
    }
  }, [inView, world]);

  // ?jacksDebug=1 → window.__heroJacks: sim time (the verification clock — software GL runs at
  // a few fps), the bodies, the fit and keep-out, and a step() and kick() the harness can
  // drive. Ships behind the flag, as the card's does.
  useEffect(() => {
    if (!debug) return;
    const w = window as unknown as { __heroJacks?: Debug };
    const self = env.current;
    w.__heroJacks = {
      get simTime() { return world.time; },
      get entranceT() { return enteredAt.current === null ? -1 : world.time - enteredAt.current; },
      get frames() { return frames.current; },
      get E() { return self.E; },
      get frozen() { return frozen.current; },
      get entered() { return enteredAt.current !== null; },
      get over() { return rig.over; },
      get camZ() { return camera.position.z; },
      get tier() { return tier; },
      get meshes() { return meshes.current.filter(Boolean).length; },
      get fit() { return placed.current ? fitRef.current : null; },
      get keepOut() { return keepRef.current; },
      get spread() { return world.bodies.reduce((n, b) => n + Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z), 0) / world.bodies.length; },
      get clearance() { return keepRef.current ? clearanceOf(world, keepRef.current, world.eyeZ) : Infinity; },
      bodies: () => world.bodies.map((b, i) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, v: Math.hypot(b.vel.x, b.vel.y, b.vel.z), scale: slots[i].scale, r: b.r })),
      step: (dt: number) => { stepWorld(world, dt, null, self.E); invalidate(); },
      kick: (i: number, vx: number, vy: number, vz: number) => { const b = world.bodies[i]; if (b) { b.vel = { x: vx, y: vy, z: vz }; world.still = 0; wake.current(); } },
    };
    return () => { delete w.__heroJacks; };
  }, [debug, world, slots, camera, tier, rig, invalidate]);

  useFrame((_, rawDelta) => {
    frames.current++;
    if (!placed.current) layout.current();
    const entered = enteredAt.current !== null;
    const cam = camera as THREE.PerspectiveCamera;

    if (entered && placed.current && !frozen.current) {
      // dt rules: the first frame after never → demand and after the pointer arrives is 1/60
      // (R3F resets its clock; 0 is Infinity in the pointer terms, the idle gap a 30× flick).
      const delta = firstFrame.current ? DYN.STEP : rawDelta;
      firstFrame.current = false;
      const dt = clampDelta(delta);

      // the cursor ray, only while the pointer is over the hero; NDC from the rig's −0.5..0.5
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

      // rest → freeze: no step, no invalidate, until a pointer or visibility event wakes it
      if (isResting(world, r, e.E)) frozen.current = true;
      else invalidate();
    }

    // meshes and the neighbour uniforms follow the bodies (spawn positions included, so the
    // first frame already shows the set arriving)
    const bodies = world.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const m = meshes.current[i];
      if (!m) continue;
      const b = bodies[i];
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      m.quaternion.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
      const u = mats[i].uniforms;
      let k = 0, scalar = 0;
      for (let j = 0; j < bodies.length; j++) {
        if (j === i) continue;
        const o = bodies[j];
        const rr = NEAR_CORE * slots[j].scale;
        u.uNear.value[k++].set(o.pos.x, o.pos.y, o.pos.z, rr);
        if (NEAR_FALLBACK) {
          const d = Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y, o.pos.z - b.pos.z);
          scalar += (rr * rr) / Math.max(d * d, rr * rr);
        }
      }
      if (NEAR_FALLBACK) u.uNaoScalar.value = Math.min(0.6, scalar);
    }
  });

  return (
    <>
      {slots.map((s, i) => (
        <mesh
          key={`${i}-${s.family}-${s.finish}`}
          ref={(el) => { meshes.current[i] = el; }}
          geometry={geometry}
          material={mats[i].material}
          scale={s.scale}
          dispose={null}
        />
      ))}
    </>
  );
}

export default function HeroConnectorsScene({ count, accent, theme, visible, inView, rig }: {
  /** 7 at ≥ 1280 × 800, 5 below (heroLayout.heroCount) */
  count: number;
  /** the theme's --accent token */
  accent: string;
  theme: "dark" | "light";
  /** ≥ 1% of the hero is on screen; off → the loop is "never": no render, no step */
  visible: boolean;
  /** ≥ 30% of the hero is on screen — the entrance waits for it so it is seen */
  inView: boolean;
  /** the hero's pointer (HeroConnectors.tsx's window listener) */
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
      // Transparent: the jacks sit on the page background and over the fluid's dye, no panel.
      // Premultiplied alpha so the antialiased silhouettes composite cleanly over both themes.
      // Neutral tone mapping and exposure 1.0 as the card: the same lamp, the same film.
      gl={{ alpha: true, antialias: true, premultipliedAlpha: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }}
      camera={{ fov: HERO.FOV, near: HERO.NEAR, far: HERO.FAR, position: [0, 0, 32] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <directionalLight position={KEY.position} intensity={KEY.intensity} />
      <Field count={count} accent={accent} theme={theme} visible={visible} inView={inView} rig={rig} debug={debug} tier={tier} onDegrade={() => setTier((t) => Math.min(2, t + 1))} />
    </Canvas>
  );
}
