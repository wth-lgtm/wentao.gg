import { test } from "node:test";
import assert from "node:assert/strict";

import { GLASS, GLASS_FRESNEL_GLSL, GLASS_RIM_GLSL, GLASS_UNIFORMS, GLASS_UNIFORM_GLSL, glassFinish, glassRecipe } from "../app/lib/glassLook";

test("the glass constants: the ruled recipe — the packs' clearer table", () => {
  assert.equal(GLASS.SMOKE, "#0b0b10");
  assert.equal(GLASS.FROSTED_WHITE, "#e6e7ec");
  assert.deepEqual(GLASS.OPACITY, { black: 0.42, accent: 0.38, white: 0.28 });
  assert.deepEqual(GLASS.ROUGHNESS, { clear: 0.08, frosted: 0.28 });
  assert.equal(GLASS.FROSTED_OPACITY, 0.08);
  assert.equal(GLASS.CLEARCOAT, 1);
  assert.equal(GLASS.CLEARCOAT_ROUGHNESS, 0.06);
  assert.equal(GLASS.IOR, 1.5);
  assert.equal(GLASS.SPECULAR_INTENSITY, 1);
  assert.equal(GLASS.ENV_MAP_INTENSITY, 1.4);
  assert.equal(GLASS.FRESNEL_POWER, 2.5);
  assert.equal(GLASS.RIM_OPACITY, 0.5);
  assert.equal(GLASS.RIM_LIGHT, 0.08);
});

test("clearer for the packs: the base sits below the packs' first candidate (0.50 / 0.45 / 0.34, compared on the GPU) and the lattice's table (0.66 / 0.60 / 0.48); a pack is three or four jacks deep at its core, where 1 − (1 − a)³ (0.80 / 0.76 / 0.63) composites denser than the lattice's single layer ever was, so the base only decides how clear the edges and the lone jacks read; the rim is 0.50 so smoke's rim reaches 0.92, the accent's 0.88, the white's 0.78 and frosted smoke's exactly 1.0", () => {
  const lattice = { black: 0.66, accent: 0.6, white: 0.48 } as const;
  const candidate = { black: 0.5, accent: 0.45, white: 0.34 } as const;
  const threeDeep = (a: number) => 1 - (1 - a) ** 3;
  for (const f of ["black", "accent", "white"] as const) {
    assert.ok(GLASS.OPACITY[f] < candidate[f] && candidate[f] < lattice[f], `${f}: ${GLASS.OPACITY[f]} < ${candidate[f]} < ${lattice[f]}`);
    assert.ok(threeDeep(GLASS.OPACITY[f]) > lattice[f], `${f} three deep composites ${threeDeep(GLASS.OPACITY[f])} — denser than one lattice layer ${lattice[f]}`);
  }
  assert.ok(Math.abs(threeDeep(GLASS.OPACITY.black) - 0.805) < 1e-3 && Math.abs(threeDeep(GLASS.OPACITY.accent) - 0.762) < 1e-3 && Math.abs(threeDeep(GLASS.OPACITY.white) - 0.627) < 1e-3);
  assert.ok(Math.abs(GLASS.OPACITY.black + GLASS.RIM_OPACITY - 0.92) < 1e-9, "the smoke rim reaches 0.92");
  assert.ok(Math.abs(GLASS.OPACITY.accent + GLASS.RIM_OPACITY - 0.88) < 1e-9 && Math.abs(GLASS.OPACITY.white + GLASS.RIM_OPACITY - 0.78) < 1e-9, "the accent's rim 0.88, the white's 0.78");
  assert.ok(Math.abs(GLASS.OPACITY.black + GLASS.FROSTED_OPACITY + GLASS.RIM_OPACITY - 1) < 1e-9, "frosted smoke's rim is the densest pixel, exactly 1.0");
  // the dark theme's floor for a LONE smoke jack was 0.45 (the lattice round); a pack's core stacks, so 0.42 holds
  assert.ok(GLASS.OPACITY.black >= 0.4);
});

test("finishes: the card's glossy is clear glass, its matte frosted — rougher and a little (0.08) denser", () => {
  assert.equal(glassFinish("glossy"), "clear");
  assert.equal(glassFinish("matte"), "frosted");
  const clear = glassRecipe("black", "glossy", "#3b82f6", null), frosted = glassRecipe("black", "matte", "#3b82f6", null);
  assert.deepEqual(clear, { color: "#0b0b10", opacity: 0.42, roughness: 0.08, finish: "clear" });
  assert.equal(frosted.color, "#0b0b10"); assert.equal(frosted.roughness, 0.28); assert.equal(frosted.finish, "frosted");
  assert.ok(Math.abs(frosted.opacity - 0.5) < 1e-9, `frosted black ${frosted.opacity}`);
});

test("tints: smoke for black, the accent token for cobalt, frosted white — or the light theme's grey — for white", () => {
  assert.equal(glassRecipe("accent", "glossy", "#2563eb", null).color, "#2563eb");
  assert.equal(glassRecipe("accent", "glossy", "#2563eb", null).opacity, 0.38);
  const w = glassRecipe("white", "glossy", "#3b82f6", null);
  assert.deepEqual(w, { color: "#e6e7ec", opacity: 0.28, roughness: 0.28, finish: "clear" });
  const wf = glassRecipe("white", "matte", "#3b82f6", null);
  assert.ok(Math.abs(wf.opacity - 0.36) < 1e-9 && wf.roughness === 0.48, `frosted white ${wf.opacity} / ${wf.roughness}`);
  assert.equal(glassRecipe("white", "glossy", "#3b82f6", "#a3a5ad").color, "#a3a5ad", "light theme: the grey keeps frosted white a body on a white page");
  for (const f of ["black", "accent", "white"] as const) for (const fin of ["glossy", "matte"] as const) {
    const r = glassRecipe(f, fin, "#3b82f6", null);
    // the packs' table runs 0.28–0.50 per layer (the lattice's 0.48–0.74; the DoubleSide round's 0.3–0.7)
    assert.ok(r.opacity >= 0.25 && r.opacity <= 0.55, `${f} ${fin} opacity ${r.opacity}`);
    assert.ok(r.roughness >= 0.08 && r.roughness <= 0.5);
  }
});

test("the injection: four uniforms declared, Fresnel writes diffuseColor.a from the view-space normal, the rim adds to the outgoing light", () => {
  for (const u of GLASS_UNIFORMS) assert.ok(GLASS_UNIFORM_GLSL.includes(`uniform float ${u};`), u);
  assert.ok(GLASS_FRESNEL_GLSL.includes("dot(normalize(normal), normalize(vViewPosition))"));
  assert.ok(GLASS_FRESNEL_GLSL.includes("diffuseColor.a = mix(uGlassOpacity, min(1.0, uGlassOpacity + uGlassRim), glassF)"));
  assert.ok(GLASS_RIM_GLSL.includes("outgoingLight += glassF * uGlassRimLight"));
  assert.equal(GLASS.PROGRAM_KEY, "jack-glass");
});
