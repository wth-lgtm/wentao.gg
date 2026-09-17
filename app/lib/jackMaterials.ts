// The jack's LOOK, shared by every scene that draws one: the geometry singleton, the seven
// material recipes and their neighbour-occlusion shader, the one-plane environment and the
// key light. Lifted verbatim from ConnectorField.tsx (the GitHub card's scene) when the hero
// got the same object (HeroConnectors.tsx) — lusion.co uses one body across its whole page and
// lets arrangement, count, scale and light differentiate, and every number here was measured
// against THIS jack (the profile off cross.buf, the ao bake, the sphere-body contact model that
// is exact only because its arm tips lie on the 1.05 sphere), so two scenes read as two rooms of
// one house only if they draw from one table. Imports three, so it is not a "pure" module in
// the tests' sense; what it exports is still constructed without a WebGL context.

import * as THREE from "three";
import type { Family, Finish } from "./connectorJacks";
import { buildJackGeometry } from "./jackGeometry";

// There is ONE key light on this site and it sits up and to the RIGHT — the direction the
// board's extruded cells (CommitHeatmap FACE_LIT/FACE_SHADE) and the hero's caustic are
// painted for. Lusion's own key is (10, 10, 5), the same quadrant. 2.2 with the environment
// below; it was 3.5 when the pile had no environment at all.
export const KEY = { position: [6, 8, 2.5] as [number, number, number], intensity: 2.2 };

// The environment is one emissive plane on the key's side plus a uniform grey floor —
// house rule: a shaped former is a lamp, an unshaped floor is fill. The glossy jacks are
// near-mirrors (clearcoat 1, clearcoatRoughness 0.06–0.08) and reflect every shaped emitter
// as its own rectangle, so a ceiling rect and two side panels read as three extra lights on
// exactly the family whose look is "black reads only through what it reflects". The floor
// gives black a Fresnel silhouette without a second highlight. Built with three core (~25
// lines) rather than drei's Environment, which statically imports gainmap-js, RGBELoader,
// EXRLoader and GroundProjectedEnv (772 KB dist) even when it fetches nothing.
export const ENV = { plane: [6, 4] as [number, number], position: [5, 6, 4] as [number, number, number], intensity: 4, floor: 0.15 };
/** the stone field's environmentIntensity: matte stones (roughness 0.78–0.9, no clearcoat) need less of the plane's sheen than the card's clearcoats at 1.0 */
export const ENV_INTENSITY_STONES = 0.8;

// Per-mesh neighbour occlusion: the other bodies as spheres of their CORE radius (0.55·scale
// — the 1.05 body sphere is ~70% empty and at contact subtends 90°, a smudge not a crease),
// iq's sphere occlusion with the horizon clamp, multiplied, capped at 60% darkening. The
// scalar fallback (one strength per mesh from the same distances) is selected at build time,
// never by a runtime probe: flip NEAR_FALLBACK if the injection ever misbehaves on a driver.
export const NEAR_CORE = 0.55;
export const NEAR_FALLBACK = false;

// ---- geometry, shared by every mesh in every scene and never disposed with one ----
// One BufferGeometry across renderers is fine: a WebGLRenderer keeps its own attribute
// buffers per geometry, and no scene ever disposes it (`dispose={null}` on the meshes).
let JACK: THREE.BufferGeometry | null = null;
export const jackGeometry = () => (JACK ??= buildJackGeometry());

// ---- materials ----
// MeshPhysicalMaterial, metalness 0, specularIntensity 0.8 (F0 0.032 — plastic and enamel,
// not glass) unless stated. The matte accent is color-mix(accent 85%, black): the token under
// a strong key reads pastel, and the reference's matte cobalt is darker than its gloss. Matte
// black is #26262b, not the token-dark #111114: the latter is darker than the panel and its
// lit face computed to #13 — a hole with a rim. The reference floors its diffuse at 0.25.
export type Recipe = { color: string | "accent" | "accent-matte"; roughness: number; clearcoat: number; clearcoatRoughness: number; specularIntensity?: number };
export const RECIPES: Record<Family, Record<Finish, Recipe>> = {
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
/** the dark theme's --accent, every scene's initial value; the live token is written in by an effect */
export const DEFAULT_ACCENT = "#3b82f6";

/** The token is a hex string; the matte accent keeps 85% of it in sRGB, as color-mix would. */
export function setAccent(target: THREE.Color, accent: string, keep: number) {
  const c = new THREE.Color(accent);
  const rgb = { r: 0, g: 0, b: 0 };
  c.getRGB(rgb, THREE.SRGBColorSpace);
  target.setRGB(rgb.r * keep, rgb.g * keep, rgb.b * keep, THREE.SRGBColorSpace);
}

export function colorFor(recipe: Recipe, accent: string): THREE.Color {
  const c = new THREE.Color();
  if (recipe.color === "accent") setAccent(c, accent, 1);
  else if (recipe.color === "accent-matte") setAccent(c, accent, 0.85);
  else c.set(recipe.color);
  return c;
}

export interface JackUniforms {
  uNear: { value: THREE.Vector4[] };
  /** 1 = the neighbour occlusion is on; 0 = off (the perf tier's second step) */
  uNao: { value: number };
  /** the scalar fallback's darkening for this mesh, 0..0.6 */
  uNaoScalar: { value: number };
}

// iq's sphere occlusion (iquilezles.org/articles/sphereao): (r/l)²·max(0, n·l̂) in the far
// field, the exact integral where the sphere crosses the horizon.
export const nearGlsl = (count: number) => /* glsl */ `
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
export const AO_GLSL = /* glsl */ `
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

/** One jack's material from its recipe, with room for `near` neighbours in the occlusion loop. */
export function makeMaterial(recipe: Recipe, near: number): { material: THREE.MeshPhysicalMaterial; uniforms: JackUniforms } {
  const uniforms: JackUniforms = {
    uNear: { value: Array.from({ length: near }, () => new THREE.Vector4(0, 0, 0, 1e-3)) },
    uNao: { value: 1 },
    uNaoScalar: { value: 0 },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: colorFor(recipe, DEFAULT_ACCENT),
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
  // A scene's materials differ only in uniforms (colour, roughness, clearcoat amounts) and
  // the same injected source, so they share ONE program (two, with a clearcoat-less recipe
  // such as the card's ghost) — a key per family/finish would compile six identical ones. The
  // default key is onBeforeCompile.toString(); explicit is free and does not hang on a
  // closure's text.
  material.customProgramCacheKey = () => "jack";
  return { material, uniforms };
}

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
