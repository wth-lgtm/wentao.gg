// The jack field's glass. The owner on the served build: "now the object looks like solid
// plastic, is it possible to make them look like tinted glass?" — for the FIELD only; the
// card's opaque-panel jacks keep their plastic.
//
// Not three's `transmission`: the field's canvas is transparent over the DOM (the fluid, the
// rain, the text), and the transmission pass samples the scene's OWN render target, so glass
// would refract the clear colour — black voids — not the page. Alpha-blended glass instead:
// a tint at a base opacity, a Fresnel term that leaves the centre clear and the rim dense, a
// touch of rim light so edges catch the one key, the clearcoat reflecting the one-plane
// environment, and DoubleSide so the bores and the far walls read as thickness. The page —
// dye, rain, letters — shows THROUGH the jacks, which is the read the owner asked for.
//
// Three-free (constants and GLSL strings), so it can be imported by anything and tested in
// node; the material itself is built in JackFieldScene.tsx.

import type { Family, Finish } from "./connectorJacks";

export const GLASS = {
  /** the tints: smoke for the black family, the accent token for cobalt, frosted white for the white family */
  SMOKE: "#0b0b10",
  FROSTED_WHITE: "#e6e7ec",
  /** base opacities per family */
  OPACITY: { black: 0.55, accent: 0.5, white: 0.38 } as Record<Family, number>,
  /** the two finishes: the card's glossy is CLEAR glass, its matte is FROSTED — rougher, and a tenth denser */
  ROUGHNESS: { clear: 0.08, frosted: 0.28 } as Record<"clear" | "frosted", number>,
  /** the white family starts frosted (0.28) and its frosted finish goes further */
  FROSTED_WHITE_ROUGHNESS: { clear: 0.28, frosted: 0.48 } as Record<"clear" | "frosted", number>,
  FROSTED_OPACITY: 0.1,
  CLEARCOAT: 1,
  CLEARCOAT_ROUGHNESS: 0.06,
  IOR: 1.5,
  SPECULAR_INTENSITY: 1,
  ENV_MAP_INTENSITY: 1.4,
  /** Fresnel: opacity rises from the base at the centre to base + RIM at a grazing rim, with this power */
  FRESNEL_POWER: 2.5,
  RIM_OPACITY: 0.45,
  /** rim brightening added to the outgoing light, so edges catch the key like real glass */
  RIM_LIGHT: 0.08,
  /** one injected source for every family, so three compiles ONE program (uniforms carry the differences) */
  PROGRAM_KEY: "jack-glass",
} as const;

export type GlassFinish = "clear" | "frosted";
export const glassFinish = (finish: Finish): GlassFinish => (finish === "glossy" ? "clear" : "frosted");

export interface GlassRecipe {
  /** #rrggbb */
  color: string;
  opacity: number;
  roughness: number;
  finish: GlassFinish;
}

/**
 * The recipe for a slot. `accent` is the theme's --accent token; `lightWhite` is the light
 * theme's tint for the white family (fieldLayout.LIGHT_WHITE — frosted white glass on a
 * white page is a ghost, the light-mode greys keep it a body), null in the dark theme.
 */
export function glassRecipe(family: Family, finish: Finish, accent: string, lightWhite: string | null): GlassRecipe {
  const g = glassFinish(finish);
  const color = family === "accent" ? accent : family === "black" ? GLASS.SMOKE : lightWhite ?? GLASS.FROSTED_WHITE;
  const roughness = family === "white" ? GLASS.FROSTED_WHITE_ROUGHNESS[g] : GLASS.ROUGHNESS[g];
  const opacity = Math.min(1, GLASS.OPACITY[family] + (g === "frosted" ? GLASS.FROSTED_OPACITY : 0));
  return { color, opacity, roughness, finish: g };
}

/** the uniforms the injection reads; one set per material (the opacity differs by family and finish) */
export const GLASS_UNIFORMS = ["uGlassOpacity", "uGlassRim", "uGlassPow", "uGlassRimLight"] as const;

/**
 * The fragment injection. After three's <normal_fragment_begin> `normal` is the view-space
 * normal, already flipped for a back face, and vViewPosition points from the surface to the
 * camera: f = (1 − n·v)^POW is 0 facing the camera and 1 at the rim. diffuseColor.a is what
 * <opaque_fragment> writes as the pixel's alpha.
 */
export const GLASS_FRESNEL_GLSL = /* glsl */ `
  float glassF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), uGlassPow);
  diffuseColor.a = mix(uGlassOpacity, min(1.0, uGlassOpacity + uGlassRim), glassF);
`;
export const GLASS_RIM_GLSL = /* glsl */ `
  outgoingLight += glassF * uGlassRimLight;
`;
export const GLASS_UNIFORM_GLSL = /* glsl */ `
uniform float uGlassOpacity;
uniform float uGlassRim;
uniform float uGlassPow;
uniform float uGlassRimLight;
`;
