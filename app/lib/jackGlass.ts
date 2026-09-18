// The jack's GLASS, worn by every scene that draws one — the hero's field (JackFieldScene.tsx)
// and the GitHub card (ConnectorField.tsx). The owner on the card after the field got its glass:
// "can the jacks in the github card have the same tinted glass effect exactly like the jacks on
// hero?" — and "exactly" is only true by construction: one module builds the material, tints
// it, hands out the depth pre-pass and ranks the groups, so the two scenes cannot drift apart
// by a number. The table (tints, opacities, roughness, the Fresnel and rim terms, the program
// key) is glassLook.ts, three-free and tested in node; this file is the three side of it,
// lifted from JackFieldScene.tsx unchanged in behaviour. Imports three, so it is not "pure" in
// the tests' sense; everything it exports is still constructed without a WebGL context.
//
// The look, ONE layer per pixel: a MeshPhysicalMaterial, transparent, alpha-blended, FrontSide,
// depth-write off, drawn AFTER a depth pre-pass of the same triangles on the SAME program
// (depthPrepassMaterial: colour writes off, depth writes on), so only each jack's nearest front
// surface is composited and the interior — the core sphere, the arm bases, the far walls — is
// culled by the depth test. The plastic round's AO bake and neighbour-occlusion injection are NOT
// on the glass (composed with alpha blending they read as a dark solid ball inside every jack — the
// crotch bakes at 0.65, the bores at 0.01–0.2), and glass takes no contact crease. Between
// jacks, rankByDepth orders the groups back to front each frame so a nearer jack still blends
// over a farther one — a pack is three or four jacks deep at its core, and the card's dozen
// stack the same way.

import * as THREE from "three";
import { LIGHT_WHITE, type Slot } from "./fieldLayout";
import { GLASS, GLASS_FRESNEL_GLSL, GLASS_RIM_GLSL, GLASS_UNIFORM_GLSL, glassRecipe } from "./glassLook";

export interface GlassMaterial { material: THREE.MeshPhysicalMaterial; glass: { uGlassOpacity: { value: number }; uGlassRim: { value: number }; uGlassPow: { value: number }; uGlassRimLight: { value: number } } }

/**
 * A slot's glass: a MeshPhysicalMaterial, transparent, alpha-blended, FrontSide (the bore's
 * far wall and floor are front faces seen through the mouth, so the tips still read as
 * hollow), depth-write off, depthFunc LessEqual (three's default, stated) so it lands exactly
 * on the depth the pre-pass (depthPrepassMaterial) wrote for the same triangles, the clearcoat
 * reflecting the one-plane environment, with the Fresnel opacity and rim-light terms injected
 * (glassLook.ts). One program for every jack in a scene AND the pre-pass (GLASS.PROGRAM_KEY):
 * the injected source is the same for every family, only uniforms differ. No polygonOffset:
 * the two passes run one program on one geometry with one matrix, so gl_Position is
 * bit-identical by construction and LessEqual passes exactly; if the Metal-GPU frame ever
 * showed speckle at the arm edges, the fallback is polygonOffset on THIS colour pass (factor
 * −1, units −1). `theme` picks the white family's tint: the light theme's greys on the page
 * (fieldLayout.LIGHT_WHITE), frosted white on a dark ground — the card's panel is dark in both
 * themes, so the card always passes "dark".
 */
export function makeGlassMaterial(slot: Slot, theme: "dark" | "light", accent: string): GlassMaterial {
  const r = glassRecipe(slot.family, slot.finish, accent, theme === "light" ? LIGHT_WHITE[slot.finish] : null);
  const material = new THREE.MeshPhysicalMaterial({
    color: r.color,
    transparent: true,
    opacity: r.opacity,
    metalness: 0,
    roughness: r.roughness,
    clearcoat: GLASS.CLEARCOAT,
    clearcoatRoughness: GLASS.CLEARCOAT_ROUGHNESS,
    ior: GLASS.IOR,
    specularIntensity: GLASS.SPECULAR_INTENSITY,
    envMapIntensity: GLASS.ENV_MAP_INTENSITY,
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
  });
  const glass = { uGlassOpacity: { value: r.opacity }, uGlassRim: { value: GLASS.RIM_OPACITY }, uGlassPow: { value: GLASS.FRESNEL_POWER }, uGlassRimLight: { value: GLASS.RIM_LIGHT } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glass);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + GLASS_UNIFORM_GLSL)
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n" + GLASS_FRESNEL_GLSL)
      .replace("#include <opaque_fragment>", GLASS_RIM_GLSL + "\n#include <opaque_fragment>");
  };
  material.customProgramCacheKey = () => GLASS.PROGRAM_KEY;
  return { material, glass };
}

/** recolour a slot's glass in place for a theme/accent flip: tint, opacity and roughness are uniforms */
export function tintGlass(m: GlassMaterial, slot: Slot, theme: "dark" | "light", accent: string): void {
  const r = glassRecipe(slot.family, slot.finish, accent, theme === "light" ? LIGHT_WHITE[slot.finish] : null);
  m.material.color.set(r.color);
  m.material.opacity = r.opacity;
  m.glass.uGlassOpacity.value = r.opacity;
  m.material.roughness = r.roughness;
}

/**
 * The card's UNKNOWN week (the route's paging cut off before it began): a ghost, outside the
 * casting so it cannot be read as a quiet white or black. The opaque round made it the panel
 * lightened 8% (#2a2a30), matte, no clearcoat; in glass it is the frosted-white recipe — the
 * white family's frosted roughness, the clearcoat kept at 1 so it stays on the one program —
 * with the tint set to that same neutral grey and the opacity 0.32: a BODY, not an outline
 * (the brief's half-white 0.14 composited to a quiet black on the panel — the controller's
 * ruling on the critique), between the white family's 0.28 and frosted white's 0.36, so it sits
 * in the cast's density range while its grey keeps it outside the casting's tints (smoke #0b0b10,
 * frosted white #e6e7ec, the accent). #151515 was rejected for the same reason: it composites to
 * the panel. The legend states the cut ("older weeks unknown"); this only keeps the ghost honest.
 */
export const GHOST_GLASS = { TINT: "#2a2a30", OPACITY: 0.32 } as const;

/** dress a slot's glass as the ghost, in place (the same program: only uniforms change) */
export function ghostGlass(m: GlassMaterial): void {
  const frosted = glassRecipe("white", "matte", GHOST_GLASS.TINT, null);
  m.material.color.set(GHOST_GLASS.TINT);
  m.material.opacity = GHOST_GLASS.OPACITY;
  m.glass.uGlassOpacity.value = GHOST_GLASS.OPACITY;
  m.material.roughness = frosted.roughness;
}

/**
 * The card's theme/accent flip, per jack: a KNOWN week wears its slot's recipe under the
 * accent (tintGlass re-applies glassRecipe unconditionally), an unknown one the ghost — the
 * branch is what keeps a flip from wiping the ghost back to its family's tint.
 */
export function dressGlass(m: GlassMaterial, slot: Slot, known: boolean, theme: "dark" | "light", accent: string): void {
  if (known) tintGlass(m, slot, theme, accent);
  else ghostGlass(m);
}

/**
 * A slot's glass, BORN dressed: built by makeGlassMaterial and, for an unknown week, made the
 * ghost in the same call — so the material is right before any effect runs. The card's first
 * frame is R3F's rAF, scheduled during the commit; React's passive effects flush after paint
 * (measured 357 ms later on the card), so a ghost dressed only by an effect would draw as a
 * cast member for the first frame(s) of the entrance and then snap (the review of this round).
 */
export function makeDressedGlass(slot: Slot, known: boolean, theme: "dark" | "light", accent: string): GlassMaterial {
  const m = makeGlassMaterial(slot, theme, accent);
  if (!known) ghostGlass(m);
  return m;
}

/**
 * The depth pre-pass, one material for every jack: the SAME program as the glass — built by
 * makeGlassMaterial (any slot; its tint is never written) with the same onBeforeCompile
 * injection and customProgramCacheKey — so three hands both meshes one WebGLProgram and their
 * gl_Position is bit-identical by construction. Two DIFFERENT programs (a MeshBasicMaterial
 * pre-pass, say) are not guaranteed identical positions by GLSL ES (§4.6.1: invariance only
 * for `invariant` outputs), and a swiftshader frame cannot clear that risk for the owner's
 * Metal GPU. Colour writes off, depth writes on, FrontSide, and still `transparent` so it sits
 * in the transparent render list next to the glass (WebGLRenderLists routes by transmission,
 * then material.transparent; colorWrite is not consulted). The physical fragment shader runs
 * with colour writes off — ≈ 17 k fragments per jack, negligible. Module-level singleton, never
 * disposed (`dispose={null}` on its meshes); each scene takes it through `useMemo`. One
 * material across two renderers is fine for the same reason the geometry is (jackMaterials.ts):
 * a WebGLRenderer keeps its own program and properties per material, so the hero's canvas and
 * the card's each compile their own copy of the one program.
 *
 * three APPENDS the custom key to its parameter-derived key (WebGLPrograms.getProgramCacheKey),
 * so the share also depends on `transparent: true` (the `opaque` parameter) and FrontSide
 * matching the glass — `programsUnchanged` / `glassPrograms` in the harness is the guard; do
 * not "optimise" the pre-pass to opaque or DoubleSide.
 */
let prepass: THREE.MeshPhysicalMaterial | null = null;
export function depthPrepassMaterial(): THREE.MeshPhysicalMaterial {
  if (!prepass) {
    const m = makeGlassMaterial({ family: "black", finish: "glossy" }, "dark", "#3b82f6").material;
    m.colorWrite = false;
    m.depthWrite = true;
    m.depthTest = true;
    m.side = THREE.FrontSide;
    m.transparent = true;
    prepass = m;
  }
  return prepass;
}

/** the rank's scratch: the indices, re-sorted in place each frame (no allocation past the first) */
const order: number[] = [];

/**
 * The back-to-front rank: each group's renderOrder is its body's rank by z ascending (both
 * scenes' cameras sit at (0, 0, z) unrotated, so pos.z is exact view depth), ties by index — a
 * stable order. three's transparent list sorts by groupOrder (a Group's renderOrder, inherited
 * by its subtree), then renderOrder, then z, so the list interleaves per jack, farthest first:
 * depth pass (renderOrder 0), colour pass (1), next jack… A nearer jack's pre-pass overwrites the
 * depth where it is nearer and its colour pass blends over the farther jack: glass still shows
 * through glass between jacks. Bodies at equal depth cannot interpenetrate (the collision keeps
 * them apart), so their silhouettes only touch in screen space and a rank flip changes no pixel.
 * `zs[i]` is group i's depth; a null group (not yet mounted) is skipped.
 */
export function rankByDepth(groups: readonly (THREE.Group | null)[], zs: ArrayLike<number>): void {
  const n = zs.length;
  order.length = n;
  for (let j = 0; j < n; j++) order[j] = j;
  order.sort((a, b) => zs[a] - zs[b] || a - b);
  for (let k = 0; k < n; k++) {
    const g = groups[order[k]];
    if (g) g.renderOrder = k;
  }
}
