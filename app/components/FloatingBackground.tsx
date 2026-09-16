"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, applyProps, useFrame, useThree } from "@react-three/fiber";
import {
  Physics,
  RigidBody,
  CuboidCollider,
  RoundCuboidCollider,
  RoundCylinderCollider,
  CapsuleCollider,
  InstancedRigidBodies,
  CoefficientCombineRule,
  useRapier,
  type RapierRigidBody,
  type InstancedRigidBodyProps,
} from "@react-three/rapier";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { easing } from "maath";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HEIGHTS, coverageScale, pourSchedule, rand, shapeOf, sizeOf, trainFor, type Piece, type ShapeKey } from "../lib/commitPile";
import { CAMERA, WORLD, capsFor, fitCamera, mouthFor, type CameraFit } from "../lib/pileScene";
import { KEY_POSITION, SHADOW_AABB, shadowBoundsFor } from "../lib/pileShadow";
import { jitterShade, roughnessFor, shadeFor } from "../lib/pileLook";
import { createPointerRig, type PointerRig } from "../lib/pointerRig";

// ───────────────────────────── the tray ─────────────────────────────
// World-fixed (see pileScene.WORLD); only the camera moves with the canvas. The visible tray
// is one merged geometry — slab plus four lips, corners rounded r 0.04 — in a NEUTRAL zinc,
// not the accent: an accent-tinted floor made the dark theme a navy monochrome in which a
// shadow landing at luminance ~12 on a floor of ~30 was spent on nothing. Pieces carry all
// the accent; the tray carries none, so the blue separates by chroma.
const TH = 0.6; // collider half-thickness (floor and walls)
// The invisible walls reach far above any mouth (≤ 6 u at the narrowest tray that mounts)
// plus a five-rung train; the visible lips are 0.28 u. A wall that stopped short of the
// train lost 1–2 of 200 pieces per pour when a dense train pushed its top sideways.
const WALL_TOP = 14;
// Parked (fixed) bodies wait here; the frame's top edge over the front lip is under 6 u at
// every fit that mounts (4.8 at aspect 1.6), so the park is never drawn in it.
const PARK_Y = 20;
const TRAY_R = 0.04;
// Where two rim parts overlap, the buried one is inset by this much so no two faces are
// coplanar (a 24-bit depth buffer over near 4 / far 40 resolves it; 0.3 px at 72 px/u).
const SEAM = 0.004;

let trayGeometry: THREE.BufferGeometry | null = null;
function getTrayGeometry(): THREE.BufferGeometry {
  if (trayGeometry) return trayGeometry;
  const hx = WORLD.W / 2 + WORLD.LIP;
  const hz = WORLD.D / 2 + WORLD.LIP;
  const part = (w: number, h: number, d: number, x: number, y: number, z: number) => new RoundedBoxGeometry(w, h, d, 2, TRAY_R).translate(x, y, z);
  // Every rounded END is buried inside a neighbour: five RoundedBoxes butted end-to-face left
  // an r 0.04 groove at each rim corner where a rounded end met a flat face. The back lip is
  // full width (its rounded ends ARE the back corners); the side lips run from the front
  // corners into the back lip; the front lip runs into the side lips. Buried ends stop
  // TRAY_R short of the outer face they hide behind.
  const bury = WORLD.LIP - TRAY_R;
  const sideLen = hz + WORLD.D / 2 + bury; // front corner → into the back lip
  const parts = [
    part(2 * hx, WORLD.SLAB_T, 2 * hz, 0, -WORLD.SLAB_T / 2, 0),
    part(2 * hx, WORLD.BACK_H, WORLD.LIP, 0, WORLD.BACK_H / 2, -(WORLD.D / 2 + WORLD.LIP / 2)),
    part(WORLD.LIP - SEAM, WORLD.LIP_H, sideLen, -(WORLD.W / 2 + WORLD.LIP / 2), WORLD.LIP_H / 2, hz - sideLen / 2),
    part(WORLD.LIP - SEAM, WORLD.LIP_H, sideLen, WORLD.W / 2 + WORLD.LIP / 2, WORLD.LIP_H / 2, hz - sideLen / 2),
    part(WORLD.W + 2 * bury, WORLD.LIP_H - SEAM, WORLD.LIP - SEAM, 0, (WORLD.LIP_H - SEAM) / 2, WORLD.D / 2 + WORLD.LIP / 2 - SEAM / 2),
  ];
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  // Remap UVs so the slab's TOP face spans the floor-AO texture (u, v ↔ x, z) and every
  // other vertex samples its white centre: the lips' own box UVs would otherwise read the
  // darkened rim as stripes.
  const pos = merged.attributes.position;
  const nrm = merged.attributes.normal;
  const uv = merged.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    if (nrm.getY(i) > 0.5 && pos.getY(i) > -TRAY_R - 1e-4 && pos.getY(i) < 1e-4) {
      uv.setXY(i, (pos.getX(i) + hx) / (2 * hx), (pos.getZ(i) + hz) / (2 * hz));
    } else {
      uv.setXY(i, 0.5, 0.5);
    }
  }
  uv.needsUpdate = true;
  trayGeometry = merged;
  return merged;
}

// Floor AO, baked: darkens ~25% within 0.4 u of each inner wall face by distance to the
// NEAREST wall (a radial gradient would darken the tray's ends more than its long sides).
// Multiplied into the albedo rather than an aoMap: on a #2a2a2f floor the env-only term an
// aoMap attenuates is ~2% of the pixel, invisible; the junction has to darken the key too.
let floorAo: THREE.CanvasTexture | null = null;
function getFloorAo(): THREE.CanvasTexture {
  if (floorAo) return floorAo;
  const w = 128;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const hx = WORLD.W / 2 + WORLD.LIP;
  const hz = WORLD.D / 2 + WORLD.LIP;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = ((px + 0.5) / w) * 2 * hx - hx;
      const z = ((py + 0.5) / h) * 2 * hz - hz;
      const near = Math.min(WORLD.W / 2 - Math.abs(x), WORLD.D / 2 - Math.abs(z));
      const t = Math.min(1, Math.max(0, near / 0.4));
      const dark = 0.25 * (1 - t * t * (3 - 2 * t));
      const v = Math.round(255 * (1 - dark));
      const o = (py * w + px) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  floorAo = tex;
  return tex;
}

// The tray's own contact with the card: a radial alpha under the slab, centre nudged away
// from the key (−x, +z). Without it the tray floats on the glass — ContactShadows grounds
// the pieces on the tray, nothing grounded the tray on the card.
let haloTex: THREE.CanvasTexture | null = null;
function getHalo(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  // elliptical: a circular gradient on the 2 : 1 canvas still had ~0.66 alpha at the plane's
  // front and back edges, a hard step 0.2 u in front of the slab
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "#fff");
  g.addColorStop(0.55, "#999");
  g.addColorStop(1, "#000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  haloTex = new THREE.CanvasTexture(canvas);
  return haloTex;
}

function Tray({ light }: { light: boolean }) {
  const geometry = useMemo(() => getTrayGeometry(), []);
  const ao = useMemo(() => getFloorAo(), []);
  const halo = useMemo(() => getHalo(), []);
  const hx = WORLD.W / 2 + TH;
  const hz = WORLD.D / 2 + TH;
  return (
    <>
      {/* Grippy, near-dead floor and walls (Min rule: the tray never adds bounce). Walls ≥ 1.2 u
          thick: a capped shove travels V_CAP/60 + contactSkin ≈ 0.17 u per step, well inside. */}
      <RigidBody type="fixed" colliders={false} friction={0.8} restitution={0.05} restitutionCombineRule={CoefficientCombineRule.Min}>
        <CuboidCollider args={[hx + TH, TH, hz + TH]} position={[0, -TH, 0]} />
        <CuboidCollider args={[TH, (WALL_TOP + TH) / 2, hz + TH]} position={[-(WORLD.W / 2 + TH), (WALL_TOP - TH) / 2, 0]} />
        <CuboidCollider args={[TH, (WALL_TOP + TH) / 2, hz + TH]} position={[WORLD.W / 2 + TH, (WALL_TOP - TH) / 2, 0]} />
        <CuboidCollider args={[hx + TH, (WALL_TOP + TH) / 2, TH]} position={[0, (WALL_TOP - TH) / 2, -(WORLD.D / 2 + TH)]} />
        <CuboidCollider args={[hx + TH, (WALL_TOP + TH) / 2, TH]} position={[0, (WALL_TOP - TH) / 2, WORLD.D / 2 + TH]} />
      </RigidBody>
      <mesh geometry={geometry} receiveShadow castShadow>
        <meshStandardMaterial color={light ? "#e4e4e7" : "#2a2a2f"} roughness={light ? 0.8 : 0.85} metalness={0} map={ao} />
      </mesh>
      <mesh position={[-0.15, -WORLD.SLAB_T - 0.01, 0.1]} rotation-x={-Math.PI / 2} renderOrder={-1}>
        <planeGeometry args={[WORLD.W + 2 * WORLD.LIP + 0.4, WORLD.D + 2 * WORLD.LIP + 0.4]} />
        <meshBasicMaterial color="#000" alphaMap={halo} transparent opacity={light ? 0.25 : 0.35} depthWrite={false} />
      </mesh>
    </>
  );
}

// ───────────────────────────── light ─────────────────────────────
// ONE analytic light — the key, up and to the RIGHT (pileShadow.KEY_POSITION) — and the
// room around it: an Environment built from two Lightformers, rendered once through PMREM
// (frames 1, resolution 64, fetches nothing). The environment is FILL, not a lamp: a ceiling
// rect and one former on the key's side aligned with the key direction, so the clearcoat's
// hotspot and the shadow agree; nothing opposite (two mirror-symmetric strips read as two
// lights on every sphere). Re-keyed by the grey-card probe (a roughness-1 plane at the floor,
// key on vs off, read in linear): the design's key 1.8 lit an upright top face to 0.66 of
// the board's level-4 cell — three's directional light is irradiance/π, so a top face equal
// to its albedo needs key·0.777·(1 + env share) ≈ π → key 3.2 put the pile's lit quartile
// at 0.89 of the cell, 3.5 inside the 8% band — and its ceiling former at 1.5 measured 42%
// of the key when the rule is ≤ 30% (a 12 × 6 rect at 8 u subtends ~0.7 sr). Formers at
// 0.68 / 1.1 put the env at ~0.29 of the key in dark. No ambientLight: with an env map it
// double-counts irradiance.
const KEY_INTENSITY = 3.5;
const CEILING_INTENSITY = 0.68;
const SIDE_INTENSITY = 1.1;
const ENV_INTENSITY = { dark: 1.1, light: 0.8 };
const SHADOW = shadowBoundsFor(KEY_POSITION, SHADOW_AABB, 0.2);
// Hoisted: drei re-renders the cube and regenerates the PMREM whenever `children` identity
// changes, and this component re-renders on every CommitHeatmap render.
const KEY_DIR = new THREE.Vector3(...KEY_POSITION).normalize();
const FORMERS = (
  <>
    <Lightformer form="rect" intensity={CEILING_INTENSITY} scale={[12, 6, 1]} position={[0, 8, -4]} rotation={[Math.PI / 2, 0, 0]} />
    <Lightformer form="rect" intensity={SIDE_INTENSITY} scale={[3, 3, 1]} position={[KEY_DIR.x * 6, KEY_DIR.y * 6, KEY_DIR.z * 6]} target={[0, 0, 0]} />
  </>
);

// ───────────────────────────── pieces ─────────────────────────────
// Physical, not matte: roughness per piece (matte/satin/glazed, pileLook.roughnessFor) via a
// per-instance attribute so a family stays one draw, a shared clearcoat, and one procedural
// normal map for grain. At 15–25 px a flat BRDF reads as CG; the env's sheen broken up by a
// surface is what makes #3b82f6 read as a glazed object instead of fill colour.
let grainTex: THREE.CanvasTexture | null = null;
function getGrain(): THREE.CanvasTexture {
  if (grainTex) return grainTex;
  const n = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  let seed = 7;
  const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n * n; i++) {
    const nx = (r() - 0.5) * 0.6;
    const ny = (r() - 0.5) * 0.6;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    img.data[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
    img.data[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    img.data[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  grainTex = tex;
  return tex;
}

let pieceMaterial: THREE.MeshPhysicalMaterial | null = null;
function getPieceMaterial(): THREE.MeshPhysicalMaterial {
  if (pieceMaterial) return pieceMaterial;
  const m = new THREE.MeshPhysicalMaterial({
    // roughness 1 × the per-instance factor below = the piece's own roughness
    roughness: 1,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15,
    normalMap: getGrain(),
    normalScale: new THREE.Vector2(0.07, 0.07),
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "attribute float aRough;\nvarying float vRough;\n#include <common>")
      .replace("#include <begin_vertex>", "vRough = aRough;\n#include <begin_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "varying float vRough;\n#include <common>")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= vRough;");
  };
  pieceMaterial = m;
  return m;
}

// Per-shape feel. Restitution combines by AVERAGE with the tray's 0.05 (the old Max rule
// kept a torus rocking forever); round pieces are damped harder because rapier has no
// rolling resistance and a sphere at angularDamping 0.3 keeps 40% of its spin after 3 s.
const MATERIALS: Record<ShapeKey, { density: number; restitution: number; angularDamping: number; linearDamping: number }> = {
  box: { density: 1.1, restitution: 0.22, angularDamping: 0.35, linearDamping: 0.1 },
  die: { density: 1.2, restitution: 0.22, angularDamping: 0.35, linearDamping: 0.1 },
  domino: { density: 1.1, restitution: 0.22, angularDamping: 0.35, linearDamping: 0.1 },
  puck: { density: 1.3, restitution: 0.15, angularDamping: 0.9, linearDamping: 0.3 },
  capsule: { density: 0.9, restitution: 0.15, angularDamping: 0.9, linearDamping: 0.3 },
  sphere: { density: 0.8, restitution: 0.15, angularDamping: 0.9, linearDamping: 0.3 },
  torus: { density: 0.9, restitution: 0.15, angularDamping: 0.9, linearDamping: 0.3 },
};
const FRICTION = 0.7;

// Unit geometries. The box is baked per LEVEL at the mean width sizeOf draws, so the
// per-instance scale stays within ±15% of uniform and the bevel with it; a unit cube scaled
// 1 : 4 gave a 4 : 1 bevel. Bevels as fractions of the smallest edge: brick 0.08 (the
// design's 0.03 was 0.6 px at 72 px/u — the bricks read as sharp blocks beside rounded
// dice; 0.08 is ~1.5 px and catches the rim light), die 0.09 (real dice), domino 0.15 of its
// thickness. The RoundCuboidCollider radius follows the same number.
const BOX_W = 0.49;
const BEVEL = { box: 0.08, die: 0.09, domino: 0.15 };
const DOMINO = { w: 0.5, t: 0.175, l: 1.0 };
const PUCK = { r: 0.32, h: 0.14 };
const CAPSULE = { r: 0.16, len: 0.3 };
const TORUS = { R: 0.36, r: 0.16 };

interface Group {
  key: ShapeKey;
  /** boxes are grouped per level (one geometry each); other shapes use −1 */
  level: number;
  instances: InstancedRigidBodyProps[];
  /** the piece's index in `pieces` — the seed for its colour, finish and spin */
  idx: number[];
  levels: number[];
  beats: number[];
  rungs: number[];
  rx: number[];
  rz: number[];
}

function geometryFor(g: Group): THREE.BufferGeometry {
  switch (g.key) {
    case "box": {
      const h = HEIGHTS[g.level];
      return new RoundedBoxGeometry(BOX_W, h, BOX_W, 2, BEVEL.box * Math.min(BOX_W, h));
    }
    case "die":
      return new RoundedBoxGeometry(1, 1, 1, 3, BEVEL.die);
    case "domino":
      return new RoundedBoxGeometry(DOMINO.w, DOMINO.t, DOMINO.l, 2, BEVEL.domino * DOMINO.t);
    case "puck":
      return new THREE.CylinderGeometry(PUCK.r, PUCK.r, PUCK.h, 32);
    case "capsule":
      return new THREE.CapsuleGeometry(CAPSULE.r, CAPSULE.len, 4, 12);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 24, 16);
    case "torus":
      return new THREE.TorusGeometry(TORUS.R, TORUS.r, 16, 32);
  }
}

// Colliders match the geometry: a RoundCuboid for every bevelled box (a plain cuboid from
// the bounding box left rounded corners floating r(√3−1) ≈ 4 px off their neighbours), an
// exact capsule, a ball, and ROUND CYLINDERS for the two flat shapes. The design had hulls
// for the puck and the ring; measured, a torus hull is a thin 32-gon disc the solver cannot
// hold still under a stack — one sat 0.04 u INTO the floor vibrating at 0.8 u/s / 10 rad/s
// for a full minute and kept the whole island (and the frameloop) awake. Rapier's own note:
// round shapes settle more stably. The ring's hole is not collidable either way (nothing in
// this size range could pass a 0.2 u hole). Rapier scales explicit args by the instance's
// scale per axis (radius by x), so one node serves every instance.
type AutoCollider = "ball" | "hull" | false;
function collidersFor(g: Group): { auto: AutoCollider; nodes: ReactNode[] } {
  switch (g.key) {
    case "box": {
      const h = HEIGHTS[g.level];
      const r = BEVEL.box * Math.min(BOX_W, h);
      return { auto: false, nodes: [<RoundCuboidCollider key="c" args={[BOX_W / 2 - r, h / 2 - r, BOX_W / 2 - r, r]} />] };
    }
    case "die":
      return { auto: false, nodes: [<RoundCuboidCollider key="c" args={[0.5 - BEVEL.die, 0.5 - BEVEL.die, 0.5 - BEVEL.die, BEVEL.die]} />] };
    case "domino": {
      const r = BEVEL.domino * DOMINO.t;
      return { auto: false, nodes: [<RoundCuboidCollider key="c" args={[DOMINO.w / 2 - r, DOMINO.t / 2 - r, DOMINO.l / 2 - r, r]} />] };
    }
    case "capsule":
      return { auto: false, nodes: [<CapsuleCollider key="c" args={[CAPSULE.len / 2, CAPSULE.r]} />] };
    case "puck":
      return { auto: false, nodes: [<RoundCylinderCollider key="c" args={[PUCK.h / 2 - 0.02, PUCK.r - 0.02, 0.02]} />] };
    case "torus":
      return { auto: false, nodes: [<RoundCylinderCollider key="c" args={[TORUS.r - 0.05, TORUS.R + TORUS.r - 0.05, 0.05]} />] };
    case "sphere":
      return { auto: "ball", nodes: [] };
  }
}

// ───────────────────────────── motion ─────────────────────────────
const SETTLE_MIN = 2.5;
const SETTLE_MAX = 10;
// Rapier sleeps whole contact islands and the pile is one island, so it never reaches the
// engine's own threshold (replicated 90 s in Node: 200/200 awake). So: once no body has
// exceeded the idle speed for IDLE_T seconds of simulated time we put the island to sleep
// ourselves — rapier then has no active body to invalidate() for and the demand frameloop
// stops: no stepping, no setMatrixAt per piece, no draw. The threshold is a visible freeze,
// so it is set in SCREEN space (≈ 50 px/s) and converted at the live px/u: 0.7 u/s on the
// 691 px tray, 0.9 on a 520 px one. A kinetic test, not a pointer one: after a swipe the
// cursor is gone while pieces are still airborne or being recalled by the spring below.
const IDLE_PX = 50;
const IDLE_T = 3;
// How long a pointer can sit still inside the region before it stops counting as a
// shove. Longer than a hand's natural tremor and shorter than the idle window above, so
// a parked cursor lets the pile settle and then sleep rather than holding it awake.
const POINTER_IDLE_MS = 1200;
// The quiet timer is a HARD RESET, not a decaying window: one frame over the idle speed
// discards every second of quiet accumulated before it — a pile still exchanging solver
// kicks has not settled.

// The cursor field — a FORCE model (impulse = force·dt, no ×mass) so heavy pieces resist and
// light ones fly. The pointer ray meets the horizontal plane y = HIT_Y (the heap's
// mid-height); the field is a 3-D ball of radius R about that hit and pushes each body
// horizontally away from it, with a small upward bias, at the body's CENTRE. The old field
// met the vertical z = 0 plane and pushed in x/y from the cursor point: under a camera
// looking down 40° a cursor on the front rim landed the field centre under the floor and
// hoisted the front pieces straight up — a geyser on hover.
// F_BASE is solved so a slow hover (presence floor only) NUDGES a piece rather than lifting
// or launching it: at d = 0.3 the smoothstep is 0.74 (w = 0.667), × FLOOR 0.3 = 0.22, and on
// a 0.03-mass piece F 7 gives 52 u/s² against friction μg = 42 — it slides, but the field
// beats friction only while s(d) > 0.6, i.e. d < 0.39, so a piece that starts at 0.3 u gains
// speed for 0.09 u and coasts to a stop: 0.1–0.3 u of travel, a nudge. Displacing a piece a
// full width is the swipe's job: F_SWIPE brings a full-speed swipe to about the speed cap in
// a tenth of a second on the same mass.
const HIT_Y = 0.35;
const R = 0.9;
const F_BASE = 7;
const F_SWIPE = 1.0;
const V_FULL = 1.8; // cursor speed (u/s) for full swipe strength, ≈ 130 px/s
const FLOOR = 0.3; // presence floor: a slow/parked cursor still shoves
const UP_BIAS = 0.2; // upward component as a fraction of the horizontal push
// Speed caps after a shove come from the frame budget (pileScene.capsFor): a piece may rise
// only to the frame's top edge over the back wall. W_CAP exists because an uncapped spin
// dumps into neighbours as linear speed on the next contact — a 2000 px/s swipe reached
// 190–250 u/s and tunnelled pieces through a wall while the linear cap alone read as met.
// Recall spring in x AND z (a swipe that recalled in x alone migrated the heap to the front
// wall with no way back). K re-solved for g 60: friction μg = 42 u/s² has to be overcome by
// K·pull before a piece slides home at all, so K 60 moves a piece 1 u out in ~0.3 s.
const K = 60;
const C = 2 * Math.sqrt(K) * 0.9; // near-critical damping (zeta 0.9)
const SLACK = 0.6; // recall only pieces shoved beyond ~two widths → the pile reforms organically

// The pour. Pieces are born `fixed`, parked out of frame, and released on 100 ms beats from a
// mouth just above the frame's top edge over the FRONT lip (pileScene.mouthFor, read from
// the live camera fit at release time — the frame's top edge is lane-dependent under a
// tilted camera and the design's fixed 2.7 u sat inside the frame over the front lane at
// the fitted distance). The metre itself (which slot opens on which beat, how tall a train)
// is pourSchedule/trainFor in commitPile.ts, tested there; a slot here is an (x, lane) pair,
// so each beat lays one lane across the tray and the next beat the next lane. Fixed bodies
// ignore each other, so the park can overlap freely.
const BEAT_MS = 100;
const SLOT = 2.2; // × piece scale: clears a tumbled level-4 stick
const V0 = 3; // exit speed downward (u/s) — g 60 needs no help to feel brisk
const VX = 0.3; // a hint of drift toward the right, the way the ripple runs
const GRACE_BEATS = 12; // after the last release, before the pour clock is declared done
const SPAWN_MARGIN = 0.55; // mouth inset from the inner wall, plus a tumbled half-diagonal

interface Layout {
  groups: Group[];
  /** beats the pour takes */
  beats: number;
  k: number;
  slot: number;
}

type Holder = { current: (RapierRigidBody | null)[] | null };

function forEachBody(holders: Holder[], f: (b: RapierRigidBody) => void) {
  for (let gi = 0; gi < holders.length; gi++) {
    const list = holders[gi]?.current;
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b) f(b);
    }
  }
}

const LOOK = new THREE.Vector3(CAMERA.LOOK_AT.x, CAMERA.LOOK_AT.y, CAMERA.LOOK_AT.z);
const DEG = Math.PI / 180;

interface Debug {
  probe: boolean;
}

function Pile({ pieces, accent, card, light, visible, pour, rig, contact, onDegrade, debug }: {
  pieces: readonly Piece[];
  accent: string;
  card: string;
  light: boolean;
  visible: boolean;
  pour: boolean;
  rig: PointerRig;
  contact: boolean;
  onDegrade: () => void;
  debug: Debug | null;
}) {
  const { camera, pointer, gl, scene, size, invalidate } = useThree();
  const { rapier } = useRapier();

  // The camera is fitted to the world-fixed tray whenever the canvas changes size; nothing
  // about the pile moves with it. The fit also carries the mouth height, the idle speed and
  // the shove caps, all read live by the loop.
  // Memoised on `size`: the fit is two 48-step bisections, and this component re-renders on
  // every CommitHeatmap render.
  const fit = useMemo(() => fitCamera(size.width / size.height, size.height), [size]);
  const fitRef = useRef<CameraFit>(fit);
  useEffect(() => {
    fitRef.current = fit;
    camera.position.set(fit.position.x, fit.position.y, fit.position.z);
    camera.lookAt(LOOK);
    invalidate();
  }, [fit, camera, invalidate]);

  // drei's Environment applies environmentIntensity only when its children change, so the
  // theme knob is set here (applyProps, as drei itself does) and a frame asked for.
  useEffect(() => {
    applyProps(scene, { environmentIntensity: light ? ENV_INTENSITY.light : ENV_INTENSITY.dark });
    invalidate();
  }, [scene, light, invalidate]);

  // One entry per group; aligned by group index. InstancedRigidBodies assigns its ref
  // as an OBJECT ref (writes .current) — a function ref silently no-ops — so we hand it
  // stable { current } holders (built with useMemo below) instead of callback refs.
  const homeX = useRef<Float32Array[]>([]);
  const homeZ = useRef<Float32Array[]>([]);
  const massA = useRef<Float32Array[]>([]);
  const captured = useRef(false);
  // Simulated seconds since the pour finished, accumulated from frame deltas clamped the way
  // rapier clamps them: R3F zeroes clock.elapsedTime on every frameloop switch, and the first
  // frame after an idle carries the whole idle as its delta.
  const sinceSpawn = useRef(0);
  const quietFor = useRef(0);
  const nextBeat = useRef(0);
  const pourDone = useRef(false);
  const frames = useRef(0);
  const perf = useRef({ n: 0, sum: 0 });

  const active = useRef(false);
  // When the pointer last MOVED: after POINTER_IDLE_MS of stillness the pile is allowed to
  // settle and sleep; the next pointermove brings it straight back.
  const lastMove = useRef(0);
  const wasActive = useRef(false);
  // persistent vectors (damp3 stashes velocity on `cursor`; finite-diff needs `prev`)
  const cursor = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const prevHit = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const cvel = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const camTarget = useMemo(() => new THREE.Vector3(), []);

  // Shape, size, spin, lane and mouth slot come from rand(i, seed) — texture, not data. Only
  // the colour level (and a box's height, the heatmap's own extrusion) is the commit's. The
  // layout depends on the pieces alone: `position` is a mutable rapier option, so a layout
  // that changed with the canvas re-ran setTranslation on every settled body.
  const layout = useMemo<Layout>(() => {
    const k = coverageScale(pieces);
    const n = pieces.length;
    const slot = SLOT * k;
    const inset = SPAWN_MARGIN + 1.1 * k;
    const span = WORLD.W - 2 * inset;
    const xSlots = Math.max(1, Math.floor(span / slot));
    // spread the slots over the whole span rather than pack them at SLOT: floor() dropped up
    // to a slot's width and the heap landed in the middle 4 u of a 7 u tray
    const pitch = span / xSlots;
    const lanes = WORLD.LANES.length;
    const slots = xSlots * lanes;
    const train = trainFor(n, slots);
    const stops = pourSchedule(n, slots, train);
    const x0 = -span / 2 + pitch / 2;
    const gs = new Map<string, Group>();
    for (let i = 0; i < n; i++) {
      const shape = shapeOf(i);
      const level = pieces[i].level;
      const id = shape === "box" ? `box${level}` : shape;
      let g = gs.get(id);
      if (!g) {
        g = { key: shape, level: shape === "box" ? level : -1, instances: [], idx: [], levels: [], beats: [], rungs: [], rx: [], rz: [] };
        gs.set(id, g);
      }
      const unit = sizeOf(i, shape, level).scale;
      const scale: [number, number, number] =
        shape === "box"
          ? [(unit[0] / BOX_W) * k, (unit[1] / HEIGHTS[level]) * k, (unit[2] / BOX_W) * k]
          : [unit[0] * k, unit[1] * k, unit[2] * k];
      const stop = stops[i];
      const lane = stop.slot % lanes;
      const xi = Math.floor(stop.slot / lanes);
      const rx = x0 + xi * pitch + (rand(i, 5) - 0.5) * 0.3 * k;
      const rz = WORLD.LANES[lane] + (rand(i, 27) - 0.5) * 2 * WORLD.LANE_JITTER;
      g.idx.push(i);
      g.levels.push(level);
      g.beats.push(stop.beat);
      g.rungs.push(stop.rung);
      g.rx.push(rx);
      g.rz.push(rz);
      g.instances.push({
        key: `${id}-${g.instances.length}`,
        type: "fixed",
        position: [rx, PARK_Y, rz],
        rotation: [rand(i, 9) * Math.PI, rand(i, 10) * Math.PI, rand(i, 11) * Math.PI],
        scale,
      });
    }
    const beats = n > 0 ? stops[n - 1].beat + 1 : 0;
    return { groups: [...gs.values()], beats, k, slot };
  }, [pieces]);

  // The React key that remounts the instanced bodies tracks the LAYOUT: a new commit payload
  // — the ISR route refreshing under a card that is already mounted — builds new `instances`
  // with new scales, and react-three-rapier derives a child collider ONCE, never from a later
  // `scale`. The levels are in the string because a day crossing a level boundary changes a
  // piece's height without changing how many pieces each shape has.
  const layoutKey = useMemo(
    () => `${layout.k.toFixed(3)}-${layout.groups.map((g) => g.levels.join("")).join(".")}`,
    [layout]
  );

  // One geometry per group, with the per-instance roughness attribute on it. Disposed with
  // the layout they belong to.
  const geometries = useMemo(
    () =>
      layout.groups.map((g) => {
        const geom = geometryFor(g);
        geom.setAttribute("aRough", new THREE.InstancedBufferAttribute(Float32Array.from(g.idx.map(roughnessFor)), 1));
        return geom;
      }),
    [layout]
  );
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  const material = useMemo(() => getPieceMaterial(), []);

  // One ramp read two ways: the heatmap mixes the accent 18/45/64/82/100% into --card in
  // sRGB, and so does the pile (pileLook.shadeFor) — a level-4 piece's albedo IS the level-4
  // cell. Jittered ±8% lightness / ±4° hue per piece so 192 commits on level-4 days are 192
  // objects, not one extrusion. Kept apart from the layout so a theme flip only recolours.
  const shades = useMemo(() => {
    const acc = accent || "#3b82f6";
    const base = card || (light ? "#f4f4f5" : "#18181b");
    return [0, 1, 2, 3, 4].map((lvl) => shadeFor(lvl, acc, base));
  }, [accent, card, light]);

  const bodyHolders = useMemo<Holder[]>(() => layout.groups.map(() => ({ current: null })), [layout]);
  const meshHolders = useMemo(() => layout.groups.map(() => ({ current: null as THREE.InstancedMesh | null })), [layout]);

  useEffect(() => {
    homeX.current = layout.groups.map((g) => new Float32Array(g.instances.length));
    homeZ.current = layout.groups.map((g) => new Float32Array(g.instances.length));
    massA.current = layout.groups.map((g) => new Float32Array(g.instances.length));
    captured.current = false;
    sinceSpawn.current = 0;
    quietFor.current = 0;
    nextBeat.current = 0;
    pourDone.current = false;
  }, [layout]);

  useEffect(() => {
    const c = new THREE.Color();
    layout.groups.forEach((g, gi) => {
      const mesh = meshHolders[gi]?.current;
      if (!mesh) return;
      for (let i = 0; i < g.levels.length; i++) {
        const [r, gg, b] = jitterShade(shades[g.levels[i]], g.idx[i]);
        mesh.setColorAt(i, c.setRGB(r, gg, b, THREE.SRGBColorSpace));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    invalidate(); // a sleeping pile has no frame coming to show the new colours
  }, [layout, shades, meshHolders, invalidate]);

  // The pour clock. Runs only while the frameloop can (visible) and the tray is on screen
  // (pour), and skips beats in a hidden tab: the sim is frozen there, so a release would
  // stack trains on the same mouth slot to pop apart on return. GRACE_BEATS after the last
  // release the clock stops; there is no ceiling to close any more — the frame's headroom
  // is protected by the speed caps instead.
  useEffect(() => {
    if (!visible || !pour || nextBeat.current >= layout.beats + GRACE_BEATS) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const b = nextBeat.current++;
      if (b < layout.beats) {
        const dynamic = rapier.RigidBodyType.Dynamic;
        const mouth = mouthFor(fitRef.current, layout.k);
        layout.groups.forEach((g, gi) => {
          const list = bodyHolders[gi]?.current;
          if (!list) return;
          for (let i = 0; i < g.beats.length; i++) {
            if (g.beats[i] !== b) continue;
            const body = list[i];
            if (!body) continue;
            const pi = g.idx[i];
            body.setTranslation({ x: g.rx[i], y: mouth + g.rungs[i] * layout.slot, z: g.rz[i] }, false);
            body.setBodyType(dynamic, true);
            body.setLinvel({ x: VX, y: -V0, z: 0 }, true);
            body.setAngvel({ x: (rand(pi, 23) - 0.5) * 3, y: (rand(pi, 24) - 0.5) * 3, z: (rand(pi, 25) - 0.5) * 3 }, true);
          }
        });
        if (b === layout.beats - 1) {
          pourDone.current = true;
          sinceSpawn.current = 0; // the settle window starts when the last train is out
        }
        invalidate();
      } else if (b >= layout.beats + GRACE_BEATS - 1) {
        clearInterval(id);
      }
    }, BEAT_MS);
    return () => clearInterval(id);
  }, [visible, pour, layout, bodyHolders, rapier, invalidate]);

  // Under a demand frameloop nothing draws unless asked: every pointer transition asks for
  // one frame, and the bodies that frame wakes keep the loop alive by themselves after that.
  useEffect(() => {
    const el = gl.domElement;
    const on = () => { active.current = true; lastMove.current = performance.now(); invalidate(); };
    const off = () => { active.current = false; invalidate(); };
    el.addEventListener("pointerenter", on);
    el.addEventListener("pointermove", on);
    el.addEventListener("pointerleave", off);
    el.addEventListener("pointerout", off);
    return () => {
      el.removeEventListener("pointerenter", on);
      el.removeEventListener("pointermove", on);
      el.removeEventListener("pointerleave", off);
      el.removeEventListener("pointerout", off);
    };
  }, [gl, invalidate]);

  // The card's pointer rig asks for a frame on every move so the camera can start drifting;
  // the drift then keeps the loop alive until damp3 says it has arrived.
  useEffect(() => {
    rig.bind(invalidate);
    return () => rig.bind(null);
  }, [rig, invalidate]);

  // Back on screen: the frameloop just went never → demand with the clock reset, and rapier
  // only invalidates from inside a step, so a pile frozen mid-fall would stay frozen until the
  // pointer arrived. One frame restarts whatever was still moving.
  useEffect(() => {
    if (visible) invalidate();
  }, [visible, invalidate]);

  // Dev-only inspection behind ?pileDebug=1: body positions, frame count (a sleeping pile
  // draws none), the live fit, a key-light switch for the grey-card probe and a projector.
  const keyRef = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    if (!debug) return;
    const w = window as unknown as { __pile?: unknown };
    w.__pile = {
      bodies: () => {
        const out: { shape: string; x: number; y: number; z: number; v: number; w: number; asleep: boolean; fixed: boolean }[] = [];
        layout.groups.forEach((g, gi) => {
          const list = bodyHolders[gi]?.current;
          if (!list) return;
          for (const b of list) {
            if (!b) continue;
            const p = b.translation();
            const lv = b.linvel();
            const av = b.angvel();
            out.push({ shape: g.key, x: p.x, y: p.y, z: p.z, v: Math.hypot(lv.x, lv.y, lv.z), w: Math.hypot(av.x, av.y, av.z), asleep: b.isSleeping(), fixed: b.isFixed() });
          }
        });
        return out;
      },
      quietFor: () => quietFor.current,
      frames: () => frames.current,
      fit: () => ({ ...fitRef.current, k: layout.k, mouth: mouthFor(fitRef.current, layout.k), caps: capsFor(fitRef.current, layout.k) }),
      setKey: (on: boolean) => {
        if (keyRef.current) keyRef.current.intensity = on ? KEY_INTENSITY : 0;
        invalidate();
      },
      project: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
      },
    };
    return () => { delete w.__pile; };
  }, [debug, bodyHolders, layout, camera, size, invalidate]);

  useFrame((_, delta) => {
    frames.current++;
    const gb = bodyHolders;
    const fit = fitRef.current;
    const dt = Math.max(1e-4, Math.min(delta, 1 / 30));

    // 0) camera drift: an orbit about the look-at toward the pointer's pose (yaw ±3°, pitch
    //    ±1.5°), critically damped with a 0.35 s time constant — the board's spring is tuned
    //    to the same, so both halves of the card move as one object. Rest when the pointer
    //    has left the card; the return value doubles as the settle flag.
    const yaw = (rig.over ? -rig.x * 2 * CAMERA.YAW_DRIFT : 0) * DEG;
    const elev = (CAMERA.ELEVATION + (rig.over ? rig.y * 2 * CAMERA.PITCH_DRIFT : 0)) * DEG;
    camTarget.set(
      LOOK.x + fit.distance * Math.sin(yaw) * Math.cos(elev),
      LOOK.y + fit.distance * Math.sin(elev),
      LOOK.z + fit.distance * Math.cos(yaw) * Math.cos(elev)
    );
    if (easing.damp3(camera.position, camTarget, 0.35, dt)) {
      camera.lookAt(LOOK);
      invalidate();
    }

    if (!gb.length || homeX.current.length !== layout.groups.length) return;
    sinceSpawn.current += Math.min(delta, 0.5);

    // Frame budget during the pour: if twenty consecutive frames average over 20 ms the
    // canvas steps down (DPR 2 → 1, then no ContactShadows). Only continuous frames count —
    // the first frame after an idle carries the idle as its delta, and the first frames of
    // the pour compile shaders (~150 ms each), which is not the GPU's steady state.
    if (nextBeat.current > 0 && !captured.current && delta < 0.1) {
      const p = perf.current;
      p.n++;
      p.sum += delta;
      if (p.n >= 20) {
        // not under ?pileDebug: software GL always trips the step-down, and a capture
        // without ContactShadows would measure a scene no real GPU shows
        if (p.sum / p.n > 0.02 && !debug) onDegrade();
        p.n = 0;
        p.sum = 0;
      }
    }

    // 1) cursor follower (field centre) + its RAW velocity, on the plane y = HIT_Y. Sampling
    //    speed from the raw hit point — not the low-passed follower — means fast flicks
    //    aren't smoothed away; it divides by the real frame delta, not the clamped dt.
    if (active.current) {
      dir.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
      if (dir.y < -1e-3) {
        hit.copy(camera.position).addScaledVector(dir, (HIT_Y - camera.position.y) / dir.y);
        if (!wasActive.current) { cursor.copy(hit); prevHit.copy(hit); wasActive.current = true; }
        easing.damp3(cursor, hit, 0.05, dt, 60); // snappier centre
        cvel.copy(hit).sub(prevHit).divideScalar(Math.max(delta, 1e-4));
        prevHit.copy(hit);
      }
    } else {
      wasActive.current = false;
      cvel.set(0, 0, 0);
    }
    const speed = active.current ? Math.hypot(cvel.x, cvel.z) : 0;
    const sf = Math.min(1, Math.pow(speed / V_FULL, 1.5)); // super-linear: a flick ≫ a drag

    // 2) the pile's peak speed — read once, for the settle capture and the idle test. Nothing
    //    is captured while trains are still parked: a fixed body reads 0 u/s and a home taken
    //    at the park would recall the piece to the sky. The idle test does not wait for the
    //    capture: a pour interrupted by a scroll would otherwise hold the loop at full rate.
    const t = sinceSpawn.current;
    const settling = !captured.current && pourDone.current && t > SETTLE_MIN;
    const idling = !active.current || performance.now() - lastMove.current > POINTER_IDLE_MS;
    let maxV2 = 0;
    if (settling || idling) {
      const outX = WORLD.W / 2 + 1.5;
      const outZ = WORLD.D / 2 + 1.5;
      for (let gi = 0; gi < gb.length; gi++) {
        const list = gb[gi]?.current;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (!b) continue;
          // A piece that has tunnelled out of the box would fall forever and hold the loop
          // awake for nothing visible. Park it where it is and leave it out of the quiet test.
          const p = b.translation();
          if (p.y < -1.5 || Math.abs(p.x) > outX || Math.abs(p.z) > outZ) {
            if (!b.isSleeping()) b.sleep();
            continue;
          }
          const lv = b.linvel();
          const s2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
          if (s2 > maxV2) maxV2 = s2;
        }
      }
    }

    // capture the settled pile as home (x, z) once it has come to rest
    const captureHomes = () => {
      for (let gi = 0; gi < gb.length; gi++) {
        const list = gb[gi]?.current;
        if (!list) continue;
        const HX = homeX.current[gi];
        const HZ = homeZ.current[gi];
        const MA = massA.current[gi];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (!b) continue;
          const p = b.translation();
          HX[i] = p.x;
          HZ[i] = p.z;
          MA[i] = b.mass();
        }
      }
      captured.current = true;
    };
    if (settling && (maxV2 < 0.5 || t > SETTLE_MAX)) captureHomes();

    // idle → sleep the whole island. Quiet time runs on the delta rapier itself integrates
    // (clamped to 0.5 s), so a 10 fps tab and a 120 Hz one agree on "3 s".
    const idleV = IDLE_PX / fit.pxPerUnit;
    if (idling) {
      quietFor.current = maxV2 < idleV * idleV ? quietFor.current + Math.min(delta, 0.5) : 0;
      if (quietFor.current >= IDLE_T) {
        quietFor.current = 0;
        // Last chance to read where the pile came to rest: `settling` waits on SETTLE_MIN
        // while the quiet test does not, and after the sleep nothing invalidates.
        if (!captured.current && pourDone.current) captureHomes();
        forEachBody(gb, (b) => b.sleep());
        return;
      }
    } else {
      quietFor.current = 0;
    }

    const pushing = active.current; // presence floor → shove even when slow
    const cx = cursor.x;
    const cy = cursor.y;
    const cz = cursor.z;
    const { vCap, wCap } = capsFor(fit, layout.k);

    for (let gi = 0; gi < gb.length; gi++) {
      const list = gb[gi]?.current;
      if (!list) continue;
      const HX = homeX.current[gi];
      const HZ = homeZ.current[gi];
      const MA = massA.current[gi];
      if (!HX) continue;

      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b) continue;
        const p = b.translation();

        if (pushing) {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const dz = p.z - cz;
          const d = Math.hypot(dx, dy, dz);
          if (d < R) {
            if (b.isSleeping()) b.wakeUp(); // wake the region so support-loss can fall
            const w = 1 - d / R;
            const s = w * w * (3 - 2 * w); // smoothstep → soft palm, no edge pop
            const strength = s * (FLOOR + (1 - FLOOR) * sf);
            const inv = 1 / (Math.hypot(dx, dz) || 1e-4);
            const fx = (dx * inv * F_BASE + cvel.x * F_SWIPE) * strength;
            const fz = (dz * inv * F_BASE + cvel.z * F_SWIPE) * strength;
            const fy = UP_BIAS * Math.hypot(fx, fz);
            // impulse = force·dt (frame-rate independent), at the centre: the tipping comes
            // from friction at the contact, as it does for a real finger
            b.applyImpulse({ x: fx * dt, y: fy * dt, z: fz * dt }, true);
            const v = b.linvel();
            const sp = Math.hypot(v.x, v.y, v.z);
            if (sp > vCap) { const kk = vCap / sp; b.setLinvel({ x: v.x * kk, y: v.y * kk, z: v.z * kk }, true); }
            const av = b.angvel();
            const ws = Math.hypot(av.x, av.y, av.z);
            if (ws > wCap) { const kk = wCap / ws; b.setAngvel({ x: av.x * kk, y: av.y * kk, z: av.z * kk }, true); }
            continue; // being pushed → no recall this frame
          }
        }

        // 3) horizontal recall to home — loose & far-only, so the pile reforms organically
        //    instead of snapping into columns. Sleeping pieces stay put (anti-jitter).
        if (!captured.current || b.isSleeping()) continue;
        const dX = HX[i] - p.x;
        const dZ = HZ[i] - p.z;
        const dist = Math.hypot(dX, dZ);
        const slack = SLACK * (0.8 + 0.4 * rand(i, 21)); // per-piece slack → no unison return
        if (dist > slack) {
          const v = b.linvel();
          const pull = (dist - slack) / dist; // ramps in from zero → no teleport-home
          const m = MA[i] || b.mass();
          b.applyImpulse({ x: (K * dX * pull - C * v.x) * m * dt, y: 0, z: (K * dZ * pull - C * v.z) * m * dt }, true);
        }
      }
    }
  });

  return (
    <>
      <directionalLight
        ref={keyRef}
        position={KEY_POSITION}
        intensity={KEY_INTENSITY}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.03}
      >
        <orthographicCamera attach="shadow-camera" args={[SHADOW.left, SHADOW.right, SHADOW.top, SHADOW.bottom, SHADOW.near, SHADOW.far]} />
      </directionalLight>
      <Environment resolution={64} frames={1}>
        {FORMERS}
      </Environment>
      <Tray light={light} />
      {/* Soft contact pool under the pieces, inner floor only (the walls fall outside its
          footprint), far 1.0 so a second layer already saturates the blob. It re-renders on
          every drawn frame and so stops with the pile. */}
      {contact && <ContactShadows position={[0, 0.001, 0]} scale={[WORLD.W, WORLD.D]} far={1} blur={1.5} resolution={256} opacity={light ? 0.4 : 0.25} />}
      {debug?.probe && (
        <mesh position={[4.1, 0.001, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.5, 0.5]} />
          <meshStandardMaterial color="#808080" roughness={1} metalness={0} toneMapped={false} />
        </mesh>
      )}
      {layout.groups.map((g, gi) => {
        const mat = MATERIALS[g.key];
        const col = collidersFor(g);
        return (
          <InstancedRigidBodies
            key={`${g.key}${g.level}-${layoutKey}`}
            ref={bodyHolders[gi]}
            instances={g.instances}
            colliders={col.auto}
            colliderNodes={col.nodes}
            density={mat.density}
            friction={FRICTION}
            restitution={mat.restitution}
            restitutionCombineRule={CoefficientCombineRule.Average}
            linearDamping={mat.linearDamping}
            angularDamping={mat.angularDamping}
            // contactSkin 0.015 held resting bodies 0.015 u apart — 0.45 px at 30 px/u, a
            // hairline at 72. Soft CCD covers the fall instead: the bottom rung lands from
            // the 4.1 u mouth at ~22 u/s (0.37 u per step against 0.2 u pieces), and on the
            // narrowest tray that mounts a five-rung train's top rung starts near 8.2 u and
            // arrives at ~32 u/s = 0.53 u/step, so the prediction sits above that with a
            // margin (asserted in tests/pile-scene.test.ts).
            contactSkin={0.004}
            softCcdPrediction={0.6}
          >
            <instancedMesh
              ref={meshHolders[gi]}
              args={[geometries[gi], material, g.instances.length]}
              count={g.instances.length}
              frustumCulled={false}
              castShadow
              receiveShadow
            />
          </InstancedRigidBodies>
        );
      })}
    </>
  );
}

export default function FloatingBackground({
  pieces,
  accent,
  card,
  light = false,
  active = true,
  pour = true,
  rig,
}: {
  /** One per dated commit in the grid's window, oldest first; the level is the day's. */
  pieces: readonly Piece[];
  accent: string;
  /** The theme's --card, the rest end of the ramp; falls back per theme when unread. */
  card: string;
  light?: boolean;
  /** Card within its mount margin. Off → the loop is "never": no render, no step, no wake. */
  active?: boolean;
  /** The tray itself is on screen — the pour waits for it so it is seen, not inferred. */
  pour?: boolean;
  /** The card's shared pointer; without one the camera holds its rest pose. */
  rig?: PointerRig;
}) {
  const localRig = useMemo(() => createPointerRig(), []);
  // Measured step-down, held as Canvas props: R3F re-asserts its `dpr` prop on every
  // Canvas render, so a setDpr() from inside the loop would be undone by the next theme
  // flip. Tier 1 drops to DPR 1, tier 2 also drops the ContactShadows passes.
  const [tier, setTier] = useState(0);
  const debug = useMemo<Debug | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    return q.has("pileDebug") ? { probe: q.has("pileProbe") } : null;
  }, []);
  return (
    <Canvas
      dpr={tier >= 1 ? 1 : [1, 2]}
      shadows="soft"
      // "demand": rapier invalidate()s once per active body after each step, so the drop and
      // every shove sustain the loop themselves and the settled, sleeping pile costs nothing.
      // "never" while the card is offscreen — rapier steps inside useFrame, so this parks the
      // world too, and the pile resumes exactly where it froze instead of raining in again.
      frameloop={active ? "demand" : "never"}
      // Neutral tone mapping: ACES (R3F's default) and AgX both pull the brand blue toward a
      // primary and halve its saturation (#3b82f6 → S 0.52 under AgX); Khronos Neutral is the
      // identity below 0.76 and keeps H ±3°, S ±0.06, so the pile's level-4 tops land on the
      // board's cell colour. Exposure is the theme knob.
      gl={{ alpha: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: light ? 1.05 : 0.95 }}
      camera={{ fov: CAMERA.FOV, near: CAMERA.NEAR, far: CAMERA.FAR, position: [0, 11, 13] }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
      }}
      // grab: the force field is live over the whole tray, including the air above the pile,
      // and the default arrow said nothing about it.
      style={{ width: "100%", height: "100%", cursor: "grab" }}
    >
      <Suspense fallback={null}>
        {/* interpolate is off: react-three-rapier only lerps the `mesh` branch — an instanced
            body is written straight from the step (esm.js "instancedMesh" → setMatrix) — so the
            flag bought nothing but a translation()+rotation() snapshot of every body per step.
            12 solver iterations were tuned for the stacked heap; kept until measured. */}
        <Physics gravity={[0, -WORLD.G, 0]} timeStep={1 / 60} interpolate={false} numSolverIterations={12} numInternalPgsIterations={1}>
          <Pile
            pieces={pieces}
            accent={accent}
            card={card}
            light={light}
            visible={active}
            pour={pour}
            rig={rig ?? localRig}
            contact={tier < 2}
            onDegrade={() => setTier((t) => Math.min(2, t + 1))}
            debug={debug}
          />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
