"use client";

import { useEffect, useState, useRef } from "react";

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

    let fluidInstance: any = null;
    let timeoutId: ReturnType<typeof setTimeout>;

    const initFluid = async () => {
      try {
        const WebGLFluid = (await import("webgl-fluid")).default;
        if (canvasRef.current) {
          // Use lower resolution on mobile for better performance
          const simRes = 256;
          const dyeRes = isMobile ? 1024 : 2048;

          // webgl-fluid@0.3.9 supports these keys at runtime, but its bundled types
          // omit some — widen the config type rather than casting to `any`.
          type FluidConfig = NonNullable<Parameters<typeof WebGLFluid>[1]> & {
            SPLAT_COUNT?: number;
            BLOOM_INTENSITY?: number;
            SUNRAYS?: boolean;
            SUNRAYS_WEIGHT?: number;
          };
          const config: FluidConfig = {
            // A small ignition bloom on load so the canvas isn't dead-black, then the
            // fluid is driven purely by the real cursor (TRIGGER: "hover") — no synthetic
            // ambient strokes.
            IMMEDIATE: true,
            SPLAT_COUNT: 4,
            TRIGGER: "hover",
            SIM_RESOLUTION: simRes,
            DYE_RESOLUTION: dyeRes,
            CAPTURE_RESOLUTION: 256,
            // Fuller + more painterly: dye lingers (low dissipation), the field keeps
            // swirling (low velocity dissipation + high curl), strokes are bolder, and
            // bloom + sunrays add a luminous glow (desktop only for perf).
            DENSITY_DISSIPATION: 1.5,
            VELOCITY_DISSIPATION: 0.5,
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: isMobile ? 20 : 24,
            CURL: 15,
            SPLAT_RADIUS: 0.18,
            SPLAT_FORCE: 7500,
            SHADING: !isMobile,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 5,
            PAUSED: false,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: true,
            BLOOM: !isMobile,
            BLOOM_INTENSITY: 0.3,
            SUNRAYS: !isMobile,
            SUNRAYS_WEIGHT: 0.5,
          };
          fluidInstance = WebGLFluid(canvasRef.current, config);
        }
      } catch (error) {
        console.error("Failed to initialize WebGL Fluid:", error);
      }
    };

    // Defer fluid initialization until browser is idle, well after LCP
    if ("requestIdleCallback" in window) {
      const idleId = (window as any).requestIdleCallback(
        () => { timeoutId = setTimeout(initFluid, 500); },
        { timeout: 3000 }
      );
      return () => {
        (window as any).cancelIdleCallback(idleId);
        clearTimeout(timeoutId);
        fluidInstance = null;
      };
    }
    timeoutId = setTimeout(initFluid, 2000);

    return () => {
      clearTimeout(timeoutId);
      fluidInstance = null;
    };
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
      className={`fixed inset-0 z-10 ${isMobile ? "pointer-events-none" : ""}`}
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}
