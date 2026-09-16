"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider, InstancedRigidBodies, CoefficientCombineRule, type RapierRigidBody, type InstancedRigidBodyProps } from "@react-three/rapier";
import { easing } from "maath";
import * as THREE from "three";

// Deterministic pseudo-random (stable across renders → no hydration drift).
function rand(i: number, seed: number): number {
  return Math.abs(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1;
}

// Static floor + walls confining the sim to the visible box. Grippy + near-zero bounce
// so the floor is not a trampoline.
function Boundary({ hw, hh, hz }: { hw: number; hh: number; hz: number }) {
  const th = 0.6;
  return (
    <RigidBody type="fixed" colliders={false} friction={0.6} restitution={0.02}>
      <CuboidCollider args={[hw + th, th, hz + th]} position={[0, -hh - th, 0]} />
      <CuboidCollider args={[th, hh * 3, hz + th]} position={[-hw - th, 0, 0]} />
      <CuboidCollider args={[th, hh * 3, hz + th]} position={[hw + th, 0, 0]} />
      <CuboidCollider args={[hw + th, hh * 3, th]} position={[0, 0, -hz - th]} />
      <CuboidCollider args={[hw + th, hh * 3, th]} position={[0, 0, hz + th]} />
    </RigidBody>
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
// stepping, no 200 setMatrixAt, no draw. 1.5 u/s is ~57 px/s here, 50% over the creep peaks;
// anything airborne passes it within 125 ms under g = 12, a recall slide is faster or
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
const V_CAP = 11; // clamp resulting body speed → anti-tunnel + anti-rocket
// horizontal return spring (gravity owns the vertical axis → no hover/float)
const K = 8; // gentler homing (was 14)
const C = 2 * Math.sqrt(K) * 0.9; // near-critical damping (zeta 0.9)
const SLACK = 1.1; // recall only pieces shoved beyond this → pile reforms organically, not in columns

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

function Pile({ count, accent, light, visible }: { count: number; accent: string; light: boolean; visible: boolean }) {
  const { viewport, camera, pointer, gl, invalidate } = useThree();
  const hw = viewport.width / 2;
  const hh = viewport.height / 2;
  const hz = 1.3;
  // The layout is frozen at mount. `position` is a mutable rapier option: a new instances
  // array re-runs setTranslation on every body, so building positions from the live viewport
  // teleported all 200 settled pieces back to the sky on every aspect change (reproduced on
  // production at 1100→1000 px). Only the walls follow the viewport now; a narrower region
  // nudges edge pieces inward, a wider one leaves a gap at the right — both beat a re-fall.
  const [spawn] = useState(() => ({ hw, hh }));

  // One entry per group; aligned by group index. InstancedRigidBodies assigns its ref
  // as an OBJECT ref (writes .current) — a function ref silently no-ops — so we hand it
  // stable { current } holders (built with useMemo below) instead of callback refs.
  const homeX = useRef<Float32Array[]>([]);
  const massA = useRef<Float32Array[]>([]);
  const captured = useRef(false);
  // Seconds since the layout was (re)spawned, accumulated from frame deltas: R3F zeroes
  // clock.elapsedTime on every frameloop switch, and a Canvas-age clock would capture home-X
  // from mid-air spawn columns after any respawn.
  const sinceSpawn = useRef(0);
  const quietFor = useRef(0);

  const active = useRef(false);
  const wasActive = useRef(false);
  // persistent vectors (damp3 stashes velocity on `cursor`; finite-diff needs `prev`)
  const cursor = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const prevHit = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const cvel = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  const layout = useMemo<Group[]>(() => {
    const heights = [0.34, 0.62, 0.96, 1.35, 1.85];
    const gs: Group[] = SHAPE_DEFS.map((d) => ({ key: d.key, collider: d.collider, instances: [], levels: [] }));
    for (let i = 0; i < count; i++) {
      const gi = PICK[Math.floor(rand(i, 7) * PICK.length)];
      const g = gs[gi];
      const lr = rand(i, 3);
      const level = lr < 0.34 ? 0 : lr < 0.6 ? 1 : lr < 0.8 ? 2 : lr < 0.93 ? 3 : 4;
      let scale: [number, number, number];
      if (g.key === "box") {
        const w = 0.42 + rand(i, 1) * 0.14;
        const d = w * (0.9 + rand(i, 2) * 0.2);
        const h = heights[level] * (0.9 + rand(i, 12) * 0.22);
        scale = [w, h, d];
      } else {
        const s = 0.5 + rand(i, 1) * 0.62; // uniform → keeps each primitive's shape, varied sizes
        scale = [s, s, s];
      }
      g.levels.push(level);
      const x = (rand(i, 5) * 2 - 1) * (spawn.hw - 0.9);
      const y = spawn.hh * 0.3 + rand(i, 6) * spawn.hh * 3.4;
      g.instances.push({
        key: `${g.key}-${g.instances.length}`,
        position: [x, y, 0],
        rotation: [0, 0, rand(i, 9) * Math.PI],
        scale,
      });
    }
    return gs.filter((g) => g.instances.length > 0);
  }, [count, spawn]);

  // Level palette per theme. Dark: accent → near-black. Light: WHITE → accent, so the
  // pile is a bright white-to-blue mix (with genuine white pieces) on the white card.
  // Kept apart from the layout so a theme flip only recolours in place.
  const shades = useMemo(() => {
    const acc = new THREE.Color(accent || "#3b82f6");
    const white = new THREE.Color("#ffffff");
    const dark = new THREE.Color("#18181b");
    return light
      ? [
          white.clone(),
          acc.clone().lerp(white, 0.7),
          acc.clone().lerp(white, 0.46),
          acc.clone().lerp(white, 0.22),
          acc.clone(),
        ]
      : [
          acc.clone().lerp(dark, 0.8),
          acc.clone().lerp(dark, 0.55),
          acc.clone().lerp(dark, 0.36),
          acc.clone().lerp(dark, 0.18),
          acc.clone(),
        ];
  }, [accent, light]);

  // One stable { current } holder per group, aligned by index. Plain objects (not
  // useRef) so passing them as `ref` and reading them isn't a ref-access-during-render.
  const bodyHolders = useMemo<Holder[]>(
    () => layout.map(() => ({ current: null })),
    [layout]
  );
  const meshHolders = useMemo(
    () => layout.map(() => ({ current: null as THREE.InstancedMesh | null })),
    [layout]
  );

  useEffect(() => {
    homeX.current = layout.map((g) => new Float32Array(g.instances.length));
    massA.current = layout.map((g) => new Float32Array(g.instances.length));
    captured.current = false;
    sinceSpawn.current = 0;
    quietFor.current = 0;
  }, [layout]);

  useEffect(() => {
    layout.forEach((g, gi) => {
      const mesh = meshHolders[gi]?.current;
      if (!mesh) return;
      for (let i = 0; i < g.levels.length; i++) mesh.setColorAt(i, shades[g.levels[i]]);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    invalidate(); // a sleeping pile has no frame coming to show the new colours
  }, [layout, shades, meshHolders, invalidate]);

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
  }, [hw, hh, bodyHolders, invalidate]);

  useFrame((state, delta) => {
    const gb = bodyHolders;
    if (!gb.length || homeX.current.length !== layout.length) return;
    const dt = Math.max(1e-4, Math.min(delta, 1 / 30));
    sinceSpawn.current += delta;

    // 1) cursor follower (field center) + its RAW velocity. Sampling speed from the raw
    //    hit point — not the low-passed follower — means fast flicks aren't smoothed away.
    if (active.current) {
      dir.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
      const distToPlane = -camera.position.z / dir.z;
      hit.copy(camera.position).addScaledVector(dir, distToPlane);
      if (!wasActive.current) { cursor.copy(hit); prevHit.copy(hit); wasActive.current = true; }
      easing.damp3(cursor, hit, 0.05, dt, 60); // snappier center
      cvel.copy(hit).sub(prevHit).divideScalar(dt);
      prevHit.copy(hit);
    } else {
      wasActive.current = false;
      cvel.set(0, 0, 0);
    }
    const speed = active.current ? cvel.length() : 0;
    const sf = Math.min(1, Math.pow(speed / V_FULL, 1.5)); // super-linear: a flick ≫ a drag

    // 2) the pile's peak speed — read once, for the settle capture and the idle test
    const t = sinceSpawn.current;
    const settling = !captured.current && t > SETTLE_MIN;
    const idling = captured.current && !active.current;
    let maxV2 = 0;
    if (settling || idling) {
      forEachBody(gb, (b) => {
        // A piece that has tunnelled out of the box (measured: a 2000 px/s swipe through the
        // pile launches 3–6 through a wall) would fall forever and hold the loop awake for
        // nothing visible. Park it where it is and leave it out of the quiet test.
        const p = b.translation();
        if (p.y < -hh - 1.5 || Math.abs(p.x) > hw + 1.5 || Math.abs(p.z) > hz + 1.5) {
          if (!b.isSleeping()) b.sleep();
          return;
        }
        const lv = b.linvel();
        const s2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
        if (s2 > maxV2) maxV2 = s2;
      });
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
      <Boundary hw={hw} hh={hh} hz={hz} />
      {layout.map((g, gi) => {
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
  count = 200,
  accent,
  light = false,
  active = true,
}: {
  count?: number;
  accent: string;
  light?: boolean;
  /** Card within its mount margin. Off → the loop is "never": no render, no step, no wake. */
  active?: boolean;
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
      style={{ width: "100%", height: "100%" }}
    >
      {/* Light mode: much softer, flatter lighting so the near-white matte pieces read
          as flat clay instead of blowing out into glossy hotspots. Dark stays punchy. */}
      <ambientLight intensity={light ? 0.78 : 0.55} />
      <directionalLight position={[5, 7, 6]} intensity={light ? 0.95 : 2.1} />
      <directionalLight position={[-6, -2, 4]} intensity={light ? 0.3 : 0.5} />
      <pointLight position={[0, 0, 6]} intensity={light ? 0.18 : 0.7} />
      <pointLight position={[-4, 3, -3]} intensity={light ? 0.15 : 0.5} color={accent || "#3b82f6"} />
      <Suspense fallback={null}>
        {/* interpolate is off: react-three-rapier only lerps the `mesh` branch — an instanced
            body is written straight from the step (esm.js "instancedMesh" → setMatrix) — so the
            flag bought nothing but a translation()+rotation() snapshot of all 200 bodies per step. */}
        <Physics gravity={[0, -12, 0]} timeStep={1 / 60} interpolate={false} numSolverIterations={12} numInternalPgsIterations={1}>
          <Pile count={count} accent={accent} light={light} visible={active} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
