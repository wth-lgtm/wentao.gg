"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEED, unknownOverride, type Jack } from "../lib/connectorJacks";
import { CAMERA, PANEL, cameraFor, type CameraFit } from "../lib/connectorScene";
import { GLASS } from "../lib/glassLook";
import { DYN, clampDelta, clickWorld, createWorld, isResting, setView, stepWorld, type Pointer, type World } from "../lib/jackDynamics";
import { depthPrepassMaterial, dressGlass, makeGlassMaterial, rankByDepth } from "../lib/jackGlass";
import { KEY, environmentScene, jackGeometry } from "../lib/jackMaterials";
import type { PointerRig } from "../lib/pointerRig";
import { createSampler, sampleFrame } from "../lib/scenePerf";
import WakeRibbon from "./WakeRibbon";

// Twelve six-way connector jacks, one per week of the board's window, floating in Lusion's
// dynamics (jackDynamics.ts) under Lusion's framing (connectorScene.ts). What lives here is
// the three.js side of THIS scene only: the entrance, the idle envelope and the demand loop
// that stops when nothing moves. The jack's look — the shared geometry, the one-plane
// environment and the key light (jackMaterials.ts), worn as the hero's TINTED GLASS
// (jackGlass.ts builds it, glassLook.ts is the table): a depth pre-pass and one glass pass per
// jack on ONE program, the groups ranked back to front each frame — is the page's jack field's
// (JackFieldScene.tsx) by construction: both scenes import the one module, which is what makes
// "exactly like the jacks on hero" (the owner, 2026-09-17) true by a number. The plastic round's
// seven opaque recipes, AO bake and neighbour-occlusion loop are gone with it (glass takes no
// contact crease; the hero's header has the measurements). The panel is opaque and #141518 in
// BOTH themes (connectorScene.PANEL), so the card always wears the DARK recipes and the panel's
// own colour shows through the glass; the accent token is the one themed input. The pointer's
// wake ribbon (WakeRibbon.tsx) sits beside it in the Canvas: it owns the render each frame
// (gl.render at priority 1 — the transparent list's sort and the two-pass draw are three's, so
// its frame is the frame R3F would draw) so it can composite over the finished panel, and a
// decaying field is the one other reason the demand loop stays awake.

// The idle envelope E ∈ [0, 1] scales the swirl and gates the friction that lets the pack
// rest. 1 while the pointer is anywhere over the CARD (the scene is alive before the cursor
// reaches the column) and for LEAVE_S after it leaves; 1 for ENTRANCE_S after the entrance;
// re-armed for VISIBLE_S on every return to the screen; then a linear fall to 0 over DECAY_S.
// All in SIM time — a hidden tab or a 4 fps run does not expire them while nothing moved.
// "Over" means over AND moving: a hand parked for PARKED_S counts as away (the ray stays
// live, the next move re-arms E), so a cursor resting on the card lets the pack rest instead
// of holding twelve draws a frame — the pile had a 1.2 s parked-cursor idle for the same reason.
const IDLE = { ENTRANCE_S: 10, LEAVE_S: 8, VISIBLE_S: 4, DECAY_S: 2, PARKED_S: 3 } as const;
// Lusion never rests; this site's rule is that a resting scene costs nothing. One flip.
const IDLE_FOREVER = false;

// Lusion's intro: bodies fly in from the spawn box while the camera dollies from 25 to 17.5
// (1.43×) over homePage.time 0.3–2 s with ease.backOut — the pile forms while the camera
// arrives. No scale-in: a jack at scale 0.3 travelling 6 u is invisible for most of its path.
const ENTRANCE = { T0: 0.3, T1: 2.0 } as const;
const backOut = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// The DPR step-down samples the first frames after the entrance beat (scenePerf.ts has the rule).
const PERF_WINDOW_S = 5;

interface Debug {
  simTime: number;
  /** sim seconds since the entrance beat, −1 before it */
  entranceT: number;
  frames: number;
  E: number;
  frozen: boolean;
  entered: boolean;
  overCanvas: boolean;
  camZ: number;
  tier: number;
  /** mean |pos − target| over the bodies — the regather measure */
  spread: number;
  /** the jacks drawn: visible groups */
  meshes: number;
  /** visible meshes under visible groups: 2 × the jacks drawn (the depth pre-pass and the glass) */
  passes: number;
  /** the groups' renderOrder in body order: the back-to-front rank (a permutation of 0..n−1, ascending with pos.z) */
  renderOrders: number[];
  /** gl.info.programs.length (the wake ribbon adds its own), and how many of them carry GLASS.PROGRAM_KEY (must be 1: the pre-pass and every glass share it) */
  programs: number;
  glassPrograms: number;
  bodies(): { x: number; y: number; z: number; vx: number; vy: number; vz: number; v: number; scale: number; known: boolean }[];
  step(dt: number): void;
}

function Field({ jacks, accent, visible, inView, rig, debug, tier, onDegrade }: {
  jacks: readonly Jack[];
  accent: string;
  visible: boolean;
  inView: boolean;
  rig: PointerRig;
  debug: boolean;
  tier: number;
  onDegrade: () => void;
}) {
  const { gl, scene, camera, size, pointer, invalidate } = useThree();
  const geometry = useMemo(jackGeometry, []);
  // The theme's accent is the only themed thing in here (the panel is #141518 in both, so the
  // card always wears the DARK recipes), and a flip recolours IN PLACE: rebuilding the twelve
  // materials disposed the old set before the new one had rendered, which drove the program's
  // usedTimes to 0, destroyed it and recompiled it (~150 ms) on every toggle. Twelve uniform
  // writes and one frame instead. Twelve glass materials (jackGlass.ts, the hero's), one program
  // (GLASS.PROGRAM_KEY); a known week wears its slot's tint, an unknown week the ghost
  // (jackGlass.dressGlass branches, so a flip never wipes the ghost back to its family's tint).
  const mats = useMemo(() => jacks.map((j) => makeGlassMaterial(j, "dark", "#3b82f6")), [jacks]);
  useEffect(() => {
    invalidate();
    return () => mats.forEach((m) => m.material.dispose());
  }, [mats, invalidate]);
  useEffect(() => {
    mats.forEach((m, i) => dressGlass(m, jacks[i], jacks[i].known, "dark", accent));
    invalidate();
  }, [accent, mats, jacks, invalidate]);
  // one group per jack: the depth pre-pass mesh and the glass mesh on the shared geometry
  const groups = useRef<(THREE.Group | null)[]>([]);
  const prepassMaterial = useMemo(depthPrepassMaterial, []);
  /** the bodies' depths this frame, for the back-to-front rank (jackGlass.rankByDepth; no allocation past the first frame) */
  const zs = useRef<number[]>([]);

  // The world is born once per set of jacks, with the camera fit at that moment; only the
  // soft bounds follow a resize (setView). A new payload (the ISR route refreshing under a
  // mounted card) is a new world and a new entrance — the sizes are its data.
  const fitRef = useRef<CameraFit>(cameraFor(size.width, size.height));
  const world = useMemo<World>(() => createWorld(jacks.map((j) => j.scale), fitRef.current, SEED), [jacks]);
  const enteredAt = useRef<number | null>(null);
  const frozen = useRef(false);
  const frames = useRef(0);
  const firstFrame = useRef(true);
  const env = useRef({ E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false, movedAt: -Infinity, rigX: NaN, rigY: NaN });
  const perf = useMemo(createSampler, []);
  useEffect(() => { enteredAt.current = null; env.current = { E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false, movedAt: -Infinity, rigX: NaN, rigY: NaN }; frozen.current = false; }, [world]);

  // pointer state on the CANVAS (the rig is the card's)
  const overCanvas = useRef(false);
  const pointerFresh = useRef(true);
  const prevHit = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const pvel = useMemo(() => new THREE.Vector3(), []);

  const wake = useRef(() => {
    frozen.current = false;
    invalidate();
  });

  // The environment: one PMREM from the module scene, once per context. 256 cubeUV is what
  // fromScene produces at every input resolution, and it is enough — the key plane at ~8 u
  // subtends ~28°, crisp in mirror clearcoat.
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

  // Camera: FOV 25, fixed, no parallax; the distance is solved per canvas. Between frames the
  // loop owns z (the dolly); when the loop is frozen the resize has to place it itself.
  useEffect(() => {
    const fit = cameraFor(size.width, size.height);
    fitRef.current = fit;
    setView(world, fit);
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = CAMERA.FOV;
    cam.near = CAMERA.NEAR;
    cam.far = CAMERA.FAR;
    const t = enteredAt.current === null ? 0 : world.time - enteredAt.current;
    cam.position.set(0, 0, dollyZ(fit.z, t));
    cam.updateProjectionMatrix();
    invalidate();
  }, [size, camera, world, invalidate]);

  // The card's pointer wakes the loop; a move over the board is enough.
  useEffect(() => {
    rig.bind(wake.current);
    return () => rig.bind(null);
  }, [rig]);

  // Canvas-level pointer: over/out decides whether the ray acts; the first frame after enter
  // integrates 1/60 and zeroes the cursor velocity (a stale hit from the leave seconds ago,
  // divided by a clamped 1/30, was a 30× fake flick). Click: Lusion's burst, fine pointers
  // only — the scene mounts only for them.
  useEffect(() => {
    const el = gl.domElement;
    const enter = () => { overCanvas.current = true; pointerFresh.current = true; firstFrame.current = true; wake.current(); };
    const leave = () => { overCanvas.current = false; wake.current(); };
    const click = () => { if (enteredAt.current !== null) { clickWorld(world); wake.current(); } };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("click", click);
    };
  }, [gl, world]);

  // Back on screen: the frameloop just went never → demand with the clock reset. One frame
  // at 1/60 restarts whatever was still moving and re-arms the envelope.
  useEffect(() => {
    if (visible) { firstFrame.current = true; pointerFresh.current = true; wake.current(); }
  }, [visible]);

  // The entrance starts on the beat the ≥ 30%-visible observer fires — not the 300 px arm
  // margin, or the fly-in plays below the fold.
  useEffect(() => {
    if (inView && enteredAt.current === null) {
      enteredAt.current = world.time;
      env.current.aliveUntil = world.time + IDLE.ENTRANCE_S;
      wake.current();
    }
  }, [inView, world]);

  // ?jacksDebug=1: sim time (the verification clock — software GL runs at a few fps), the
  // bodies, and a step() the harness can drive. Ships in production behind the flag — the
  // design's gated fallback; the §9 harness reads it against the production build.
  useEffect(() => {
    if (!debug) return;
    const w = window as unknown as { __jacks?: Debug };
    const self = env.current;
    w.__jacks = {
      get simTime() { return world.time; },
      get entranceT() { return enteredAt.current === null ? -1 : world.time - enteredAt.current; },
      get frames() { return frames.current; },
      get E() { return self.E; },
      get frozen() { return frozen.current; },
      get entered() { return enteredAt.current !== null; },
      get overCanvas() { return overCanvas.current; },
      get camZ() { return camera.position.z; },
      get tier() { return tier; },
      get spread() { return world.bodies.reduce((n, b) => n + Math.hypot(b.pos.x - b.target.x, b.pos.y - b.target.y, b.pos.z - b.target.z), 0) / world.bodies.length; },
      get meshes() { return groups.current.filter((g) => g && g.visible).length; },
      get passes() { return groups.current.reduce((n, g) => n + (g && g.visible ? g.children.filter((c) => c.visible).length : 0), 0); },
      get renderOrders() { return groups.current.map((g) => g?.renderOrder ?? -1); },
      get programs() { return gl.info.programs?.length ?? 0; },
      get glassPrograms() { return (gl.info.programs ?? []).filter((p) => p.cacheKey.includes(GLASS.PROGRAM_KEY)).length; },
      bodies: () => world.bodies.map((b, i) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, v: Math.hypot(b.vel.x, b.vel.y, b.vel.z), scale: jacks[i].scale, known: jacks[i].known })),
      step: (dt: number) => { stepWorld(world, dt, null, self.E); invalidate(); },
    };
    return () => { delete w.__jacks; };
  }, [debug, world, jacks, camera, tier, gl, invalidate]);

  useFrame((_, rawDelta) => {
    frames.current++;
    const fit = fitRef.current;
    const entered = enteredAt.current !== null;
    const cam = camera as THREE.PerspectiveCamera;

    if (entered && !frozen.current) {
      // dt rules: the first frame after never → demand and after pointerenter is 1/60 (R3F
      // resets its clock; 0 is Infinity in the pointer terms, the idle gap a 30× flick).
      const delta = firstFrame.current ? DYN.STEP : rawDelta;
      firstFrame.current = false;
      const dt = clampDelta(delta);

      // the cursor ray, only while the pointer is over the CANVAS
      let ptr: Pointer | null = null;
      if (overCanvas.current) {
        dir.set(pointer.x, pointer.y, 0.5).unproject(cam).sub(cam.position).normalize();
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

      // the envelope, in sim time; a pointer parked for PARKED_S is "away" (see IDLE), and the
      // leave tail is for a cursor that leaves while LIVE — a parked one is already resting
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

      // the dolly, on the same clock
      const te = world.time - (enteredAt.current as number);
      const z = dollyZ(fit.z, te);
      const dollying = te < ENTRANCE.T1;
      if (cam.position.z !== z) cam.position.z = z;

      if (te < PERF_WINDOW_S && e.E === 1 && !debug && sampleFrame(perf, rawDelta)) onDegrade();

      // rest → freeze: no step, no invalidate, until a pointer or visibility event wakes it
      if (!dollying && isResting(world, r, e.E)) frozen.current = true;
      else invalidate();
    }

    // The groups follow the bodies (spawn positions included, so the first frame already shows
    // the set), then the back-to-front rank (jackGlass.rankByDepth): the camera sits at (0, 0, z)
    // unrotated, so pos.z is exact view depth, and three's transparent list interleaves per jack,
    // farthest first — depth pass, glass, next jack — which is what lets a nearer jack's glass
    // blend over a farther one's in the packed dozen. The hero's exact pattern.
    const bodies = world.bodies;
    const depth = zs.current;
    depth.length = bodies.length;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      depth[i] = b.pos.z;
      const g = groups.current[i];
      if (!g) continue;
      g.position.set(b.pos.x, b.pos.y, b.pos.z);
      g.quaternion.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    }
    rankByDepth(groups.current, depth);
  });

  return (
    <>
      {jacks.map((j, i) => (
        // one group per jack, moved by the frame loop; two meshes on the shared geometry, both at
        // the jack's scale: the depth pre-pass (renderOrder 0) and the glass (1) — see jackGlass.ts
        <group key={`${j.week}-${j.family}-${j.finish}`} ref={(el) => { groups.current[i] = el; }}>
          <mesh geometry={geometry} material={prepassMaterial} scale={j.scale} renderOrder={0} dispose={null} />
          <mesh geometry={geometry} material={mats[i].material} scale={j.scale} renderOrder={1} dispose={null} />
        </group>
      ))}
    </>
  );
}

/** the camera's z at `t` seconds after the entrance beat */
function dollyZ(z: number, t: number): number {
  const k = Math.min(1, Math.max(0, (t - ENTRANCE.T0) / (ENTRANCE.T1 - ENTRANCE.T0)));
  return z * (CAMERA.DOLLY_FROM + (1 - CAMERA.DOLLY_FROM) * backOut(k));
}

export default function ConnectorField({
  jacks,
  accent,
  active = true,
  inView = false,
  rig,
}: {
  /** one per week of the board's window, oldest first */
  jacks: readonly Jack[];
  /** the theme's --accent token */
  accent: string;
  /** the card is within its mount margin; off → the loop is "never": no render, no step */
  active?: boolean;
  /** ≥ 30% of the column is on screen — the entrance waits for it so it is seen */
  inView?: boolean;
  /** the card's shared pointer */
  rig: PointerRig;
}) {
  // Measured step-down, held as Canvas props: R3F re-asserts `dpr` on every Canvas render,
  // so a setDpr() from inside the loop would be undone by the next theme flip. Tier 1 drops
  // to DPR 1; tier 2 has nothing left to switch off on glass (the plastic round's neighbour
  // loop is gone) — a documented no-op, as the hero's.
  const [tier, setTier] = useState(0);
  const debug = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("jacksDebug"), []);
  // ?jacksDebug=1&jacksUnknown=N: the oldest N weeks drawn as ghosts on a payload that has no cut,
  // so the ghost glass can be seen and cropped (the harness's zoomCard). A debug lever, not data:
  // the legend is CommitHeatmap's and states only the payload's real cut.
  const shown = useMemo(() => {
    const n = debug ? unknownOverride(window.location.search) : 0;
    return n > 0 ? jacks.map((j, i) => (i < n ? { ...j, known: false } : j)) : jacks;
  }, [jacks, debug]);
  return (
    <Canvas
      dpr={tier >= 1 ? 1 : [1, 2]}
      // "demand": every frame that moves anything asks for the next; a resting pack asks for
      // none. "never" while the card is outside its margin — the world only steps inside
      // useFrame, so this parks it too, and it resumes where it froze.
      frameloop={active ? "demand" : "never"}
      // Opaque, the panel colour: the reference IS a dark inset on a light page, so the same
      // panel in both themes makes the light theme first-class by construction and gives the
      // wake ribbon (WakeRibbon.tsx) a finished frame to composite over. Neutral tone mapping: ACES
      // (R3F's default) and AgX both pull the brand blue toward a primary and halve its
      // saturation (#3b82f6 → S 0.52 under AgX); Khronos Neutral is the identity below 0.76
      // and keeps H ±3°, S ±0.06. Exposure 1.0 in both themes — the panel is the same.
      gl={{ alpha: false, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }}
      camera={{ fov: CAMERA.FOV, near: CAMERA.NEAR, far: CAMERA.FAR, position: [0, 0, CAMERA.Z_MIN * CAMERA.DOLLY_FROM] }}
      onCreated={({ gl }) => {
        gl.setClearColor(PANEL);
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <directionalLight position={KEY.position} intensity={KEY.intensity} />
      <Field jacks={shown} accent={accent} visible={active} inView={inView} rig={rig} debug={debug} tier={tier} onDegrade={() => setTier((t) => Math.min(2, t + 1))} />
      <WakeRibbon rig={rig} visible={active} debug={debug} />
    </Canvas>
  );
}
