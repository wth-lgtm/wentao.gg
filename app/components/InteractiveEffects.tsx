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

    let fluidInstance: any = null;
    let timeoutId: ReturnType<typeof setTimeout>;

    const initFluid = async () => {
      try {
        const WebGLFluid = (await import("webgl-fluid")).default;
        if (canvasRef.current) {
          // Use lower resolution on mobile for better performance
          const simRes = isMobile ? 256 : 512;
          const dyeRes = isMobile ? 1024 : 2048;

          fluidInstance = WebGLFluid(canvasRef.current, {
            IMMEDIATE: false,
            TRIGGER: "hover",
            SIM_RESOLUTION: simRes,
            DYE_RESOLUTION: dyeRes,
            CAPTURE_RESOLUTION: 256,
            DENSITY_DISSIPATION: 6,
            VELOCITY_DISSIPATION: 1,
            PRESSURE: 0.5,
            PRESSURE_ITERATIONS: isMobile ? 20 : 40,
            CURL: 1,
            SPLAT_RADIUS: 0.05,
            SPLAT_FORCE: 10000,
            SHADING: !isMobile,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 12,
            PAUSED: false,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: true,
            BLOOM: false,
          });
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
