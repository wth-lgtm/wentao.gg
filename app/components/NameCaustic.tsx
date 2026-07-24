"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, useMotionValueEvent, useSpring } from "framer-motion";
import { HERO_NAME, HERO_NAME_METRICS } from "./heroName";

// The name is a lens.
//
// The same pointer that paints the WebGL fluid behind the page also bends a thin
// filament of light through the letterforms of the wordmark. The filament trails the
// cursor on a spring — that LAG is the whole effect. A highlight welded to the cursor
// reads as a torch (and as every "spotlight" component on the internet); one that
// arrives a moment late reads as light travelling through moving water.
//
// It is purely additive. This layer paints only where the light falls; everywhere
// else it is transparent and the base --foreground wordmark shows through untouched,
// so nothing about legibility depends on it.
//
// Cost: no canvas, no filter, no new requestAnimationFrame loop, no React state and
// therefore no re-renders. Two custom properties are written straight to the node
// from framer's existing ticker, and opacity is toggled inline — both compositor
// work. All of it stops dead when the hero scrolls away.

const IDLE_MS = 2000; // stillness before the light starts to go out
const ATTACK_MS = 120; // relight quickly, so the first movement is answered at once
const DECAY_MS = 600; // ...but fade slowly, so it ebbs rather than switches off

export default function NameCaustic() {
  const ref = useRef<HTMLSpanElement>(null);

  // Filament position, as a percentage of the heading box.
  const lx = useMotionValue(30);
  const ly = useMotionValue(38);
  const sx = useSpring(lx, { stiffness: 90, damping: 22, restDelta: 0.05 });
  const sy = useSpring(ly, { stiffness: 90, damping: 22, restDelta: 0.05 });

  // Write the sprung values to the node directly. No state, no render.
  useMotionValueEvent(sx, "change", (v) => {
    ref.current?.style.setProperty("--lx", `${v}%`);
  });
  useMotionValueEvent(sy, "change", (v) => {
    ref.current?.style.setProperty("--ly", `${v}%`);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No fine pointer, or the visitor asked for less motion → leave the CSS-parked
    // composition alone (a frozen caustic, lit from a fixed offset) and attach
    // nothing at all: no listeners, no springs running, no observers.
    if (
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    // Interactive path starts dark and is lit by movement.
    el.style.opacity = "0";

    let box: DOMRect | null = null;
    let boxStale = true;
    let onScreen = true;
    let idle: ReturnType<typeof setTimeout> | undefined;

    // Re-measuring on every pointermove would force layout ~60×/sec. Measure once
    // per scroll/resize burst instead, lazily on the next move.
    const invalidate = () => {
      boxStale = true;
    };

    const fade = () => {
      el.style.transitionDuration = `${DECAY_MS}ms`;
      el.style.opacity = "0";
    };

    const onMove = (e: PointerEvent) => {
      if (!onScreen) return;
      if (boxStale || !box) {
        box = el.getBoundingClientRect();
        boxStale = false;
      }
      if (box.width === 0 || box.height === 0) return;

      lx.set(((e.clientX - box.left) / box.width) * 100);
      ly.set(((e.clientY - box.top) / box.height) * 100);

      el.style.transitionDuration = `${ATTACK_MS}ms`;
      el.style.opacity = "1";

      clearTimeout(idle);
      idle = setTimeout(fade, IDLE_MS);
    };

    // Hard stop once the hero is off screen — no rect reads, no spring writes.
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) {
        clearTimeout(idle);
        fade();
      }
    });
    io.observe(el);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });
    window.addEventListener("scroll", invalidate, { passive: true });

    return () => {
      clearTimeout(idle);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate);
    };
  }, [lx, ly]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={`${HERO_NAME_METRICS} text-caustic absolute inset-0 select-none`}
    >
      {HERO_NAME}
    </span>
  );
}
