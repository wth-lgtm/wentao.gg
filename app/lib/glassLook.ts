// The jack field's glass. The owner on the served build: "now the object looks like solid
// plastic, is it possible to make them look like tinted glass?" — for the FIELD only; the
// card's opaque-panel jacks keep their plastic.
//
// Not three's `transmission`: the field's canvas is transparent over the DOM (the fluid, the
// rain, the text), and the transmission pass samples the scene's OWN render target, so glass
// would refract the clear colour — black voids — not the page. Alpha-blended glass instead:
// a tint at a base opacity, a Fresnel term that leaves the centre clear and the rim dense, a
// touch of rim light so edges catch the one key, the clearcoat reflecting the one-plane
// environment. FrontSide, ONE layer per pixel: each jack is drawn twice on the same program —
// a depth pre-pass with colour writes off, then the glass at depthFunc LessEqual — so only
// its nearest front surface is composited, and the jacks are interleaved back to front by a
// per-frame groupOrder so a nearer jack still blends over a farther one (JackFieldScene.tsx).
// The first glass round was DoubleSide with every surface composited: an arm stacked 2 layers,
// a tip 4, the junction 6–10 (≈ 0.99 alpha) — the "ball in the middle" the owner saw. The
// page — dye, rain, letters — shows THROUGH the jacks, which is the read the owner asked for.
//
// Three-free (constants and GLSL strings), so it can be imported by anything and tested in
// node; the material itself is built in JackFieldScene.tsx.

import type { Family, Finish } from "./connectorJacks";

export const GLASS = {
  /** the tints: smoke for the black family, the accent token for cobalt, frosted white for the white family */
  SMOKE: "#0b0b10",
  FROSTED_WHITE: "#e6e7ec",
  /**
   * Base opacities per family, ONE layer per JACK per pixel (the depth pre-pass;
   * JackFieldScene.tsx) — but a PACK (fieldPacks.ts) is three or four jacks deep at its core,
   * so where the jacks stack the pixel composites three or four of these layers, 1 − (1 − a)³
   * ≈ 0.80 / 0.76 / 0.63: the core keeps its presence at ANY base, and the base only decides
   * how clear the pack's edges and the lone jacks read — the thickness cue a jack on the
   * lattice never had (the owner: "still kind of solid", asking for more transparency). The
   * earlier tables, one sentence each: the DoubleSide round at 489d4af (0.55 / 0.50 / 0.38,
   * RIM 0.45) composited every surface, so an arm stacked two layers and the junction six to
   * ten — the approved glass read came from far walls showing through near ones, not from
   * density; its two-layer compensation (0.80 / 0.75 / 0.62, RIM 0.20) matched that density in
   * one layer and read as solid plastic; the lattice's middle table (0.66 / 0.60 / 0.48, RIM
   * 0.34) kept the page visible through every arm on a field where no two jacks overlapped, and
   * the owner still found it solid; the packs' first candidate (0.50 / 0.45 / 0.34, RIM 0.45)
   * was compared against this one on the Mac's GPU via `__field.setGlass({ black, accent,
   * white, rim, frosted })` behind ?jacksDebug and this one shipped (controller, 2026-09-17).
   * 0.45 was the floor the lattice round found for a lone smoke jack's legibility on the dark
   * theme; 0.42 in a pack is fine because the core stacks. The owner's knobs remain this table
   * (density) and RIM_OPACITY (edge).
   */
  OPACITY: { black: 0.42, accent: 0.38, white: 0.28 } as Record<Family, number>,
  /** the two finishes: the card's glossy is CLEAR glass, its matte is FROSTED — rougher, and a little denser */
  ROUGHNESS: { clear: 0.08, frosted: 0.28 } as Record<"clear" | "frosted", number>,
  /** the white family starts frosted (0.28) and its frosted finish goes further */
  FROSTED_WHITE_ROUGHNESS: { clear: 0.28, frosted: 0.48 } as Record<"clear" | "frosted", number>,
  /** the frosted finish's extra density over the family's base (0.10 with two layers; 0.08 since one) */
  FROSTED_OPACITY: 0.08,
  CLEARCOAT: 1,
  CLEARCOAT_ROUGHNESS: 0.06,
  IOR: 1.5,
  SPECULAR_INTENSITY: 1,
  ENV_MAP_INTENSITY: 1.4,
  /** Fresnel: opacity rises from the base at the centre to base + RIM at a grazing rim, with this power */
  FRESNEL_POWER: 2.5,
  /**
   * The edge's extra opacity — up to 0.50 as the base thins (the DoubleSide round ran 0.45; the
   * lattice's 0.34 topped smoke's rim out at 1.0 over a 0.66 base; the two-layer compensation's
   * 0.20 lost the edge). With this table smoke's rim reaches 0.92 (0.42 + 0.50), the accent's
   * 0.88, the white's 0.78, and frosted smoke's exactly 1.0: the silhouette stays drawn while
   * the faces clear, which is what makes a stack of glass read as glass.
   */
  RIM_OPACITY: 0.5,
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
 * normal and vViewPosition points from the surface to the camera: f = (1 − n·v)^POW is 0
 * facing the camera and 1 at the rim. diffuseColor.a is what <opaque_fragment> writes as the
 * pixel's alpha. Side-agnostic — no gl_FrontFacing; three flips the normal only under
 * DOUBLE_SIDED, and the field draws FrontSide (the depth pre-pass and the glass run the same
 * program, so this source compiles once: GLASS.PROGRAM_KEY).
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
