"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";

// A subtle "magnetic" anchor: on hover it eases toward the cursor and springs back on
// leave. Hover-only (no ambient motion) and disabled under prefers-reduced-motion.
export default function MagneticButton({
  href,
  className,
  children,
  strength = 0.35,
  max = 12,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  strength?: number;
  max?: number;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduce = useReducedMotion() ?? false;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const spring = { stiffness: 200, damping: 15, mass: 0.4 };
  const sx = useSpring(x, spring);
  const sy = useSpring(y, spring);

  if (reduce) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }

  const onMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    x.set(Math.max(-max, Math.min(max, dx * strength)));
    y.set(Math.max(-max, Math.min(max, dy * strength)));
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.a
      ref={ref}
      href={href}
      className={className}
      style={{ x: sx, y: sy }}
      onMouseMove={onMove}
      onMouseLeave={reset}
    >
      {children}
    </motion.a>
  );
}
