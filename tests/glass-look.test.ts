import { test } from "node:test";
import assert from "node:assert/strict";

import { GLASS, GLASS_FRESNEL_GLSL, GLASS_RIM_GLSL, GLASS_UNIFORMS, GLASS_UNIFORM_GLSL, glassFinish, glassRecipe } from "../app/lib/glassLook";

test("the glass constants: the ruled recipe", () => {
  assert.equal(GLASS.SMOKE, "#0b0b10");
  assert.equal(GLASS.FROSTED_WHITE, "#e6e7ec");
  assert.deepEqual(GLASS.OPACITY, { black: 0.66, accent: 0.6, white: 0.48 });
  assert.deepEqual(GLASS.ROUGHNESS, { clear: 0.08, frosted: 0.28 });
  assert.equal(GLASS.FROSTED_OPACITY, 0.08);
  assert.equal(GLASS.CLEARCOAT, 1);
  assert.equal(GLASS.CLEARCOAT_ROUGHNESS, 0.06);
  assert.equal(GLASS.IOR, 1.5);
  assert.equal(GLASS.SPECULAR_INTENSITY, 1);
  assert.equal(GLASS.ENV_MAP_INTENSITY, 1.4);
  assert.equal(GLASS.FRESNEL_POWER, 2.5);
  assert.equal(GLASS.RIM_OPACITY, 0.34);
  assert.equal(GLASS.RIM_LIGHT, 0.08);
});

test("one layer per pixel: the chosen table sits between the DoubleSide round's single-layer values (0.55 / 0.50 / 0.38, rim 0.45 — glass, but pale) and their two-layer compensation (0.80 / 0.75 / 0.62, rim 0.20 — the density, but solid plastic); smoke's rim still tops out at 1.0", () => {
  const twoLayers = (a: number) => 1 - (1 - a) * (1 - a);
  const old = { black: 0.55, accent: 0.5, white: 0.38 } as const;
  for (const f of ["black", "accent", "white"] as const) {
    assert.ok(GLASS.OPACITY[f] > old[f] && GLASS.OPACITY[f] < twoLayers(old[f]), `${f}: ${old[f]} < ${GLASS.OPACITY[f]} < ${twoLayers(old[f])}`);
  }
  assert.ok(GLASS.RIM_OPACITY > 0.2 && GLASS.RIM_OPACITY < 0.45, `rim ${GLASS.RIM_OPACITY}`);
  assert.ok(Math.abs(Math.min(1, GLASS.OPACITY.black + GLASS.RIM_OPACITY) - 1) < 1e-9, "the smoke rim reaches 1.0");
  assert.ok(Math.abs(GLASS.OPACITY.accent + GLASS.RIM_OPACITY - 0.94) < 1e-9 && Math.abs(GLASS.OPACITY.white + GLASS.RIM_OPACITY - 0.82) < 1e-9, "the accent's rim 0.94, the white's 0.82");
});

test("finishes: the card's glossy is clear glass, its matte frosted — rougher and a little (0.08) denser", () => {
  assert.equal(glassFinish("glossy"), "clear");
  assert.equal(glassFinish("matte"), "frosted");
  const clear = glassRecipe("black", "glossy", "#3b82f6", null), frosted = glassRecipe("black", "matte", "#3b82f6", null);
  assert.deepEqual(clear, { color: "#0b0b10", opacity: 0.66, roughness: 0.08, finish: "clear" });
  assert.equal(frosted.color, "#0b0b10"); assert.equal(frosted.roughness, 0.28); assert.equal(frosted.finish, "frosted");
  assert.ok(Math.abs(frosted.opacity - 0.74) < 1e-9, `frosted black ${frosted.opacity}`);
});

test("tints: smoke for black, the accent token for cobalt, frosted white — or the light theme's grey — for white", () => {
  assert.equal(glassRecipe("accent", "glossy", "#2563eb", null).color, "#2563eb");
  assert.equal(glassRecipe("accent", "glossy", "#2563eb", null).opacity, 0.6);
  const w = glassRecipe("white", "glossy", "#3b82f6", null);
  assert.deepEqual(w, { color: "#e6e7ec", opacity: 0.48, roughness: 0.28, finish: "clear" });
  const wf = glassRecipe("white", "matte", "#3b82f6", null);
  assert.ok(Math.abs(wf.opacity - 0.56) < 1e-9 && wf.roughness === 0.48, `frosted white ${wf.opacity} / ${wf.roughness}`);
  assert.equal(glassRecipe("white", "glossy", "#3b82f6", "#a3a5ad").color, "#a3a5ad", "light theme: the grey keeps frosted white a body on a white page");
  for (const f of ["black", "accent", "white"] as const) for (const fin of ["glossy", "matte"] as const) {
    const r = glassRecipe(f, fin, "#3b82f6", null);
    // one layer per pixel: the chosen table runs 0.48–0.74 (0.3–0.7 in the DoubleSide round)
    assert.ok(r.opacity >= 0.45 && r.opacity <= 0.8, `${f} ${fin} opacity ${r.opacity}`);
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
