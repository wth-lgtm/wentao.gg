// The jack's OBJECT, shared by every scene that draws one: the geometry singleton, the key
// light and the one-plane environment. Lifted from ConnectorField.tsx (the GitHub card's scene)
// when the hero got the same object (JackFieldScene.tsx) — lusion.co uses one body across its
// whole page and lets arrangement, count, scale and light differentiate, and every number here
// was measured against THIS jack (the profile off cross.buf, the sphere-body contact model that
// is exact only because its arm tips lie on the 1.05 sphere), so two scenes read as two rooms of
// one house only if they draw from one table. What the jack WEARS is elsewhere: the glass lives
// in jackGlass.ts (the material, the tint, the depth pre-pass, the back-to-front rank) and its
// look table in glassLook.ts; the plastic round's seven opaque recipes and their AO /
// neighbour-occlusion shader left with the card's move to glass (2026-09-17). Imports three, so
// it is not a "pure" module in the tests' sense; what it exports is still constructed without a
// WebGL context.

import * as THREE from "three";
import { buildJackGeometry } from "./jackGeometry";

// There is ONE key light on this site and it sits up and to the RIGHT — the direction the
// board's extruded cells (CommitHeatmap FACE_LIT/FACE_SHADE) and the hero's caustic are
// painted for. Lusion's own key is (10, 10, 5), the same quadrant. 2.2 with the environment
// below; it was 3.5 when the pile had no environment at all.
export const KEY = { position: [6, 8, 2.5] as [number, number, number], intensity: 2.2 };

// The environment is one emissive plane on the key's side plus a uniform grey floor —
// house rule: a shaped former is a lamp, an unshaped floor is fill. The glass jacks are
// near-mirrors (clearcoat 1, clearcoatRoughness 0.06) and reflect every shaped emitter
// as its own rectangle, so a ceiling rect and two side panels read as three extra lights on
// exactly the family whose look is "black reads only through what it reflects". The floor
// gives black a Fresnel silhouette without a second highlight. Built with three core (~25
// lines) rather than drei's Environment, which statically imports gainmap-js, RGBELoader,
// EXRLoader and GroundProjectedEnv (772 KB dist) even when it fetches nothing.
export const ENV = { plane: [6, 4] as [number, number], position: [5, 6, 4] as [number, number, number], intensity: 4, floor: 0.15 };

// ---- geometry, shared by every mesh in every scene and never disposed with one ----
// One BufferGeometry across renderers is fine: a WebGLRenderer keeps its own attribute
// buffers per geometry, and no scene ever disposes it (`dispose={null}` on the meshes).
let JACK: THREE.BufferGeometry | null = null;
export const jackGeometry = () => (JACK ??= buildJackGeometry());

// ---- environment ----
// Module-level and never disposed, on purpose: one 6×4 plane and one material for the page's
// lifetime. The PMREM target built from it per context IS disposed, by the scene that built it.
let envScene: THREE.Scene | null = null;
export function environmentScene(): THREE.Scene {
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
