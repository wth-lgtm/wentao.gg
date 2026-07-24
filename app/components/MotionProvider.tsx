"use client";

import { MotionConfig } from "framer-motion";

// The CSS `prefers-reduced-motion` block in globals.css cannot reach framer-motion —
// it only zeroes CSS animations/transitions. Without this provider, every framer
// animation (the scroll-scrubbed card entrances in Experience/Education, the commit
// board's springs, the Connect tiles) runs at full amplitude for visitors who have
// asked their OS for less motion. `reducedMotion="user"` makes framer honour the
// media query globally: transform/layout animations are skipped, opacity still fades.
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
