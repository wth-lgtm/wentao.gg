"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "./ThemeProvider";
import { fieldCount } from "../lib/fieldLayout";
import { createPointerRig } from "../lib/pointerRig";
import type { StoneTokens } from "../lib/stonePalette";

// The stone field — sixteen soft octahedra in Lusion's dynamics (jackDynamics.ts), a FIXED,
// page-wide layer. The owner's four notes on the hero's jacks: a different object, a palette
// that matches the page's matte tone, more to play with, and "if the user scrolls, should
// those objects stay in place as well?" — so the field lives in viewport space, rendered from
// page.tsx right after the fluid: above the fluid (both z-10, this one later in the DOM),
// below every section's z-20 content, and it does not scroll — the page scrolls under it and
// the mouse can play with the stones anywhere. This file is the gate and the plumbing; the
// three.js side is StoneFieldScene.tsx behind dynamic() so three never enters the page's
// chunk (page.tsx is a server component, where `ssr: false` is not allowed).
//
// GATE — the card's: a fine hover pointer, no reduced-motion preference, ≥ 640 px. Below it
// nothing mounts, not even the host div. Init is deferred like the fluid's (requestIdleCallback
// + 500 ms) so the server-rendered h1 stays the LCP element untouched.
//
// POINTER — the canvas must stay pointer-events-none: webgl-fluid binds mousemove on its own
// canvas, and every glass card and control keeps its hover. A window pointermove feeds the
// card's PointerRig shape in viewport fractions; the scene reads it per frame. No scroll
// listener anywhere: a fixed layer has nothing to do on scroll, and a scroll must not wake it.
//
// TOKENS — the palette is computed from --background/--card/--foreground/--accent, read a
// microtask after the theme flips (the card's reason: a child's passive effect runs before
// the ThemeProvider has flipped the <html> class), so both themes are first-class by
// construction and a flip recolours in place.

const StoneFieldScene = dynamic(() => import("./StoneFieldScene"), { ssr: false });

const readTokens = (): StoneTokens | null => {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim();
  const t = { background: get("--background"), card: get("--card"), foreground: get("--foreground"), accent: get("--accent") };
  return t.background && t.card && t.foreground && t.accent ? t : null;
};

export default function StoneField() {
  const [born, setBorn] = useState(false);
  const [count, setCount] = useState(16);
  const [awake, setAwake] = useState(true);
  const [tokens, setTokens] = useState<StoneTokens | null>(null);
  const { resolvedTheme } = useTheme();
  // Mutated in place, read by the scene's frame loop — no re-render per pointer move.
  const rig = useMemo(() => createPointerRig(), []);

  // The gate, then the deferred birth. The count (16 or 10) is decided once, as the card
  // decides its week count once: a count change would be a new world and a new entrance.
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
      setCount(fieldCount(window.innerWidth, window.innerHeight));
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

  // Tab hidden → the frameloop is "never": no render, no step. The layer is always on screen
  // otherwise, so this is the field's one visibility gate.
  useEffect(() => {
    if (!born) return;
    const onVis = () => setAwake(document.visibilityState !== "hidden");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [born]);

  // The pointer, in viewport fractions (−0.5..0.5). A pointer that leaves the window is away.
  useEffect(() => {
    if (!born) return;
    const onMove = (e: PointerEvent) => {
      const w = window.innerWidth, h = window.innerHeight;
      if (w === 0 || h === 0) return;
      rig.move(e.clientX / w - 0.5, e.clientY / h - 0.5, e.clientX, e.clientY);
    };
    const onLeave = () => { if (rig.over) rig.leave(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      rig.bind(null);
    };
  }, [born, rig]);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const t = readTokens();
      if (t) setTokens(t);
    });
    return () => { live = false; };
  }, [resolvedTheme]);

  if (!born || !tokens) return null;
  return (
    <div aria-hidden className="fixed inset-0 z-10 pointer-events-none">
      <StoneFieldScene count={count} tokens={tokens} visible={awake} rig={rig} />
    </div>
  );
}
