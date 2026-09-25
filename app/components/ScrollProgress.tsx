"use client";

import { motion, useScroll, useSpring } from "framer-motion";
import { useSiteMotion } from "./SiteMotion";

// The 2 px page-progress bar. Reduced motion is gated HERE, at the binding site: <MotionConfig
// reducedMotion="user"> does not reach a MotionValue bound to `style`, and framer's useReducedMotion() is
// mount-latched, so this reads the live policy (useSiteMotion) and binds the raw progress 1:1 — no spring —
// for a visitor who asked for less motion. The spring itself goes in PR 3 (two smoothers read as lag once
// the eased wheel exists).
export default function ScrollProgress() {
  const { reduced } = useSiteMotion();
  const { scrollYProgress } = useScroll();
  const spring = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-[2px] bg-accent origin-left z-[100]"
      style={{ scaleX: reduced ? scrollYProgress : spring }}
    />
  );
}
