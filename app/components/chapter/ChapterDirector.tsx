"use client";

import { useEffect } from "react";

// The reading chapters' one director (createDirector.ts), mounted once on the home page; renders nothing. Its module
// (the director, the engine, the commit, keep-your-place, the title corridor: ≈ 8 KB gz) is its own chunk, not in the
// page's first bundle: CSS owns the first paint (the pinned layout, the flow reservation, the dials held unseen until
// placed, with their 1.5 s fallback), and the director's first act waits for document.fonts.ready anyway. So the
// reading chapters cost the initial JS budget (DESIGN §6, 272 KB) only this component.
//
// THE FETCH STARTS WHEN THIS MODULE FIRST EVALUATES on the client (the page's hydration bundle), not in the mount
// effect after hydration: on a slow connection the chunk arrived after a reader had begun scrolling a /#education
// link, and its hash landing snapped them back to the section top (the landing's own input listeners register only
// with the director), and the dials' 1.5 s fallback showed Education's title at 96 px before the director moved it
// into the corridor. The reader's first input is watched from here too, and a reader who has already moved gets no
// landing. A chunk that fails to load leaves the page as CSS drew it (no unhandled rejection).
const INPUTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
let readerMoved = false;
const load = typeof window === "undefined" ? null : import("./createDirector").catch(() => null);
if (typeof window !== "undefined") {
  const moved = () => {
    readerMoved = true;
    for (const t of INPUTS) window.removeEventListener(t, moved);
  };
  for (const t of INPUTS) window.addEventListener(t, moved, { passive: true });
}

export default function ChapterDirector() {
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    load?.then((m) => { if (m && !gone) off = m.createDirector({ readerMoved: () => readerMoved }); });
    return () => { gone = true; off?.(); };
  }, []);
  return null;
}
