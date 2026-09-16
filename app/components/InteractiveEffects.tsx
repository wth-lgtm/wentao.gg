"use client";

import { useEffect, useState, useRef } from "react";

// The patch that gives this module a teardown, and the one thing to know about it:
// patches/webgl-fluid+0.3.9.patch modifies dist/webgl-fluid.mjs and nothing else, so the
// UMD build this package also ships (its `main`, and what the `require` export condition
// resolves to) is unpatched and still returns undefined. The dynamic `import()` below gets
// the ESM entry, which is the patched one — and the guard after the call is what says so
// out loud if that ever stops being true.
//
// Upstream 0.3.9 returns nothing and has no teardown, so the rAF loop kept stepping a
// detached 0x0 canvas at 57-104 frames/s after a client-side route change off the home
// page (measured in headless Chromium; a direct load of the same route idles at 0/s), and
// each home -> project -> home round trip leaked another loop and another WebGL context.
//
// The handle's type lives in types/webgl-fluid.d.ts now, declared as the module's actual
// return, which is what removed the `as unknown as FluidHandle` this file used to need.
import type { FluidHandle } from "webgl-fluid";

export default function InteractiveEffects() {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Detect mobile on mount
  useEffect(() => {
    setMounted(true);
    const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const hasMouse = window.matchMedia("(pointer: fine)").matches;
    setIsMobile(hasTouch && !hasMouse);
  }, []);

  // WebGL Fluid Simulation - defer initialization for faster initial paint
  useEffect(() => {
    if (!mounted || !canvasRef.current) return;

    // Respect prefers-reduced-motion: skip the fluid sim entirely (no WebGL context, no rAF).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let fluidInstance: FluidHandle | null = null;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const initFluid = async () => {
      try {
        const WebGLFluid = (await import("webgl-fluid")).default;
        // The import is async, so the effect can have been torn down while it was in flight.
        if (cancelled || !canvasRef.current) return;
        const simRes = 256;
        // DYE_RESOLUTION is applied to the SHORT edge (getResolution scales the long edge by
        // the aspect ratio), so 2048 meant a 3277x2048 RGBA16F dye field at 16:10 — ~107 MB
        // double-buffered — advected and composited every frame. 1024 (the library default)
        // is still >=1 dye texel per CSS pixel on any viewport up to 1024 px on its short
        // edge, so SPLAT_RADIUS 0.065 stays resolved, and the field is 4x smaller. No mobile
        // branch: webgl-fluid already forces 512 for any /Mobi|Android/ UA, so the old
        // `isMobile ? 1024 : 2048` only ever moved iPad-class devices with a desktop UA.
        const dyeRes = 1024;

        // No local widening any more. webgl-fluid ships no types at all, so
        // types/webgl-fluid.d.ts IS the declaration — and the four keys this used to add
        // back were three that were already there and SPLAT_COUNT, which now is. A
        // widening beside the call site only hides the gap from the next caller. (The
        // comment here used to say the "bundled types omit some", which contradicted the
        // note above it: there are no bundled types.)
        const config: NonNullable<Parameters<typeof WebGLFluid>[1]> = {
          // A small ignition bloom on load so the canvas isn't dead-black, then the
          // fluid is driven purely by the real cursor (TRIGGER: "hover") — no synthetic
          // ambient strokes.
          IMMEDIATE: true,
          SPLAT_COUNT: 2,
          TRIGGER: "hover",
          SIM_RESOLUTION: simRes,
          DYE_RESOLUTION: dyeRes,
          CAPTURE_RESOLUTION: 256,
          // Fuller + more painterly: dye lingers (low dissipation), the field keeps
          // swirling (low velocity dissipation + high curl), strokes are bolder, and
          // bloom + sunrays add a luminous glow (desktop only for perf).
          DENSITY_DISSIPATION: 2.2,
          VELOCITY_DISSIPATION: 0.5,
          PRESSURE: 0.8,
          PRESSURE_ITERATIONS: isMobile ? 20 : 24,
          CURL: 15,
          SPLAT_RADIUS: 0.065,
          SPLAT_FORCE: 7500,
          SHADING: !isMobile,
          COLORFUL: true,
          COLOR_UPDATE_SPEED: 5,
          PAUSED: false,
          BACK_COLOR: { r: 0, g: 0, b: 0 },
          TRANSPARENT: true,
          BLOOM: !isMobile,
          BLOOM_INTENSITY: 0.15,
          SUNRAYS: !isMobile,
          SUNRAYS_WEIGHT: 0.3,
        };
        fluidInstance = WebGLFluid(canvasRef.current, config);
        // Patch-drift guard. The teardown below is the only thing stopping a leaked rAF
        // loop per route change, and it exists purely because patch-package applied a
        // patch at install time — a failed `postinstall`, a bumped version whose patch no
        // longer applies, or a bundler that resolved the unpatched UMD entry all leave a
        // handle with no destroy() and no error anywhere. Dev-only: in production this
        // cannot be acted on, and the optional call below already degrades quietly.
        if (
          process.env.NODE_ENV !== "production" &&
          typeof fluidInstance?.destroy !== "function"
        ) {
          console.error(
            "webgl-fluid returned no destroy(): patches/webgl-fluid+0.3.9.patch is not " +
              "applied to the resolved build. The fluid rAF loop will keep running after " +
              "a route change off this page."
          );
        }
      } catch (error) {
        console.error("Failed to initialize WebGL Fluid:", error);
      }
    };

    // Defer fluid initialization until browser is idle, well after LCP
    let idleId: number | undefined;
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(
        () => { timeoutId = setTimeout(initFluid, 500); },
        { timeout: 3000 }
      );
    } else {
      timeoutId = setTimeout(initFluid, 2000);
    }

    // One cleanup for both scheduling paths: cancel whatever is still pending, then stop the
    // simulation. destroy() clears the `alive` flag the patch guards the rAF loop and the
    // auto-splat timer with, removes the three window listeners the library leaks, and calls
    // WEBGL_lose_context so the GPU buffers go with it.
    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      clearTimeout(timeoutId);
      fluidInstance?.destroy();
      fluidInstance = null;
    };
    // Both deps settle on the first commit and never change again: `mounted` goes
    // false -> true once, and `isMobile` is written in the same effect that sets it. That
    // is load-bearing rather than incidental, because a RE-RUN of this effect could not
    // work: the cleanup calls destroy(), which calls WEBGL_lose_context.loseContext(), and
    // the patch never calls restoreContext — a lost context is permanent, and
    // canvas.getContext() hands back the same lost object, so a second WebGLFluid() on
    // this canvas would initialise against a dead context. Anything that makes either dep
    // genuinely change has to remount the <canvas> (give it a `key`) rather than rely on
    // re-initialising in place.
  }, [mounted, isMobile]);

  // Forward touch events to canvas on mobile (allows scroll + fluid effect)
  useEffect(() => {
    if (!mounted || !isMobile || !canvasRef.current) return;

    const canvas = canvasRef.current;

    const forwardTouchEvent = (e: TouchEvent, type: string) => {
      const touch = e.touches[0] || e.changedTouches[0];
      if (!touch) return;

      // Create and dispatch mouse event to canvas
      const mouseEvent = new MouseEvent(type, {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true,
        view: window,
      });
      canvas.dispatchEvent(mouseEvent);
    };

    const handleTouchStart = (e: TouchEvent) => forwardTouchEvent(e, "mousedown");
    const handleTouchMove = (e: TouchEvent) => forwardTouchEvent(e, "mousemove");
    const handleTouchEnd = (e: TouchEvent) => forwardTouchEvent(e, "mouseup");

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [mounted, isMobile]);

  if (!mounted) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`fixed inset-0 z-10 ${isMobile ? "pointer-events-none" : ""}`}
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}
