"use client";

import { useEffect } from "react";

// The reading chapters' one director (createDirector.ts), mounted once on the home page; renders nothing. Its module
// (the director, the engine, the commit, keep-your-place, the title corridor: ≈ 8 KB gz) loads on mount as its own
// chunk, not in the page's first bundle: CSS owns the first paint (the pinned layout, the flow reservation, the dials
// held unseen until placed, with their 1.5 s fallback), and the director's first act waits for document.fonts.ready
// anyway. So the reading chapters cost the initial JS budget (DESIGN §6, 272 KB) only this component.
export default function ChapterDirector() {
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    import("./createDirector").then((m) => { if (!gone) off = m.createDirector(); });
    return () => { gone = true; off?.(); };
  }, []);
  return null;
}
