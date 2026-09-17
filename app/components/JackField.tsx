"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "./ThemeProvider";
import { fieldCount } from "../lib/fieldLayout";
import { createPointerRig } from "../lib/pointerRig";

// The jack field — sixteen of the GitHub card's six-way connector jacks in Lusion's dynamics
// (jackDynamics.ts), a FIXED, page-wide layer. The owner's notes across three rounds: the
// card's object and its black / white / cobalt ("the previous one that's exactly the same as
// lusion looks better"), more to play with, and "if the user scrolls, should those objects
// stay in place as well?" — so the field lives in viewport space, rendered from page.tsx right
// after the fluid: above the fluid (both z-10, this one later in the DOM), below every
// section's z-20 content, and it does not scroll — the page scrolls under it and the mouse
// can play with the jacks anywhere. This file is the gate and the plumbing; the three.js side
// is JackFieldScene.tsx behind dynamic() so three never enters the page's chunk (page.tsx is a
// server component, where `ssr: false` is not allowed).
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
// ACCENT — the themed --accent token, re-read a microtask after the theme flips (the card's
// reason: a child's passive effect runs before the ThemeProvider has flipped the <html> class,
// and a synchronous read returned the OUTGOING theme's token); the theme itself goes with it
// so the white family can take its light-mode values (fieldLayout.LIGHT_WHITE).

const JackFieldScene = dynamic(() => import("./JackFieldScene"), { ssr: false });

export default function JackField() {
  const [born, setBorn] = useState(false);
  const [count, setCount] = useState(16);
  const [awake, setAwake] = useState(true);
  const [accentHex, setAccentHex] = useState("#3b82f6");
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
      const a = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      if (a) setAccentHex(a);
    });
    return () => { live = false; };
  }, [resolvedTheme]);

  if (!born) return null;
  return (
    <div aria-hidden className="fixed inset-0 z-10 pointer-events-none">
      <JackFieldScene count={count} accent={accentHex} theme={resolvedTheme} visible={awake} rig={rig} />
    </div>
  );
}
