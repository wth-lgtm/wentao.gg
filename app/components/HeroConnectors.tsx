"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "./ThemeProvider";
import { heroCount } from "../lib/heroLayout";
import { createPointerRig } from "../lib/pointerRig";

// The hero's floating connector jacks — the GitHub card's object (ConnectorField.tsx), loose
// around "I'm Wentao". This file is the gate and the plumbing; the three.js side is
// HeroConnectorsScene.tsx behind dynamic() so three never enters the hero's chunk, and Hero.tsx
// (a server component, where `ssr: false` is not allowed) mounts THIS as the section's first
// child. Mirrors what CommitHeatmap does for the card:
//
// GATE — the card's: a fine hover pointer, no reduced-motion preference, ≥ 640 px. Below it
// nothing mounts at all, not even the host div. Init is deferred like the fluid's
// (requestIdleCallback + 500 ms) so the server-rendered h1 stays the LCP element untouched.
//
// LAYERING — the host is `absolute inset-0 z-10` INSIDE the section, which is a z-20
// stacking context: above the fixed fluid (root-context z-10, the section wins at z-20) and
// below the section's own `relative z-20` content, so the h1, the role line and the visitor
// card always render over the jacks. Absolute, not fixed, so it scrolls away with the hero.
//
// POINTER — the scene's canvas must stay pointer-events-none: webgl-fluid binds mousemove on
// its own canvas and that canvas is pointer-events-auto on desktop, so a hit-testable layer
// above it would starve the dye. The pointer therefore comes from a window listener gated by
// the section's rect, written into the card's PointerRig shape; the scene reads it per frame.
// The ray, the click burst and the idle envelope are the scene's.

const HeroConnectorsScene = dynamic(() => import("./HeroConnectorsScene"), { ssr: false });

export default function HeroConnectors() {
  const [born, setBorn] = useState(false);
  const [count, setCount] = useState(7);
  const [visible, setVisible] = useState(false);
  const [inView, setInView] = useState(false);
  const [accentHex, setAccentHex] = useState("#3b82f6");
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  // Mutated in place, read by the scene's frame loop — no re-render per pointer move.
  const rig = useMemo(() => createPointerRig(), []);

  // The gate, then the deferred birth. The count (7 or 5) is decided once here, as the card
  // decides its week count once at mount: a count change would be a new world and a new
  // entrance, not a nudge, and a window resized across 1280 × 800 is not worth replaying it.
  useEffect(() => {
    if (
      window.innerWidth < 640 ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    const init = () => {
      if (cancelled) return;
      setCount(heroCount(window.innerWidth, window.innerHeight));
      setBorn(true);
    };
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => { timeoutId = setTimeout(init, 500); }, { timeout: 3000 });
    } else {
      timeoutId = setTimeout(init, 2000);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      clearTimeout(timeoutId);
    };
  }, []);

  // Two observers on the host (the section's box): ≥ 1% on screen keeps the frameloop on
  // "demand" (off it is "never": no render, no step); ≥ 30% is the entrance beat, so the
  // fly-in is seen and not played to an empty viewport. The ratio, not isIntersecting: the
  // callback also fires when the ratio drops below the threshold while a sliver still shows.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !born) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.01), { threshold: 0.01 });
    const beat = new IntersectionObserver(([e]) => setInView(e.isIntersecting && e.intersectionRatio >= 0.3), { threshold: 0.3 });
    io.observe(el);
    beat.observe(el);
    return () => { io.disconnect(); beat.disconnect(); };
  }, [born]);

  // The pointer: window pointermove, gated by the section's rect. The rect is re-read lazily
  // after a scroll or resize (NameCaustic's pattern) rather than on every move.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !born) return;
    let box: DOMRect | null = null;
    let stale = true;
    const invalidate = () => { stale = true; };
    const onMove = (e: PointerEvent) => {
      if (stale || !box) { box = el.getBoundingClientRect(); stale = false; }
      if (box.width === 0 || box.height === 0) return;
      const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      if (inside) rig.move((e.clientX - box.left) / box.width - 0.5, (e.clientY - box.top) / box.height - 0.5, e.clientX, e.clientY);
      else if (rig.over) rig.leave();
    };
    const onLeave = () => { if (rig.over) rig.leave(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
      rig.bind(null);
    };
  }, [born, rig]);

  // The themed accent, re-read a microtask after the flip — the card's reason: a child's
  // passive effect runs before the ThemeProvider has flipped the <html> class, and a
  // synchronous read returned the OUTGOING theme's token.
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const a = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      if (a) setAccentHex(a);
    });
    return () => { live = false; };
  }, [resolvedTheme]);

  if (!born) return null;
  return (
    <div ref={hostRef} aria-hidden className="absolute inset-0 z-10 pointer-events-none">
      <HeroConnectorsScene count={count} accent={accentHex} theme={resolvedTheme} visible={visible} inView={inView} rig={rig} />
    </div>
  );
}
