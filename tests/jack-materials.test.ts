import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";
import { AO_GLSL, DEFAULT_ACCENT, ENV, KEY, NEAR_CORE, RECIPES, colorFor, environmentScene, jackGeometry, makeMaterial, nearGlsl } from "../app/lib/jackMaterials";

// The look was lifted out of ConnectorField.tsx without a behaviour change; these pin the
// numbers the card was tuned to so a hero-side edit cannot drift them by accident.

test("one key light, up and to the right, and the one-plane environment — the card's numbers", () => {
  assert.deepEqual(KEY, { position: [6, 8, 2.5], intensity: 2.2 });
  assert.deepEqual(ENV, { plane: [6, 4], position: [5, 6, 4], intensity: 4, floor: 0.15 });
  assert.equal(NEAR_CORE, 0.55);
});

test("the seven recipes are the card's: metalness-free plastic, two-thirds matte, the reference's diffuse floor", () => {
  assert.deepEqual(RECIPES.accent.matte, { color: "accent-matte", roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5 });
  assert.deepEqual(RECIPES.accent.glossy, { color: "accent", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
  assert.deepEqual(RECIPES.white.matte, { color: "#d4d6db", roughness: 0.72, clearcoat: 0.1, clearcoatRoughness: 0.6 });
  assert.deepEqual(RECIPES.white.glossy, { color: "#e8e9ee", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  assert.deepEqual(RECIPES.black.matte, { color: "#26262b", roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35, specularIntensity: 1.0 });
  assert.deepEqual(RECIPES.black.glossy, { color: "#0b0b0e", roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 });
});

test("colours: the glossy accent IS the token, the matte accent keeps 85% of it in sRGB, a hex recipe is itself", () => {
  const rgb = { r: 0, g: 0, b: 0 };
  colorFor(RECIPES.accent.glossy, "#3b82f6").getRGB(rgb, THREE.SRGBColorSpace);
  // within half a byte: three stores linear and the sRGB transfer round trip is ~1e-5 off
  const HALF_BYTE = 1 / 510;
  assert.ok(Math.abs(rgb.r - 0x3b / 255) < HALF_BYTE && Math.abs(rgb.g - 0x82 / 255) < HALF_BYTE && Math.abs(rgb.b - 0xf6 / 255) < HALF_BYTE);
  colorFor(RECIPES.accent.matte, "#3b82f6").getRGB(rgb, THREE.SRGBColorSpace);
  assert.ok(Math.abs(rgb.r - (0.85 * 0x3b) / 255) < HALF_BYTE && Math.abs(rgb.g - (0.85 * 0x82) / 255) < HALF_BYTE && Math.abs(rgb.b - (0.85 * 0xf6) / 255) < HALF_BYTE);
  assert.equal(colorFor(RECIPES.white.matte, "#000000").getHexString(), "d4d6db");
  assert.equal(DEFAULT_ACCENT, "#3b82f6");
});

test("makeMaterial: one program key for every recipe, `near` occlusion slots, the shader injection lands on three's includes", () => {
  const { material, uniforms } = makeMaterial(RECIPES.black.matte, 6);
  assert.equal(material.metalness, 0);
  assert.equal(material.roughness, 0.5);
  assert.equal(material.clearcoat, 0.3);
  assert.equal(material.specularIntensity, 1.0);
  assert.equal(makeMaterial(RECIPES.white.matte, 6).material.specularIntensity, 0.8, "0.8 unless the recipe says");
  assert.equal(uniforms.uNear.value.length, 6);
  assert.equal(uniforms.uNao.value, 1);
  assert.equal(material.customProgramCacheKey(), "jack");
  assert.equal(makeMaterial(RECIPES.accent.glossy, 11).material.customProgramCacheKey(), "jack");
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <common>\n#include <worldpos_vertex>", fragmentShader: "#include <common>\n#include <aomap_fragment>" };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  assert.ok(shader.vertexShader.includes("attribute float ao;") && shader.vertexShader.includes("vAo = ao;"));
  assert.ok(shader.fragmentShader.includes("#define NEAR_COUNT 6") && shader.fragmentShader.includes(AO_GLSL.trim().split("\n")[0].trim()));
  assert.ok(!shader.fragmentShader.includes("<aomap_fragment>"), "the AO include is replaced, not appended");
  assert.equal(shader.uniforms.uNear, uniforms.uNear, "the material's uniforms are the shader's");
  assert.ok(nearGlsl(3).includes("uniform vec4 uNear[NEAR_COUNT]"));
  material.dispose();
});

test("the environment scene and the geometry are singletons: one plane at the key's side over a grey floor, one lathe with the ao bake", () => {
  const s = environmentScene();
  assert.equal(environmentScene(), s);
  assert.equal(s.children.length, 1);
  const plane = s.children[0] as THREE.Mesh;
  assert.deepEqual([plane.position.x, plane.position.y, plane.position.z], [5, 6, 4]);
  assert.ok((s.background as THREE.Color).r === 0.15);
  const g = jackGeometry();
  assert.equal(jackGeometry(), g);
  assert.ok(g.getAttribute("ao"), "the per-vertex ao bake the shader reads");
});
