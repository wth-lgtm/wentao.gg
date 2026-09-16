// Hand-written because webgl-fluid@0.3.9 ships NO .d.ts at all — `ls
// node_modules/webgl-fluid/dist` is four files, two .mjs/.umd.js bundles and their
// maps. So this file is the whole type story for the package, which is why the return
// type below matters: a `void` here forced the one call site to write
// `as unknown as FluidHandle` over a value it knows the shape of.
declare module "webgl-fluid" {
  interface FluidConfig {
    IMMEDIATE?: boolean;
    TRIGGER?: "hover" | "click";
    SIM_RESOLUTION?: number;
    DYE_RESOLUTION?: number;
    CAPTURE_RESOLUTION?: number;
    DENSITY_DISSIPATION?: number;
    VELOCITY_DISSIPATION?: number;
    PRESSURE?: number;
    PRESSURE_ITERATIONS?: number;
    CURL?: number;
    SPLAT_RADIUS?: number;
    SPLAT_FORCE?: number;
    SHADING?: boolean;
    COLORFUL?: boolean;
    COLOR_UPDATE_SPEED?: number;
    PAUSED?: boolean;
    BACK_COLOR?: { r: number; g: number; b: number };
    TRANSPARENT?: boolean;
    BLOOM?: boolean;
    BLOOM_ITERATIONS?: number;
    BLOOM_RESOLUTION?: number;
    BLOOM_INTENSITY?: number;
    BLOOM_THRESHOLD?: number;
    BLOOM_SOFT_KNEE?: number;
    SUNRAYS?: boolean;
    SUNRAYS_RESOLUTION?: number;
    SUNRAYS_WEIGHT?: number;
    /** How many dye blobs the IMMEDIATE ignition paints, and the batch size of the AUTO
     * splat timer. Supported at runtime since 0.3.x and simply missing here, which is why
     * the call site had a second, local FluidConfig widening it back in. */
    SPLAT_COUNT?: number;
  }

  /**
   * What patches/webgl-fluid+0.3.9.patch makes the module return. Upstream 0.3.9 returns
   * nothing: no teardown exists, so the rAF loop keeps stepping a detached canvas after a
   * client-side route change (measured at 57-104 frames/s in headless Chromium) and each
   * round trip leaks another loop and another WebGL context.
   *
   * The patch touches dist/webgl-fluid.mjs ONLY. dist/webgl-fluid.umd.js — which is this
   * package's `main`, its `unpkg`/`jsdelivr` entry, and the target of the `require`
   * export condition — is untouched and still returns undefined. This declaration is
   * therefore true of the ESM entry that `import("webgl-fluid")` resolves, and NOT of a
   * CommonJS require of the same package; anything that reaches the UMD build gets no
   * destroy() and no pause(), which is what the runtime guard at the call site catches.
   */
  interface FluidHandle {
    /** Clears the patch's `alive` flag (stopping the rAF loop and the auto-splat timer),
     * removes the three window listeners the library leaks, and calls
     * WEBGL_lose_context. NOT reversible — see the call site's note on re-initialisation. */
    destroy(): void;
    /** `true` STOPS the rAF loop — the patched loop returns when paused rather than
     * ticking on and skipping the step — and `false` restarts it (once; a second call
     * before the next frame is a no-op). The library's own `P` key goes through the
     * same function. The patch also clamps the DPR the canvas backing store and the
     * pointer coordinates are scaled by to 1.5, so a 3x phone does not pay for nine
     * dye texels per CSS pixel. */
    pause(paused: boolean): void;
  }

  function WebGLFluid(canvas: HTMLCanvasElement, config?: FluidConfig): FluidHandle;
  export default WebGLFluid;
  export type { FluidConfig, FluidHandle };
}
