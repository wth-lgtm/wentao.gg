"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEED, type Family, type Finish, type Jack } from "../lib/connectorJacks";
import { CAMERA, PANEL, cameraFor, type CameraFit } from "../lib/connectorScene";
import { buildJackGeometry } from "../lib/jackGeometry";
import { DYN, clampDelta, clickWorld, createWorld, isResting, setView, stepWorld, type Pointer, type World } from "../lib/jackDynamics";
import type { PointerRig } from "../lib/pointerRig";
import { createSampler, sampleFrame } from "../lib/scenePerf";

// Twelve six-way connector jacks, one per week of the board's window, floating in Lusion's
// dynamics (jackDynamics.ts) under Lusion's framing (connectorScene.ts). What lives here is
// the three.js side only: the shared geometry, the seven materials and their neighbour-
// occlusion shader, the one-plane environment, the entrance, the idle envelope and the
// demand loop that stops when nothing moves.

// There is ONE key light on this site and it sits up and to the RIGHT — the direction the
// board's extruded cells (CommitHeatmap FACE_LIT/FACE_SHADE) and the hero's caustic are
// painted for. Lusion's own key is (10, 10, 5), the same quadrant. 2.2 with the environment
// below; it was 3.5 when the pile had no environment at all.
const KEY = { position: [6, 8, 2.5] as [number, number, number], intensity: 2.2 };

// The environment is one emissive plane on the key's side plus a uniform grey floor —
// house rule: a shaped former is a lamp, an unshaped floor is fill. The glossy jacks are
// near-mirrors (clearcoat 1, clearcoatRoughness 0.06–0.08) and reflect every shaped emitter
// as its own rectangle, so a ceiling rect and two side panels read as three extra lights on
// exactly the family whose look is "black reads only through what it reflects". The floor
// gives black a Fresnel silhouette without a second highlight. Built with three core (~25
// lines) rather than drei's Environment, which statically imports gainmap-js, RGBELoader,
// EXRLoader and GroundProjectedEnv (772 KB dist) even when it fetches nothing.
const ENV = { plane: [6, 4] as [number, number], position: [5, 6, 4] as [number, number, number], intensity: 4, floor: 0.15 };

// The idle envelope E ∈ [0, 1] scales the swirl and gates the friction that lets the pack
// rest. 1 while the pointer is anywhere over the CARD (the scene is alive before the cursor
// reaches the column) and for LEAVE_S after it leaves; 1 for ENTRANCE_S after the entrance;
// re-armed for VISIBLE_S on every return to the screen; then a linear fall to 0 over DECAY_S.
// All in SIM time — a hidden tab or a 4 fps run does not expire them while nothing moved.
const IDLE = { ENTRANCE_S: 10, LEAVE_S: 8, VISIBLE_S: 4, DECAY_S: 2 } as const;
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

// Per-mesh neighbour occlusion: the other bodies as spheres of their CORE radius (0.55·scale
// — the 1.05 body sphere is ~70% empty and at contact subtends 90°, a smudge not a crease),
// iq's sphere occlusion with the horizon clamp, multiplied, capped at 60% darkening. The
// scalar fallback (one strength per mesh from the same distances) is selected at build time,
// never by a runtime probe: flip NEAR_FALLBACK if the injection ever misbehaves on a driver.
const NEAR_CORE = 0.55;
const NEAR_FALLBACK = false;

// ---- geometry, shared by every mesh and never disposed with one ----
let JACK: THREE.BufferGeometry | null = null;
const jackGeometry = () => (JACK ??= buildJackGeometry());

// ---- materials ----
// MeshPhysicalMaterial, metalness 0, specularIntensity 0.8 (F0 0.032 — plastic and enamel,
// not glass) unless stated. The matte accent is color-mix(accent 85%, black): the token under
// a strong key reads pastel, and the reference's matte cobalt is darker than its gloss. Matte
// black is #26262b, not the token-dark #111114: the latter is darker than the panel and its
// lit face computed to #13 — a hole with a rim. The reference floors its diffuse at 0.25.
type Recipe = { color: string | "accent" | "accent-matte"; roughness: number; clearcoat: number; clearcoatRoughness: number; specularIntensity?: number };
const RECIPES: Record<Family, Record<Finish, Recipe>> = {
  accent: {
    matte: { color: "accent-matte", roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5 },
    glossy: { color: "accent", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 },
  },
  white: {
    matte: { color: "#d4d6db", roughness: 0.72, clearcoat: 0.1, clearcoatRoughness: 0.6 },
    glossy: { color: "#e8e9ee", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 },
  },
  black: {
    matte: { color: "#26262b", roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35, specularIntensity: 1.0 },
    glossy: { color: "#0b0b0e", roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 },
  },
};
// An unknown week (the route's paging cut off before it began) is a ghost: the panel lightened
// 8%, matte, no clearcoat — outside the casting so it cannot be read as a quiet white or black.
const GHOST: Recipe = { color: "#2a2a30", roughness: 0.8, clearcoat: 0, clearcoatRoughness: 0 };

/** The token is a hex string; the matte accent keeps 85% of it in sRGB, as color-mix would. */
function setAccent(target: THREE.Color, accent: string, keep: number) {
  const c = new THREE.Color(accent);
  const rgb = { r: 0, g: 0, b: 0 };
  c.getRGB(rgb, THREE.SRGBColorSpace);
  target.setRGB(rgb.r * keep, rgb.g * keep, rgb.b * keep, THREE.SRGBColorSpace);
}

function colorFor(recipe: Recipe, accent: string): THREE.Color {
  const c = new THREE.Color();
  if (recipe.color === "accent") setAccent(c, accent, 1);
  else if (recipe.color === "accent-matte") setAccent(c, accent, 0.85);
  else c.set(recipe.color);
  return c;
}

interface JackUniforms {
  uNear: { value: THREE.Vector4[] };
  /** 1 = the neighbour occlusion is on; 0 = off (the perf tier's second step) */
  uNao: { value: number };
  /** the scalar fallback's darkening for this mesh, 0..0.6 */
  uNaoScalar: { value: number };
}

// iq's sphere occlusion (iquilezles.org/articles/sphereao): (r/l)²·max(0, n·l̂) in the far
// field, the exact integral where the sphere crosses the horizon.
const nearGlsl = (count: number) => /* glsl */ `
#define NEAR_COUNT ${count}
uniform vec4 uNear[NEAR_COUNT];
uniform float uNao;
uniform float uNaoScalar;
varying float vAo;
varying vec3 vWorldPos;
float jackSphereOcc(vec3 p, vec3 n, vec4 sph) {
  vec3 di = sph.xyz - p;
  float l = length(di);
  float nl = dot(n, di / l);
  float h = max(l / sph.w, 1.0001);
  float h2 = h * h;
  float k2 = 1.0 - h2 * nl * nl;
  float res = max(0.0, nl) / h2;
  if (k2 > 0.0) {
    res = nl * acos(-nl * sqrt((h2 - 1.0) / max(1e-6, 1.0 - nl * nl))) - sqrt(k2 * (h2 - 1.0));
    res = res / h2 + atan(sqrt(k2 / (h2 - 1.0)));
    res /= 3.141593;
  }
  return clamp(res, 0.0, 1.0);
}
float jackNeighbourAo(vec3 p, vec3 n) {
  float ao = 1.0;
  for (int i = 0; i < NEAR_COUNT; i++) ao *= 1.0 - jackSphereOcc(p, n, uNear[i]);
  return max(0.4, ao);
}
`;
// Replaces <aomap_fragment>: the bake and the neighbour term on indirect diffuse and (via
// computeSpecularOcclusion) indirect specular, half the neighbour term on DIRECT diffuse —
// three's AO is indirect-only and the crease would vanish under the key — and the bake alone
// on the clearcoat's indirect term. The neighbour term stays off the clearcoat in PR A.
const AO_GLSL = /* glsl */ `
  float nao = 1.0;
  ${NEAR_FALLBACK
    ? "nao = 1.0 - uNaoScalar;"
    : "if (uNao > 0.0) nao = mix(1.0, jackNeighbourAo(vWorldPos, inverseTransformDirection(normal, viewMatrix)), uNao);"}
  float jackOcc = vAo * nao;
  reflectedLight.indirectDiffuse *= jackOcc;
  reflectedLight.directDiffuse *= mix(1.0, nao, 0.5);
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= vAo;
  #endif
  float jackDotNV = saturate(dot(geometryNormal, geometryViewDir));
  reflectedLight.indirectSpecular *= computeSpecularOcclusion(jackDotNV, jackOcc, material.roughness);
`;

function makeMaterial(jack: Jack, accent: string, near: number): { material: THREE.MeshPhysicalMaterial; uniforms: JackUniforms } {
  const recipe = jack.known ? RECIPES[jack.family][jack.finish] : GHOST;
  const uniforms: JackUniforms = {
    uNear: { value: Array.from({ length: near }, () => new THREE.Vector4(0, 0, 0, 1e-3)) },
    uNao: { value: 1 },
    uNaoScalar: { value: 0 },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: colorFor(recipe, accent),
    metalness: 0,
    roughness: recipe.roughness,
    clearcoat: recipe.clearcoat,
    clearcoatRoughness: recipe.clearcoatRoughness,
    specularIntensity: recipe.specularIntensity ?? 0.8,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float ao;\nvarying float vAo;\nvarying vec3 vWorldPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvAo = ao;\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + nearGlsl(near))
      .replace("#include <aomap_fragment>", AO_GLSL);
  };
  // The twelve materials differ only in uniforms (colour, roughness, clearcoat amounts) and
  // the same injected source, so they share ONE program (two, with the clearcoat-less
  // ghost) — a key per family/finish would compile six identical ones. The default key is
  // onBeforeCompile.toString(); explicit is free and does not hang on a closure's text.
  material.customProgramCacheKey = () => "jack";
  return { material, uniforms };
}

// ---- environment ----
let envScene: THREE.Scene | null = null;
function environmentScene(): THREE.Scene {
  if (envScene) return envScene;
  const s = new THREE.Scene();
  const key = new THREE.Mesh(
    new THREE.PlaneGeometry(ENV.plane[0], ENV.plane[1]),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.intensity, ENV.intensity, ENV.intensity), side: THREE.DoubleSide, toneMapped: false }),
  );
  key.position.set(...ENV.position);
  key.lookAt(0, 0, 0);
  s.add(key);
  s.background = new THREE.Color(ENV.floor, ENV.floor, ENV.floor);
  envScene = s;
  return s;
}

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
  const near = Math.max(1, jacks.length - 1);
  // The theme's accent is the only themed thing in here (the panel is the same in both); a
  // flip rebuilds the twelve materials, which recompiles nothing — they share one program.
  const mats = useMemo(() => jacks.map((j) => makeMaterial(j, accent, near)), [jacks, accent, near]);
  useEffect(() => {
    invalidate();
    return () => mats.forEach((m) => m.material.dispose());
  }, [mats, invalidate]);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  // The world is born once per set of jacks, with the camera fit at that moment; only the
  // soft bounds follow a resize (setView). A new payload (the ISR route refreshing under a
  // mounted card) is a new world and a new entrance — the sizes are its data.
  const fitRef = useRef<CameraFit>(cameraFor(size.width, size.height));
  const world = useMemo<World>(() => createWorld(jacks.map((j) => j.scale), fitRef.current, SEED), [jacks]);
  const enteredAt = useRef<number | null>(null);
  const frozen = useRef(false);
  const frames = useRef(0);
  const firstFrame = useRef(true);
  const env = useRef({ E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false });
  const perf = useMemo(createSampler, []);
  useEffect(() => { enteredAt.current = null; env.current = { E: 0, aliveUntil: -Infinity, wasOver: false, wasVisible: false }; frozen.current = false; }, [world]);

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

  // Perf tier 2: the neighbour loop off (a uniform, no recompile).
  useEffect(() => {
    mats.forEach((m) => { m.uniforms.uNao.value = tier >= 2 ? 0 : 1; });
    invalidate();
  }, [tier, mats, invalidate]);

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
    if (visible) { firstFrame.current = true; wake.current(); }
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
  // bodies, and a step() the harness can drive.
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
      bodies: () => world.bodies.map((b, i) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, v: Math.hypot(b.vel.x, b.vel.y, b.vel.z), scale: jacks[i].scale, known: jacks[i].known })),
      step: (dt: number) => { stepWorld(world, dt, null, self.E); invalidate(); },
    };
    return () => { delete w.__jacks; };
  }, [debug, world, jacks, camera, tier, invalidate]);

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

      // the envelope, in sim time
      const e = env.current;
      const t = world.time;
      if (e.wasOver && !rig.over) e.aliveUntil = Math.max(e.aliveUntil, t + IDLE.LEAVE_S);
      e.wasOver = rig.over;
      if (!e.wasVisible && visible) e.aliveUntil = Math.max(e.aliveUntil, t + IDLE.VISIBLE_S);
      e.wasVisible = visible;
      const alive = IDLE_FOREVER || rig.over || t < e.aliveUntil;
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

    // meshes and the neighbour uniforms follow the bodies (spawn positions included, so the
    // first frame already shows the set)
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
        const rr = NEAR_CORE * jacks[j].scale;
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
      {jacks.map((j, i) => (
        <mesh
          key={`${j.week}-${j.family}-${j.finish}`}
          ref={(el) => { meshes.current[i] = el; }}
          geometry={geometry}
          material={mats[i].material}
          scale={j.scale}
          dispose={null}
        />
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
  // to DPR 1, tier 2 switches the neighbour occlusion off.
  const [tier, setTier] = useState(0);
  const debug = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("jacksDebug"), []);
  return (
    <Canvas
      dpr={tier >= 1 ? 1 : [1, 2]}
      // "demand": every frame that moves anything asks for the next; a resting pack asks for
      // none. "never" while the card is outside its margin — the world only steps inside
      // useFrame, so this parks it too, and it resumes where it froze.
      frameloop={active ? "demand" : "never"}
      // Opaque, the panel colour: the reference IS a dark inset on a light page, so the same
      // panel in both themes makes the light theme first-class by construction and gives the
      // wake ribbon (PR B) a finished frame to composite over. Neutral tone mapping: ACES
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
      <Field jacks={jacks} accent={accent} visible={active} inView={inView} rig={rig} debug={debug} tier={tier} onDegrade={() => setTier((t) => Math.min(2, t + 1))} />
    </Canvas>
  );
}
