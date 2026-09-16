"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider, InstancedRigidBodies, CoefficientCombineRule, useRapier, type RapierRigidBody, type InstancedRigidBodyProps } from "@react-three/rapier";
import { easing } from "maath";
import * as THREE from "three";
import type { Piece } from "../lib/commitPile";

// Deterministic pseudo-random (stable across renders → no hydration drift).
function rand(i: number, seed: number): number {
  return Math.abs(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1;
}

// The tray. The sim box used to BE the clip rectangle (walls at ±hw, floor at −hh), so every
// piece touching an edge was guillotined by the region's overflow: rotation is free on all
// three axes and a corner at z = 1.3 projects 11/(11−1.3) = 13% outward. The walls now sit a
// unit inside the frame and the floor 0.7 u above it, and the container is real geometry lit
// by the same key as the pieces: a slab whose top face reads as a ~28 px perspective band and
// two lips whose inner faces read as wedges. Perspective check (camera z 11, factor
// 11/(11−z)): the slab's front-bottom edge at y = −hh+0.58, z = 0.9 projects to −4.33 > −hh
// (−4.556), and a lip's outer top corner at z = 0.7 to (hw−0.88)·1.068 < hw for hw ≥ 5.4 —
// so the tray is never itself clipped. (The originally proposed −hh+0.55 with z ±1.3 came
// out at −4.67: cut by the frame it was meant to replace.)
const INSET = 1.0; // wall inner face, inside the frame edge
const FLOOR_LIFT = 0.7; // floor top above the frame bottom
const TH = 0.6; // floor / ceiling / z-wall collider half-thickness
// Side walls are thick, outward. They follow the live viewport while the pile does not, so a
// narrowing window drives them INTO the edge pieces; penetration resolves toward the nearest
// face of the collider, and with a 1.2 u wall moved 1.2 u the nearest face was the outer one
// — 1100→1000 px pushed 6 of 165 pieces out of the tray. At 4 u no narrowing short of the
// re-lay threshold (RELAY_FRAC of hw, ≈1.7 u) can put a piece past the middle.
const WALL_T = 4;
const HZ = 1.3; // z half-depth pieces may tumble in
const SLAB = { t: 0.12, d: 2.2, z: -0.2 };
const LIP = { t: 0.12, h: 0.3, d: 2.0, z: -0.3 };
// Ceiling underside as a fraction of hh: a top face at hh with the piece tumbled to z = 0.95
// still projects inside the frame. It exists only once the pour is in, or nothing could
// enter from the mouth above.
const CEIL = 0.92;

// Static floor + walls confining the sim to the tray. Grippy + near-zero bounce so the floor
// is not a trampoline. The walls reach `top`, the highest point a released train occupies:
// a dense re-lay into a narrow region pushes its topmost pieces sideways, and walls that
// stopped short of the spawn lost 1–2 of 200 per re-lay at 800 px (0 once enclosed).
function Tray({ hw, hh, top, poured, color }: { hw: number; hh: number; top: number; poured: boolean; color: THREE.Color }) {
  const inner = hw - INSET;
  const floorTop = -hh + FLOOR_LIFT;
  return (
    <>
      <RigidBody type="fixed" colliders={false} friction={0.6} restitution={0.02}>
        <CuboidCollider args={[inner + TH, TH, HZ + TH]} position={[0, floorTop - TH, 0]} />
        <CuboidCollider args={[WALL_T, top, HZ + TH]} position={[-inner - WALL_T, 0, 0]} />
        <CuboidCollider args={[WALL_T, top, HZ + TH]} position={[inner + WALL_T, 0, 0]} />
        <CuboidCollider args={[inner + TH, top, TH]} position={[0, 0, -HZ - TH]} />
        <CuboidCollider args={[inner + TH, top, TH]} position={[0, 0, HZ + TH]} />
        {poured && <CuboidCollider args={[inner + TH, TH, HZ + TH]} position={[0, CEIL * hh + TH, 0]} />}
      </RigidBody>
      {/* Matte like the pieces — the level-0 shade of the current theme, so the tray is the
          quiet end of the same ramp the heatmap's rest cells sit on. */}
      <mesh position={[0, floorTop - SLAB.t / 2, SLAB.z]}>
        <boxGeometry args={[2 * inner, SLAB.t, SLAB.d]} />
        <meshStandardMaterial color={color} roughness={0.92} metalness={0} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (inner + LIP.t / 2), floorTop + LIP.h / 2, LIP.z]}>
          <boxGeometry args={[LIP.t, LIP.h, LIP.d]} />
          <meshStandardMaterial color={color} roughness={0.92} metalness={0} />
        </mesh>
      ))}
    </>
  );
}

const SETTLE_MIN = 2.5;
const SETTLE_MAX = 10;
// Rapier sleeps whole contact islands and the pile is one island, so it never reaches the
// engine's own threshold (replicated 90 s in Node: 200/200 awake). Nor does it ever go quiet
// by itself: the Max-restitution round pieces keep a torus wobbling on the floor at ~6 rad/s
// and a sphere rolling at 0.5 u/s indefinitely, so the settled pile's peak speed keeps
// spiking to 0.6–1.0 u/s, now and then past it, forever (per-frame trace over 30 s in
// Chrome: 90% of frames above 0.15 u/s, longest quiet run 4 frames — "all under 0.15 for six
// frames" fired once, at 38 s; at 1.0 one run stayed awake 17 s). So: once no body has
// exceeded IDLE_V for IDLE_T seconds of simulated time we put the island to sleep ourselves —
// rapier then has no active body to invalidate() for and the demand frameloop stops: no
// stepping, no setMatrixAt per piece, no draw. 1.5 u/s is ~57 px/s here, 50% over the creep
// peaks; anything airborne passes it within 125 ms under g = 12, a recall slide is faster or
// friction-locked, and a rolling sphere decays home inside 3 s. A kinetic test, not a pointer
// one: after a swipe the cursor is gone while pieces are still airborne or being recalled by
// the spring below.
const IDLE_V = 1.5;
const IDLE_T = 3;
// soft cursor field — a FORCE model (impulse = force·dt, no ×mass) so heavy pieces resist
// and light ones fly: weight becomes visible, and the shove is frame-rate independent.
const R = 2.6; // influence radius
const F_BASE = 26; // radial "presence" force
const F_SWIPE = 6; // swipe / cursor-momentum coupling
const V_FULL = 4.5; // cursor speed (u/s) for full swipe strength
const FLOOR = 0.3; // presence floor: a slow/parked cursor still shoves
// Speed caps after a shove. V_CAP 7 → a piece can rise at most 7²/24 ≈ 2 u, so nothing
// launched from the pile's crest reaches the frame top (at 11 the rise was 5 u against a
// 4.6 u half-height). W_CAP is new: the impulse lands AT the cursor point, so its torque was
// uncapped, and a spinning body dumps that energy into its neighbours as linear speed on the
// next contact — a 2000 px/s swipe reached 190–250 u/s and tunnelled 1–6 pieces through a
// wall (3/3 trials on the old rig) while the linear cap alone read as satisfied.
const V_CAP = 7;
const W_CAP = 12; // rad/s
// horizontal return spring (gravity owns the vertical axis → no hover/float)
const K = 8; // gentler homing (was 14)
const C = 2 * Math.sqrt(K) * 0.9; // near-critical damping (zeta 0.9)
const SLACK = 1.1; // recall only pieces shoved beyond this → pile reforms organically, not in columns

// "Lego land" — a mixed pile of geometric primitives instead of only bars. Each kind is
// its own instanced group with a matching auto-collider (cuboid/ball, convex hull otherwise).
type Collider = "cuboid" | "ball" | "hull";
const SHAPE_DEFS: { key: string; collider: Collider }[] = [
  { key: "box", collider: "cuboid" },
  { key: "sphere", collider: "ball" },
  { key: "cone", collider: "hull" },
  { key: "octa", collider: "hull" },
  { key: "tetra", collider: "hull" },
  { key: "torus", collider: "hull" },
  { key: "ico", collider: "hull" },
];
// Weighted picker — the box brick stays the most common so it still reads as a heatmap pile.
const PICK = [0, 0, 0, 1, 2, 3, 4, 5, 6];
// Cross-section of a unit-scale primitive facing the camera (× s²), for the fill rule.
const AREA: Record<string, number> = { sphere: 0.79, cone: 0.52, octa: 0.77, tetra: 0.55, torus: 0.72, ico: 0.8 };
// A box's height is the heatmap's own extrusion for that level; every other shape is a
// uniform scale so it keeps its silhouette.
const HEIGHTS = [0.34, 0.62, 0.96, 1.35, 1.85];

function shapeOf(i: number) {
  return SHAPE_DEFS[PICK[Math.floor(rand(i, 7) * PICK.length)]];
}
function sizeOf(i: number, key: string, level: number): { scale: [number, number, number]; area: number } {
  if (key === "box") {
    const w = 0.42 + rand(i, 1) * 0.14;
    const d = w * (0.9 + rand(i, 2) * 0.2);
    const h = HEIGHTS[level] * (0.9 + rand(i, 12) * 0.22);
    return { scale: [w, h, d], area: w * h };
  }
  const s = 0.5 + rand(i, 1) * 0.62; // uniform → keeps each primitive's shape, varied sizes
  return { scale: [s, s, s], area: AREA[key] * s * s };
}

// Fill rule: one block per commit means the count follows the quarter (165 today, 100 last
// week, a few dozen in a quiet one) and so does the mass — a level-4 box is four times the
// face of a level-0 one — and pieces whose size ignored either would leave the tray a fifth
// full one quarter and jammed against its ceiling the next. The pieces are scaled so their
// summed cross-section, packed at the density this shape mix settles to, puts the crest (the
// topmost centre) at CREST of the tray's height. Measured on the live 165 level-4 commits:
// coverage 0.68 of the tray settled to a crest of 0.89, so the mix packs at ~0.76; a
// 15% squeeze (the re-lay threshold) then lifts 0.55 to 0.65, well under the ceiling at
// 0.92. Clamped: a handful of commits become a few big blocks, not a boulder, and
// a flood of them stays coarse enough to read. Frozen at mount with the layout — colliders
// are built once from the instance scale (react-three-rapier re-derives them only when the
// `colliders` prop changes), so a re-lay must not change piece sizes.
const CREST = 0.55;
const DENSITY = 0.76;
const K_MIN = 0.75;
const K_MAX = 1.6;
function fillScale(hw: number, hh: number, pieces: readonly Piece[]): number {
  let sum = 0;
  for (let i = 0; i < pieces.length; i++) sum += sizeOf(i, shapeOf(i).key, pieces[i].level).area;
  if (sum === 0) return 1;
  const tray = 2 * (hw - INSET) * (2 * hh - FLOOR_LIFT);
  return Math.min(K_MAX, Math.max(K_MIN, Math.sqrt((CREST * DENSITY * tray) / sum)));
}

// The pour. Pieces are born `fixed`, parked out of frame, and released on 100 ms beats from a
// mouth just above the frame's top edge — the entrance is a metered pour that starts when
// the tray is actually on screen, not a rain that played 300 px before the card arrived and
// before its numbers existed. Each beat opens every PHASES-th slot across the mouth, the
// phase advancing one slot per beat so the pattern ripples left → right (the calendar's
// direction); a slot is reused only every PHASES beats, by which time the previous train
// has fallen V0·0.3 + 0.54 ≈ 3 u — clear of the next one. A train stacks TRAIN pieces a slot
// apart above the mouth and falls as one, so its members never overlap; TRAIN grows with
// the count so no quarter pours for longer than MAX_BEATS. Fixed bodies ignore each other,
// so the park can overlap freely, and the mesh sync writes every body's matrix (not just
// active ones), so the park is drawn where it is — out of frame.
const BEAT_MS = 100;
const SLOT = 2.2; // × piece scale: clears a tumbled level-4 box (2.07 u tall)
const PHASES = 3;
const MAX_BEATS = 24;
const TRAIN_MAX = 5;
const V0 = 8; // exit speed downward (u/s)
const VX = 0.5; // and a hint of drift toward the right, the way the ripple runs (1.5 heaped the right wall)
const GRACE_BEATS = 12; // after the last release, before the ceiling closes: a 5-train top falls 10 u in 0.75 s
const PARK = 40; // park height above the mouth
const SPAWN_INSET = 1.7; // mouth half-width inside the frame: wall inset + a half piece + collider skin
// A window drag re-lays once it has been still for this long, not once per band.
const RELAY_QUIET_MS = 300;
// Width change (fraction of the spawn half-width) past which the pile is re-laid rather than
// nudged. It was a quarter; measured sweeps of the thick walls into the settled pile: 1.2 u
// (1100→1000 px) nudges the edge pieces 1.4 u and keeps 165/165, 2.4 u (1072→930 px) drives
// solver corrections to 14–53 u/s and forces 1–3 pieces out through the floor. 15% caps the
// sweep at ~1.7 u on the widest tray.
const RELAY_FRAC = 0.15;

// Per-shape material feel. Restitution combine-rule priority (Max > Min > Average) means
// round shapes (Max) stay lively off the Average floor and bounce/roll, while faceted
// shapes (Min) land dead-calm — energetic character without stack-wide jitter.
const MATERIALS: Record<string, {
  density: number; friction: number; restitution: number;
  restitutionRule: CoefficientCombineRule; angularDamping: number; linearDamping: number;
}> = {
  box:    { density: 1.3, friction: 0.70, restitution: 0.08, restitutionRule: CoefficientCombineRule.Min, angularDamping: 0.50, linearDamping: 0.05 },
  tetra:  { density: 1.1, friction: 0.80, restitution: 0.06, restitutionRule: CoefficientCombineRule.Min, angularDamping: 0.60, linearDamping: 0.05 },
  cone:   { density: 1.0, friction: 0.70, restitution: 0.08, restitutionRule: CoefficientCombineRule.Min, angularDamping: 0.55, linearDamping: 0.05 },
  octa:   { density: 1.0, friction: 0.60, restitution: 0.12, restitutionRule: CoefficientCombineRule.Min, angularDamping: 0.40, linearDamping: 0.05 },
  sphere: { density: 0.7, friction: 0.45, restitution: 0.32, restitutionRule: CoefficientCombineRule.Max, angularDamping: 0.06, linearDamping: 0.04 },
  ico:    { density: 0.8, friction: 0.50, restitution: 0.25, restitutionRule: CoefficientCombineRule.Max, angularDamping: 0.10, linearDamping: 0.04 },
  torus:  { density: 0.9, friction: 0.55, restitution: 0.18, restitutionRule: CoefficientCombineRule.Max, angularDamping: 0.25, linearDamping: 0.05 },
};

function geomFor(key: string): ReactNode {
  switch (key) {
    case "sphere": return <sphereGeometry args={[0.5, 16, 16]} />;
    case "cone": return <coneGeometry args={[0.52, 1, 20]} />;
    case "octa": return <octahedronGeometry args={[0.62]} />;
    case "tetra": return <tetrahedronGeometry args={[0.66]} />;
    case "torus": return <torusGeometry args={[0.36, 0.16, 12, 22]} />;
    case "ico": return <icosahedronGeometry args={[0.56]} />;
    default: return <boxGeometry />;
  }
}

interface Group {
  key: string;
  collider: Collider;
  instances: InstancedRigidBodyProps[];
  /** palette level per instance — the colour itself is theme-side, see `shades` */
  levels: number[];
  /** pour schedule per instance: the beat it is released on and where the mouth puts it */
  beats: number[];
  rx: number[];
  ry: number[];
}

interface Layout {
  groups: Group[];
  /** beats the pour takes */
  beats: number;
  /** the highest point a released train occupies — the walls reach it */
  top: number;
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

function Pile({ pieces, accent, card, light, visible, pour }: {
  pieces: readonly Piece[]; accent: string; card: string; light: boolean; visible: boolean; pour: boolean;
}) {
  const { viewport, camera, pointer, gl, invalidate } = useThree();
  const { rapier } = useRapier();
  const hw = viewport.width / 2;
  const hh = viewport.height / 2;
  // The layout is frozen at mount. `position` is a mutable rapier option: a new instances
  // array re-runs setTranslation on every body, so building positions from the live viewport
  // teleported all 200 settled pieces back to the sky on every aspect change (reproduced on
  // production at 1100→1000 px). Only the walls follow the viewport now; a narrower region
  // nudges edge pieces inward, a wider one leaves a gap at the right — both beat a re-fall.
  // Past RELAY_FRAC of the spawn width, though, the region has changed size class (the card
  // going fluid below 1072 px, DevTools docking) and a pile laid out for the old width would
  // leave half the box empty or half the pile outside it — there a re-rain is the honest
  // answer, so the layout is re-laid to the live size once the drag has been still for
  // RELAY_QUIET_MS (a continuous drag from 1440 to 700 re-laid at every 25% band before).
  // The piece scale is part of the frozen layout, see fillScale.
  const [spawn, setSpawn] = useState(() => ({ hw, hh, k: fillScale(hw, hh, pieces) }));
  const relayPending = Math.abs(hw - spawn.hw) > RELAY_FRAC * spawn.hw;
  useEffect(() => {
    if (!relayPending) return;
    const t = setTimeout(() => setSpawn((s) => ({ hw, hh, k: s.k })), RELAY_QUIET_MS);
    return () => clearTimeout(t);
  }, [relayPending, hw, hh]);
  // The walls follow the live width only inside the no-re-lay band. Past it they hold at
  // the spawn width until the re-lay lands: a 1024→784 px drag moved them 4 u into the
  // sleeping pile in the 300 ms before the re-lay, and a piece buried that deep in the
  // thick wall AND the floor took a solver kick that read y = 849,612 — for a pile that
  // was about to be parked and poured again anyway.
  const wallHw = relayPending ? spawn.hw : hw;

  // One entry per group; aligned by group index. InstancedRigidBodies assigns its ref
  // as an OBJECT ref (writes .current) — a function ref silently no-ops — so we hand it
  // stable { current } holders (built with useMemo below) instead of callback refs.
  const homeX = useRef<Float32Array[]>([]);
  const massA = useRef<Float32Array[]>([]);
  const captured = useRef(false);
  // Simulated seconds since the pour finished, accumulated from frame deltas clamped the way
  // rapier clamps them: R3F zeroes clock.elapsedTime on every frameloop switch, and the first
  // frame after an idle carries the whole idle as its delta — a Canvas-age clock, or a raw
  // sum, would capture home-X from mid-air trains on the first frame after a respawn.
  const sinceSpawn = useRef(0);
  const quietFor = useRef(0);
  const nextBeat = useRef(0);
  const pourDone = useRef(false);

  const active = useRef(false);
  const wasActive = useRef(false);
  // persistent vectors (damp3 stashes velocity on `cursor`; finite-diff needs `prev`)
  const cursor = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const prevHit = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const cvel = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  // Shape, size, spin and mouth slot come from rand(i, seed) — texture, not data. Only the
  // colour level (and a box's height, the heatmap's own extrusion) is the commit's.
  const layout = useMemo<Layout>(() => {
    const k = spawn.k;
    const gs: Group[] = SHAPE_DEFS.map((d) => ({ key: d.key, collider: d.collider, instances: [], levels: [], beats: [], rx: [], ry: [] }));
    const n = pieces.length;
    const slot = SLOT * k;
    const slots = Math.max(1, Math.floor((2 * (spawn.hw - SPAWN_INSET)) / slot));
    const perBeat = Math.max(1, Math.floor(slots / PHASES));
    const train = Math.min(TRAIN_MAX, Math.max(1, Math.ceil(n / (perBeat * MAX_BEATS))));
    const mouth = spawn.hh + 1.3 * k;
    const x0 = -(slots * slot) / 2 + slot / 2;
    let i = 0;
    let beat = 0;
    while (i < n) {
      for (let j = beat % PHASES; j < slots && i < n; j += PHASES) {
        for (let t = 0; t < train && i < n; t++, i++) {
          const shape = shapeOf(i);
          const g = gs[SHAPE_DEFS.indexOf(shape)];
          const level = pieces[i].level;
          const unit = sizeOf(i, shape.key, level).scale;
          const scale: [number, number, number] = [unit[0] * k, unit[1] * k, unit[2] * k];
          const rx = x0 + j * slot + (rand(i, 5) - 0.5) * 0.3 * k;
          g.levels.push(level);
          g.beats.push(beat);
          g.rx.push(rx);
          g.ry.push(mouth + t * slot);
          g.instances.push({
            key: `${g.key}-${g.instances.length}`,
            type: "fixed",
            position: [rx, mouth + PARK, 0],
            rotation: [0, 0, rand(i, 9) * Math.PI],
            scale,
          });
        }
      }
      beat++;
    }
    return { groups: gs.filter((g) => g.instances.length > 0), beats: beat, top: mouth + train * slot + k };
  }, [pieces, spawn]);

  // One ramp read two ways: the heatmap mixes the accent 18/45/64/82/100% into --card in both
  // themes, and so does the pile now — in light the rest pieces are the heatmap's rest-cell
  // periwinkle, not the white foam of before. (THREE lerps in linear space, color-mix in
  // sRGB, so the stops agree nominally, not to the pixel; same as dark always did.) Kept
  // apart from the layout so a theme flip only recolours in place.
  const shades = useMemo(() => {
    const acc = new THREE.Color(accent || "#3b82f6");
    const base = new THREE.Color(card || (light ? "#f4f4f5" : "#18181b"));
    return [0.18, 0.45, 0.64, 0.82, 1].map((keep) => acc.clone().lerp(base, 1 - keep));
  }, [accent, card, light]);

  // One stable { current } holder per group, aligned by index. Plain objects (not
  // useRef) so passing them as `ref` and reading them isn't a ref-access-during-render.
  const bodyHolders = useMemo<Holder[]>(
    () => layout.groups.map(() => ({ current: null })),
    [layout]
  );
  const meshHolders = useMemo(
    () => layout.groups.map(() => ({ current: null as THREE.InstancedMesh | null })),
    [layout]
  );

  useEffect(() => {
    homeX.current = layout.groups.map((g) => new Float32Array(g.instances.length));
    massA.current = layout.groups.map((g) => new Float32Array(g.instances.length));
    captured.current = false;
    sinceSpawn.current = 0;
    quietFor.current = 0;
    nextBeat.current = 0;
    pourDone.current = false;
  }, [layout]);

  useEffect(() => {
    layout.groups.forEach((g, gi) => {
      const mesh = meshHolders[gi]?.current;
      if (!mesh) return;
      for (let i = 0; i < g.levels.length; i++) mesh.setColorAt(i, shades[g.levels[i]]);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    invalidate(); // a sleeping pile has no frame coming to show the new colours
  }, [layout, shades, meshHolders, invalidate]);

  // The pour clock. Runs only while the frameloop can (visible) and the tray is on screen
  // (pour), and skips beats in a hidden tab: the sim is frozen there, so a release would
  // stack trains on the same mouth slot to pop apart on return. The ceiling closes
  // GRACE_BEATS after the last release; `poured` follows the layout identity so a re-lay
  // reopens it without an effect having to reset state.
  const [pouredLayout, setPouredLayout] = useState<Layout | null>(null);
  const poured = pouredLayout === layout;
  useEffect(() => {
    if (!visible || !pour || nextBeat.current >= layout.beats + GRACE_BEATS) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const b = nextBeat.current++;
      if (b < layout.beats) {
        const dynamic = rapier.RigidBodyType.Dynamic;
        layout.groups.forEach((g, gi) => {
          const list = bodyHolders[gi]?.current;
          if (!list) return;
          for (let i = 0; i < g.beats.length; i++) {
            if (g.beats[i] !== b) continue;
            const body = list[i];
            if (!body) continue;
            body.setTranslation({ x: g.rx[i], y: g.ry[i], z: 0 }, false);
            body.setBodyType(dynamic, true);
            body.setLinvel({ x: VX, y: -V0, z: 0 }, true);
            body.setAngvel({ x: 0, y: 0, z: (rand(i, 23) - 0.5) * 3 }, true);
          }
        });
        if (b === layout.beats - 1) {
          pourDone.current = true;
          sinceSpawn.current = 0; // the settle window starts when the last train is out
        }
        invalidate();
      } else if (b >= layout.beats + GRACE_BEATS - 1) {
        setPouredLayout(layout);
        invalidate();
        clearInterval(id);
      }
    }, BEAT_MS);
    return () => clearInterval(id);
  }, [visible, pour, layout, bodyHolders, rapier, invalidate]);

  // Under a demand frameloop nothing draws unless asked: every pointer transition asks for
  // one frame, and the bodies that frame wakes keep the loop alive by themselves after that.
  useEffect(() => {
    const el = gl.domElement;
    const on = () => { active.current = true; invalidate(); };
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

  // Back on screen: the frameloop just went never → demand with the clock reset, and rapier
  // only invalidates from inside a step, so a pile frozen mid-fall would stay frozen until the
  // pointer arrived. One frame restarts whatever was still moving.
  useEffect(() => {
    if (visible) invalidate();
  }, [visible, invalidate]);

  // A moved wall does not wake the sleeping island it now overlaps. Wake everything on a size
  // change so penetration resolution can nudge edge pieces inward; the idle test re-sleeps it.
  const sizeSeen = useRef(false);
  useEffect(() => {
    if (!sizeSeen.current) { sizeSeen.current = true; return; }
    forEachBody(bodyHolders, (b) => b.wakeUp());
    invalidate();
  }, [wallHw, hh, bodyHolders, invalidate]);

  useFrame((_, delta) => {
    const gb = bodyHolders;
    if (!gb.length || homeX.current.length !== layout.groups.length) return;
    const dt = Math.max(1e-4, Math.min(delta, 1 / 30));
    sinceSpawn.current += Math.min(delta, 0.5);

    // 1) cursor follower (field center) + its RAW velocity. Sampling speed from the raw
    //    hit point — not the low-passed follower — means fast flicks aren't smoothed away.
    //    The speed divides by the real frame delta, not the clamped dt: at 10 fps the clamp
    //    read a 600 px/s hover as 1800 px/s and swung the swipe coupling three times too hard.
    if (active.current) {
      dir.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
      const distToPlane = -camera.position.z / dir.z;
      hit.copy(camera.position).addScaledVector(dir, distToPlane);
      if (!wasActive.current) { cursor.copy(hit); prevHit.copy(hit); wasActive.current = true; }
      easing.damp3(cursor, hit, 0.05, dt, 60); // snappier center
      cvel.copy(hit).sub(prevHit).divideScalar(Math.max(delta, 1e-4));
      prevHit.copy(hit);
    } else {
      wasActive.current = false;
      cvel.set(0, 0, 0);
    }
    const speed = active.current ? cvel.length() : 0;
    const sf = Math.min(1, Math.pow(speed / V_FULL, 1.5)); // super-linear: a flick ≫ a drag

    // 2) the pile's peak speed — read once, for the settle capture and the idle test. Nothing
    //    is captured while trains are still parked: a fixed body reads 0 u/s and its X is the
    //    mouth's, and a home taken there would recall the piece to the sky.
    const t = sinceSpawn.current;
    const settling = !captured.current && pourDone.current && t > SETTLE_MIN;
    const idling = captured.current && !active.current;
    let maxV2 = 0;
    if (settling || idling) {
      // "out" is the union of the live box and the spawn box: a wall that moved inward has
      // not made the pieces it left behind escapees.
      const outX = Math.max(hw, spawn.hw) + 1.5;
      for (let gi = 0; gi < gb.length; gi++) {
        const list = gb[gi]?.current;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (!b) continue;
          // A piece that has tunnelled out of the box would fall forever and hold the loop
          // awake for nothing visible. Park it where it is and leave it out of the quiet test.
          const p = b.translation();
          if (p.y < -hh - 1.5 || Math.abs(p.x) > outX || Math.abs(p.z) > HZ + 1.5) {
            if (!b.isSleeping()) b.sleep();
            continue;
          }
          const lv = b.linvel();
          const s2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
          if (s2 > maxV2) maxV2 = s2;
        }
      }
    }

    // capture the settled pile as "home" X once it has come to rest
    if (settling && (maxV2 < 0.5 || t > SETTLE_MAX)) {
      for (let gi = 0; gi < gb.length; gi++) {
        const list = gb[gi]?.current;
        if (!list) continue;
        const HX = homeX.current[gi];
        const MA = massA.current[gi];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (!b) continue;
          HX[i] = b.translation().x;
          MA[i] = b.mass();
        }
      }
      captured.current = true;
    }

    // idle → sleep the whole island (see IDLE_V). Quiet time runs on the delta rapier itself
    // integrates (clamped to 0.5 s), so a 10 fps tab and a 120 Hz one agree on "3 s".
    // Nothing below has work for a sleeping pile.
    if (idling) {
      quietFor.current = maxV2 < IDLE_V * IDLE_V ? quietFor.current + Math.min(delta, 0.5) : 0;
      if (quietFor.current >= IDLE_T) {
        quietFor.current = 0;
        forEachBody(gb, (b) => b.sleep());
        return;
      }
    } else {
      quietFor.current = 0;
    }

    const pushing = active.current; // presence floor → shove even when slow
    const cx = cursor.x;
    const cy = cursor.y;

    for (let gi = 0; gi < gb.length; gi++) {
      const list = gb[gi]?.current;
      if (!list) continue;
      const HX = homeX.current[gi];
      const MA = massA.current[gi];
      if (!HX) continue;

      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b) continue;
        const p = b.translation();

        if (pushing) {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d = Math.hypot(dx, dy);
          if (d < R) {
            if (b.isSleeping()) b.wakeUp(); // wake the region so support-loss can fall
            const w = 1 - d / R;
            const s = w * w * (3 - 2 * w); // smoothstep → soft palm, no edge pop
            const strength = s * (FLOOR + (1 - FLOOR) * sf);
            const inv = 1 / (d || 1e-4);
            const fx = (dx * inv * F_BASE + cvel.x * F_SWIPE) * strength;
            const fy = (dy * inv * F_BASE + cvel.y * F_SWIPE) * strength;
            // impulse = force·dt (frame-rate independent), applied AT the cursor point so the
            // vertical offset + swipe component impart a real tipping torque → pieces topple.
            b.applyImpulseAtPoint({ x: fx * dt, y: fy * dt, z: 0 }, { x: cx, y: cy, z: 0 }, true);
            const v = b.linvel();
            const sp = Math.hypot(v.x, v.y, v.z);
            if (sp > V_CAP) { const kk = V_CAP / sp; b.setLinvel({ x: v.x * kk, y: v.y * kk, z: v.z * kk }, true); }
            const av = b.angvel();
            const ws = Math.hypot(av.x, av.y, av.z);
            if (ws > W_CAP) { const kk = W_CAP / ws; b.setAngvel({ x: av.x * kk, y: av.y * kk, z: av.z * kk }, true); }
            continue; // being pushed → no recall this frame
          }
        }

        // 3) horizontal recall to home — loose & far-only, so the pile reforms organically
        //    instead of snapping into columns. Sleeping pieces stay put (anti-jitter).
        if (!captured.current || b.isSleeping()) continue;
        const dX = HX[i] - p.x;
        const adx = Math.abs(dX);
        const slack = SLACK * (0.8 + 0.4 * rand(i, 21)); // per-piece slack → no unison return
        if (adx > slack) {
          const v = b.linvel();
          const pull = adx - slack; // ramps in from zero → no teleport-home
          const ax = K * Math.sign(dX) * pull - C * v.x;
          const m = MA[i] || b.mass();
          b.applyImpulse({ x: ax * m * dt, y: 0, z: 0 }, true);
        }
      }
    }
  });

  return (
    <>
      <Tray hw={wallHw} hh={hh} top={layout.top} poured={poured} color={shades[0]} />
      {layout.groups.map((g, gi) => {
        const mat = MATERIALS[g.key];
        return (
          <InstancedRigidBodies
            key={g.key}
            ref={bodyHolders[gi]}
            instances={g.instances}
            colliders={g.collider}
            density={mat.density}
            friction={mat.friction}
            restitution={mat.restitution}
            restitutionCombineRule={mat.restitutionRule}
            linearDamping={mat.linearDamping}
            angularDamping={mat.angularDamping}
            contactSkin={0.015}
            softCcdPrediction={0.8}
            enabledTranslations={[true, true, false]}
            enabledRotations={[true, true, true]}
          >
            <instancedMesh
              ref={meshHolders[gi]}
              args={[undefined, undefined, g.instances.length]}
              count={g.instances.length}
              frustumCulled={false}
            >
              {geomFor(g.key)}
              {/* Matte to match the site — no clearcoat gloss; form comes from diffuse shading only. */}
              <meshStandardMaterial roughness={0.92} metalness={0} />
            </instancedMesh>
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
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      // "demand": rapier invalidate()s once per active body after each step, so the drop and
      // every shove sustain the loop themselves and the settled, sleeping pile costs nothing.
      // "never" while the card is offscreen — rapier steps inside useFrame, so this parks the
      // world too, and the pile resumes exactly where it froze instead of raining in again.
      frameloop={active ? "demand" : "never"}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 0, 11], fov: 45 }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
      }}
      // grab: the force field is live over the whole tray, including the air above the pile,
      // and the default arrow said nothing about it.
      style={{ width: "100%", height: "100%", cursor: "grab" }}
    >
      {/* There is ONE key light on this site and it sits up and to the RIGHT — the direction
          the heatmap's extruded bars (CommitHeatmap FACE_LIT/FACE_SHADE) and the hero's caustic
          are painted for. [6, 8, 2.5] normalises to 0.58/0.78/0.24, so an upright box reads
          top 1 : right 0.78 : front 0.42 under the dark rig (2.0 + 0.3 ambient) — the bars'
          1 : 0.78 : 0.46 within four points, and blocks and bars become one lit set. The old
          four-light rig had a directional fill from the lower LEFT that alone added 0.27 to
          every camera-facing face and pushed FRONT above TOP (1.96 top / 2.04 front): the flat
          blue mass in the production screenshots. Its two point lights were near no-ops at
          three's physical 1/d² decay (≈1% of the key; the accent one sat behind the pile). */}
      <ambientLight intensity={light ? 0.45 : 0.3} />
      <directionalLight position={[6, 8, 2.5]} intensity={light ? 1.4 : 2.0} />
      <Suspense fallback={null}>
        {/* interpolate is off: react-three-rapier only lerps the `mesh` branch — an instanced
            body is written straight from the step (esm.js "instancedMesh" → setMatrix) — so the
            flag bought nothing but a translation()+rotation() snapshot of every body per step. */}
        <Physics gravity={[0, -12, 0]} timeStep={1 / 60} interpolate={false} numSolverIterations={12} numInternalPgsIterations={1}>
          <Pile pieces={pieces} accent={accent} card={card} light={light} visible={active} pour={pour} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
