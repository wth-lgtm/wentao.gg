"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider, InstancedRigidBodies, type RapierRigidBody, type InstancedRigidBodyProps } from "@react-three/rapier";
import { easing } from "maath";
import * as THREE from "three";

// Deterministic pseudo-random (stable across renders → no hydration drift).
function rand(i: number, seed: number): number {
  return Math.abs(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1;
}

// Static floor + walls confining the sim to the visible box.
function Boundary({ hw, hh, hz }: { hw: number; hh: number; hz: number }) {
  const th = 0.6;
  return (
    <RigidBody type="fixed" colliders={false} friction={0.3} restitution={0.05}>
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
// soft cursor field
const R = 2.5; // influence radius
const REPEL = 1.05; // radial push
const PUSH = 0.17; // velocity coupling (cursor momentum)
const IMP_MAX = 2.0; // clamp so bars don't rocket out
const V_FULL = 5.5; // cursor speed (u/s) for full-strength push
// horizontal return spring (gravity owns the vertical axis → no hover/float)
const K = 14;
const C = 2 * Math.sqrt(K) * 0.9; // near-critical damping (zeta 0.9)
const DEAD = 0.2; // > friction stiction band (μg/k) so seated bars stop being nudged → sleep

function Pile({ count, accent }: { count: number; accent: string }) {
  const { viewport, camera, pointer, gl } = useThree();
  const hw = viewport.width / 2;
  const hh = viewport.height / 2;
  const hz = 1.3;

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const bodies = useRef<(RapierRigidBody | null)[]>(null);

  const homeX = useRef<Float32Array>(new Float32Array(0));
  const massA = useRef<Float32Array>(new Float32Array(0));
  const captured = useRef(false);

  const active = useRef(false);
  const wasActive = useRef(false);
  // persistent vectors (damp3 stashes velocity on `cursor`; finite-diff needs `prev`)
  const cursor = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const prev = useMemo(() => new THREE.Vector3(0, -1000, 0), []);
  const cvel = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  const { instances, colors } = useMemo(() => {
    const card = new THREE.Color("#18181b");
    const acc = new THREE.Color(accent || "#3b82f6");
    const shades = [
      acc.clone().lerp(card, 0.8),
      acc.clone().lerp(card, 0.55),
      acc.clone().lerp(card, 0.36),
      acc.clone().lerp(card, 0.18),
      acc.clone(),
    ];
    const heights = [0.34, 0.62, 0.96, 1.35, 1.85];
    const instances: InstancedRigidBodyProps[] = [];
    const colors: THREE.Color[] = [];
    for (let i = 0; i < count; i++) {
      const lr = rand(i, 3);
      const level = lr < 0.34 ? 0 : lr < 0.6 ? 1 : lr < 0.8 ? 2 : lr < 0.93 ? 3 : 4;
      const fw = 0.42 + rand(i, 1) * 0.14;
      const w = fw;
      const d = fw * (0.9 + rand(i, 2) * 0.2);
      const h = heights[level] * (0.9 + rand(i, 12) * 0.22);
      colors.push(shades[level]);
      const x = (rand(i, 5) * 2 - 1) * (hw - 0.9);
      const y = hh * 0.3 + rand(i, 6) * hh * 3.4;
      instances.push({
        key: i,
        position: [x, y, 0],
        rotation: [0, 0, rand(i, 9) * Math.PI],
        scale: [w, h, d],
      });
    }
    return { instances, colors };
  }, [count, accent, hw, hh]);

  useEffect(() => {
    homeX.current = new Float32Array(count);
    massA.current = new Float32Array(count);
    captured.current = false;
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < count; i++) mesh.setColorAt(i, colors[i]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [colors, count]);

  useEffect(() => {
    const el = gl.domElement;
    const on = () => { active.current = true; };
    const off = () => { active.current = false; };
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
  }, [gl]);

  useFrame((state, delta) => {
    const list = bodies.current;
    if (!list) return;
    const dt = Math.max(1e-4, Math.min(delta, 1 / 30));

    // 1) smoothed, mass-like cursor follower + its velocity (drives the soft field)
    if (active.current) {
      dir.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
      const distToPlane = -camera.position.z / dir.z;
      hit.copy(camera.position).addScaledVector(dir, distToPlane);
      if (!wasActive.current) { cursor.copy(hit); prev.copy(hit); wasActive.current = true; }
      easing.damp3(cursor, hit, 0.11, dt, 60);
    } else {
      wasActive.current = false;
    }
    cvel.copy(cursor).sub(prev).divideScalar(dt);
    prev.copy(cursor);
    const speed = active.current ? cvel.length() : 0;
    const sf = Math.min(1, speed / V_FULL); // push strength ∝ cursor speed → parked = 0

    const HX = homeX.current;
    const MA = massA.current;
    if (HX.length !== count) return;

    // 2) capture the settled pile as "home" X once it has come to rest
    if (!captured.current) {
      const t = state.clock.elapsedTime;
      if (t > SETTLE_MIN) {
        let maxV2 = 0;
        for (let i = 0; i < count; i++) {
          const b = list[i];
          if (!b) continue;
          const lv = b.linvel();
          const s2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
          if (s2 > maxV2) maxV2 = s2;
        }
        if (maxV2 < 0.5 || t > SETTLE_MAX) {
          for (let i = 0; i < count; i++) {
            const b = list[i];
            if (!b) continue;
            HX[i] = b.translation().x;
            MA[i] = b.mass();
          }
          captured.current = true;
        }
      }
    }

    const pushing = active.current && sf > 0.02;
    const cx = cursor.x;
    const cy = cursor.y;

    for (let i = 0; i < count; i++) {
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
          const inv = 1 / (d || 1e-4);
          let ix = (dx * inv * REPEL + cvel.x * PUSH) * s * sf;
          let iy = (dy * inv * REPEL + cvel.y * PUSH) * s * sf;
          const mag = Math.hypot(ix, iy);
          if (mag > IMP_MAX) { const kk = IMP_MAX / mag; ix *= kk; iy *= kk; }
          const m = MA[i] || b.mass();
          b.applyImpulse({ x: ix * m, y: iy * m, z: 0 }, true);
          continue; // being pushed → no recall this frame
        }
      }

      // 3) horizontal critically-damped spring back to home (ease-out settle, inertial).
      //    Skip sleeping bars and those inside the deadband → they stay asleep (no jitter).
      if (!captured.current || b.isSleeping()) continue;
      const dX = HX[i] - p.x;
      if (Math.abs(dX) > DEAD) {
        const v = b.linvel();
        const ax = K * dX - C * v.x; // acceleration; * mass below → mass-independent
        const m = MA[i] || b.mass();
        b.applyImpulse({ x: ax * m * dt, y: 0, z: 0 }, true);
      }
    }
  });

  return (
    <>
      <Boundary hw={hw} hh={hh} hz={hz} />
      <InstancedRigidBodies
        ref={bodies}
        instances={instances}
        colliders="cuboid"
        linearDamping={0.15}
        angularDamping={1.0}
        friction={0.3}
        restitution={0.1}
        additionalSolverIterations={4}
        enabledTranslations={[true, true, false]}
        enabledRotations={[false, false, true]}
      >
        <instancedMesh ref={meshRef} args={[undefined, undefined, count]} count={count} frustumCulled={false}>
          <boxGeometry />
          <meshPhysicalMaterial roughness={0.42} metalness={0} clearcoat={1} clearcoatRoughness={0.22} envMapIntensity={0.4} />
        </instancedMesh>
      </InstancedRigidBodies>
    </>
  );
}

export default function FloatingBackground({
  count = 200,
  accent,
}: {
  count?: number;
  accent: string;
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 0, 11], fov: 45 }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 7, 6]} intensity={2.1} />
      <directionalLight position={[-6, -2, 4]} intensity={0.5} />
      <pointLight position={[0, 0, 6]} intensity={0.7} />
      <pointLight position={[-4, 3, -3]} intensity={0.5} color={accent || "#3b82f6"} />
      <Suspense fallback={null}>
        <Physics gravity={[0, -8, 0]} timeStep={1 / 60} interpolate numSolverIterations={8} numInternalPgsIterations={2}>
          <Pile count={count} accent={accent} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
