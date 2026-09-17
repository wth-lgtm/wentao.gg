import { test } from "node:test";
import assert from "node:assert/strict";

import { GLASS, GLASS_FRESNEL_GLSL, GLASS_RIM_GLSL, GLASS_UNIFORMS, GLASS_UNIFORM_GLSL, glassFinish, glassRecipe } from "../app/lib/glassLook";

test("the glass constants: the ruled recipe", () => {
  assert.equal(GLASS.SMOKE, "#0b0b10");
  assert.equal(GLASS.FROSTED_WHITE, "#e6e7ec");
  assert.deepEqual(GLASS.OPACITY, { black: 0.55, accent: 0.5, white: 0.38 });
  assert.deepEqual(GLASS.ROUGHNESS, { clear: 0.08, frosted: 0.28 });
  assert.equal(GLASS.CLEARCOAT, 1);
  assert.equal(GLASS.CLEARCOAT_ROUGHNESS, 0.06);
  assert.equal(GLASS.IOR, 1.5);
  assert.equal(GLASS.SPECULAR_INTENSITY, 1);
  assert.equal(GLASS.ENV_MAP_INTENSITY, 1.4);
  assert.equal(GLASS.FRESNEL_POWER, 2.5);
  assert.equal(GLASS.RIM_OPACITY, 0.45);
  assert.equal(GLASS.RIM_LIGHT, 0.08);
});

test("finishes: the card's glossy is clear glass, its matte frosted — rougher and a tenth denser", () => {
  assert.equal(glassFinish("glossy"), "clear");
  assert.equal(glassFinish("matte"), "frosted");
  const clear = glassRecipe("black", "glossy", "#3b82f6", null), frosted = glassRecipe("black", "matte", "#3b82f6", null);
  assert.deepEqual(clear, { color: "#0b0b10", opacity: 0.55, roughness: 0.08, finish: "clear" });
  assert.deepEqual(frosted, { color: "#0b0b10", opacity: 0.65, roughness: 0.28, finish: "frosted" });
});

test("tints: smoke for black, the accent token for cobalt, frosted white — or the light theme's grey — for white", () => {
  assert.equal(glassRecipe("accent", "glossy", "#2563eb", null).color, "#2563eb");
  assert.equal(glassRecipe("accent", "glossy", "#2563eb", null).opacity, 0.5);
  const w = glassRecipe("white", "glossy", "#3b82f6", null);
  assert.deepEqual(w, { color: "#e6e7ec", opacity: 0.38, roughness: 0.28, finish: "clear" });
  const wf = glassRecipe("white", "matte", "#3b82f6", null);
  assert.ok(Math.abs(wf.opacity - 0.48) < 1e-9 && wf.roughness === 0.48);
  assert.equal(glassRecipe("white", "glossy", "#3b82f6", "#a3a5ad").color, "#a3a5ad", "light theme: the grey keeps frosted white a body on a white page");
  for (const f of ["black", "accent", "white"] as const) for (const fin of ["glossy", "matte"] as const) {
    const r = glassRecipe(f, fin, "#3b82f6", null);
    assert.ok(r.opacity > 0.3 && r.opacity <= 0.7, `${f} ${fin} opacity ${r.opacity}`);
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
