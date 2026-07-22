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

          // webgl-fluid@0.3.9 supports AUTO / INTERVAL / SPLAT_COUNT at runtime, but its
          // bundled types omit them — widen the config type rather than casting to `any`.
          type FluidConfig = NonNullable<Parameters<typeof WebGLFluid>[1]> & {
            AUTO?: boolean;
            INTERVAL?: number;
            SPLAT_COUNT?: number;
          };
          const config: FluidConfig = {
            // Alive on arrival: an initial ignition bloom, plus a gentle idle drift on
            // desktop so the canvas isn't dead until the cursor moves. Hover stays the star.
            IMMEDIATE: true,
            AUTO: !isMobile,
            INTERVAL: 5000,
            SPLAT_COUNT: 4,
            TRIGGER: "hover",
            SIM_RESOLUTION: simRes,
            DYE_RESOLUTION: dyeRes,
            CAPTURE_RESOLUTION: 256,
            DENSITY_DISSIPATION: 4,
            VELOCITY_DISSIPATION: 1,
            PRESSURE: 0.5,
            PRESSURE_ITERATIONS: isMobile ? 20 : 24,
            CURL: 3,
            SPLAT_RADIUS: 0.05,
            SPLAT_FORCE: 6500,
            SHADING: !isMobile,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 3,
            PAUSED: false,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: true,
            BLOOM: false,
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
