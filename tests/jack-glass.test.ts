import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";
import { LIGHT_WHITE } from "../app/lib/fieldLayout";
import { GLASS, GLASS_FRESNEL_GLSL, GLASS_RIM_GLSL, GLASS_UNIFORM_GLSL, glassRecipe } from "../app/lib/glassLook";
import { GHOST_GLASS, depthPrepassMaterial, dressGlass, ghostGlass, makeGlassMaterial, rankByDepth, tintGlass } from "../app/lib/jackGlass";

// The glass the hero and the card BOTH wear, from one module (the owner: "exactly like the
// jacks on hero"): these pin the material's flags, the one program key, the injection's
// landing points, the depth pre-pass, the ghost and the back-to-front rank, so a change on
// either scene's side is a change to one file and one table.

const ACCENT = "#3b82f6";

test("makeGlassMaterial: the recipe's tint and opacity, FrontSide, transparent, depth-write off at LessEqual, the one program key, opacity mirrored into uGlassOpacity", () => {
  const m = makeGlassMaterial({ family: "black", finish: "glossy" }, "dark", ACCENT);
  const r = glassRecipe("black", "glossy", ACCENT, null);
  assert.equal(m.material.customProgramCacheKey(), GLASS.PROGRAM_KEY);
  assert.equal(m.material.side, THREE.FrontSide);
  assert.equal(m.material.transparent, true);
  assert.equal(m.material.depthWrite, false);
  assert.equal(m.material.depthTest, true);
  assert.equal(m.material.depthFunc, THREE.LessEqualDepth);
  assert.equal(m.material.opacity, r.opacity);
  assert.equal(m.glass.uGlassOpacity.value, m.material.opacity);
  assert.equal(m.material.color.getHexString(), r.color.slice(1));
  assert.equal(m.material.roughness, r.roughness);
  assert.equal(m.material.metalness, 0);
  assert.equal(m.material.clearcoat, GLASS.CLEARCOAT);
  assert.equal(m.material.clearcoatRoughness, GLASS.CLEARCOAT_ROUGHNESS);
  assert.equal(m.material.ior, GLASS.IOR);
  assert.equal(m.material.specularIntensity, GLASS.SPECULAR_INTENSITY);
  assert.equal(m.material.envMapIntensity, GLASS.ENV_MAP_INTENSITY);
  assert.deepEqual({ rim: m.glass.uGlassRim.value, pow: m.glass.uGlassPow.value, light: m.glass.uGlassRimLight.value }, { rim: GLASS.RIM_OPACITY, pow: GLASS.FRESNEL_POWER, light: GLASS.RIM_LIGHT });
  // every family and finish shares the key: the injected source is the same, only uniforms differ
  for (const f of ["black", "accent", "white"] as const) for (const fin of ["glossy", "matte"] as const) {
    const o = makeGlassMaterial({ family: f, finish: fin }, "dark", ACCENT);
    assert.equal(o.material.customProgramCacheKey(), GLASS.PROGRAM_KEY);
    o.material.dispose();
  }
  m.material.dispose();
});

test("the injection lands on three's includes: the uniforms after <common>, the Fresnel after <normal_fragment_begin>, the rim before <opaque_fragment>, and the shader's uniforms ARE the material's", () => {
  const m = makeGlassMaterial({ family: "accent", finish: "matte" }, "dark", ACCENT);
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <common>", fragmentShader: "#include <common>\n#include <normal_fragment_begin>\n#include <opaque_fragment>" };
  m.material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  const fs = shader.fragmentShader;
  assert.ok(fs.indexOf("#include <common>") < fs.indexOf(GLASS_UNIFORM_GLSL) && fs.indexOf(GLASS_UNIFORM_GLSL) < fs.indexOf("#include <normal_fragment_begin>"), "uniforms declared after <common>");
  assert.ok(fs.indexOf("#include <normal_fragment_begin>") < fs.indexOf(GLASS_FRESNEL_GLSL), "the Fresnel after the view-space normal exists");
  assert.ok(fs.indexOf(GLASS_FRESNEL_GLSL) < fs.indexOf(GLASS_RIM_GLSL) && fs.indexOf(GLASS_RIM_GLSL) < fs.indexOf("#include <opaque_fragment>"), "the rim light before the pixel is written");
  assert.equal(fs.split("#include <opaque_fragment>").length, 2, "the include is kept once");
  assert.equal(shader.uniforms.uGlassOpacity, m.glass.uGlassOpacity, "the material's uniforms are the shader's");
  assert.equal(shader.uniforms.uGlassRim, m.glass.uGlassRim);
  assert.equal(shader.vertexShader, "#include <common>", "the vertex shader is untouched");
  m.material.dispose();
});

test("depthPrepassMaterial: colour writes off, depth writes on, FrontSide, still transparent, the SAME program key as the glass, one module-level instance for every scene", () => {
  const p = depthPrepassMaterial();
  assert.equal(depthPrepassMaterial(), p, "a singleton shared by the hero's renderer and the card's");
  assert.equal(p.colorWrite, false);
  assert.equal(p.depthWrite, true);
  assert.equal(p.depthTest, true);
  assert.equal(p.transparent, true, "routed to the transparent list beside the glass");
  assert.equal(p.side, THREE.FrontSide);
  assert.equal(p.depthFunc, THREE.LessEqualDepth);
  assert.equal(p.customProgramCacheKey(), GLASS.PROGRAM_KEY);
  assert.equal(p.customProgramCacheKey(), makeGlassMaterial({ family: "white", finish: "glossy" }, "light", ACCENT).material.customProgramCacheKey());
});

test("tintGlass recolours in place: the light theme's grey for the white family, the new accent for cobalt, opacity and roughness re-applied from the recipe", () => {
  const w = makeGlassMaterial({ family: "white", finish: "matte" }, "dark", ACCENT);
  const before = w.material;
  tintGlass(w, { family: "white", finish: "matte" }, "light", ACCENT);
  assert.equal(w.material, before, "the same material object");
  assert.equal(w.material.color.getHexString(), LIGHT_WHITE.matte.slice(1));
  const r = glassRecipe("white", "matte", ACCENT, LIGHT_WHITE.matte);
  assert.equal(w.material.opacity, r.opacity);
  assert.equal(w.glass.uGlassOpacity.value, r.opacity);
  assert.equal(w.material.roughness, r.roughness);
  const a = makeGlassMaterial({ family: "accent", finish: "glossy" }, "dark", ACCENT);
  tintGlass(a, { family: "accent", finish: "glossy" }, "light", "#2563eb");
  assert.equal(a.material.color.getHexString(), "2563eb");
  assert.equal(a.material.opacity, GLASS.OPACITY.accent);
  w.material.dispose(); a.material.dispose();
});

test("ghostGlass: the unknown week is #2a2a30 at 0.32 with frosted white's roughness, clearcoat kept (one program); dressGlass keeps the ghost through an accent flip and tints a known week", () => {
  assert.deepEqual(GHOST_GLASS, { TINT: "#2a2a30", OPACITY: 0.32 });
  const g = makeGlassMaterial({ family: "accent", finish: "glossy" }, "dark", ACCENT);
  ghostGlass(g);
  assert.equal(g.material.color.getHexString(), "2a2a30");
  assert.equal(g.material.opacity, 0.32);
  assert.equal(g.glass.uGlassOpacity.value, 0.32);
  assert.equal(g.material.roughness, glassRecipe("white", "matte", ACCENT, null).roughness);
  assert.equal(g.material.clearcoat, GLASS.CLEARCOAT);
  assert.equal(g.material.customProgramCacheKey(), GLASS.PROGRAM_KEY);
  // a body, not an outline: inside the cast's per-layer density range
  assert.ok(GHOST_GLASS.OPACITY > GLASS.OPACITY.white && GHOST_GLASS.OPACITY < GLASS.OPACITY.white + GLASS.FROSTED_OPACITY);
  // the card's flip: an unknown jack stays the ghost, a known one takes the new accent
  dressGlass(g, { family: "accent", finish: "glossy" }, false, "dark", "#2563eb");
  assert.equal(g.material.color.getHexString(), "2a2a30", "the flip did not wipe the ghost's tint");
  assert.equal(g.glass.uGlassOpacity.value, 0.32, "or its opacity");
  const k = makeGlassMaterial({ family: "accent", finish: "glossy" }, "dark", ACCENT);
  dressGlass(k, { family: "accent", finish: "glossy" }, true, "dark", "#2563eb");
  assert.equal(k.material.color.getHexString(), "2563eb");
  assert.equal(k.glass.uGlassOpacity.value, GLASS.OPACITY.accent);
  g.material.dispose(); k.material.dispose();
});

test("rankByDepth: renderOrder is a permutation of 0..n−1 ascending with z, ties by index, over ALL indices — a null group consumes its rank", () => {
  const groups = [new THREE.Group(), new THREE.Group(), null, new THREE.Group(), new THREE.Group()];
  //          index:   0     1     2(null)  3     4
  const zs = [0.5, -1.2, 0.0, 0.5, 2.1];
  rankByDepth(groups, zs);
  // by z: 1 (−1.2) → 0, 2 (0.0, null) → 1, 0 (0.5) → 2, 3 (0.5, tie by index) → 3, 4 (2.1) → 4
  assert.deepEqual(groups.map((g) => g?.renderOrder ?? -1), [2, 0, -1, 3, 4]);
  // re-ranking after a move re-sorts in place, and the stale ranks are overwritten
  zs[4] = -5;
  rankByDepth(groups, zs);
  assert.deepEqual(groups.map((g) => g?.renderOrder ?? -1), [3, 1, -1, 4, 0]);
  // the hero's rule, as the harness checks it: sort indices by z then index, renderOrder[body] === rank
  const many = Array.from({ length: 21 }, () => new THREE.Group());
  const z = many.map((_, i) => Math.sin(i * 1.7) * 2);
  rankByDepth(many, z);
  const byDepth = z.map((_, i) => i).sort((a, b) => z[a] - z[b] || a - b);
  assert.ok(byDepth.every((body, rank) => many[body].renderOrder === rank));
  assert.deepEqual([...many.map((g) => g.renderOrder)].sort((a, b) => a - b), many.map((_, i) => i));
});
