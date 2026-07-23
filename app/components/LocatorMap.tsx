"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { WORLD_DOTS, WORLD_MAP, projectLonLat } from "./worldDots";

// A dot-matrix world map (continents from Natural Earth land data) that zooms from the
// whole globe in to the visitor's approximate coordinates, dropping a pin with an accent
// "radar" ping. The dots live in a single <g> that we scale+pan; the pin is drawn on top
// at the viewBox centre (where the target lands after the zoom) so it never scales up.
// prefers-reduced-motion → snap straight to the zoomed frame, static pin, no ping.

const VBW = WORLD_MAP.w; // viewBox width in cells (each land dot is one cell)
const VBH = WORLD_MAP.h;
const CX = VBW / 2;
const CY = VBH / 2;
const ZOOM = 4.2; // final scale — shows the visitor's country + neighbours
const DOT_R = 0.34;

export default function LocatorMap({
  lat,
  lon,
}: {
  lat: number | null;
  lon: number | null;
}) {
  const reduce = useReducedMotion() ?? false;
  const active = lat !== null && lon !== null;

  // Static dot field — rendered once.
  const dots = useMemo(
    () =>
      WORLD_DOTS.map((d, i) => (
        <circle key={i} cx={d.x * VBW} cy={d.y * VBH} r={DOT_R} />
      )),
    []
  );

  // Where the visitor lands, and the transform that brings that point to centre at ZOOM.
  const { finalScale, finalX, finalY } = useMemo(() => {
    if (!active) return { finalScale: 1, finalX: 0, finalY: 0 };
    const p = projectLonLat(lon as number, lat as number);
    const px = p.x * VBW;
    const py = p.y * VBH;
    return { finalScale: ZOOM, finalX: CX - ZOOM * px, finalY: CY - ZOOM * py };
  }, [active, lat, lon]);

  const target = active
    ? { scale: finalScale, x: finalX, y: finalY }
    : { scale: 1, x: 0, y: 0 };

  return (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      className="block w-full h-auto"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <motion.g
        fill="currentColor"
        className="text-foreground"
        style={{ transformBox: "view-box", transformOrigin: "0px 0px", opacity: 0.22 }}
        initial={{ scale: 1, x: 0, y: 0 }}
        animate={target}
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 1.15, ease: [0.16, 1, 0.3, 1], delay: 0.15 }
        }
      >
        {dots}
      </motion.g>

      {active && (
        <g>
          {/* Radar ping — one accent ring that expands & fades, twice. */}
          {!reduce && (
            <motion.circle
              cx={CX}
              cy={CY}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={0.35}
              initial={{ r: 1, opacity: 0 }}
              animate={{ r: [1, 8], opacity: [0.7, 0] }}
              transition={{
                duration: 1.7,
                ease: "easeOut",
                delay: 1.25,
                repeat: 1,
                repeatDelay: 0.25,
              }}
            />
          )}

          {/* Pin — drops in after the zoom settles. */}
          <motion.g
            initial={reduce ? false : { opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduce
                ? { duration: 0 }
                : { delay: 1.15, type: "spring", stiffness: 420, damping: 18 }
            }
          >
            <circle cx={CX} cy={CY} r={2.1} fill="var(--accent)" opacity={0.25} />
            <circle cx={CX} cy={CY} r={1.05} fill="var(--accent)" />
            <circle cx={CX} cy={CY} r={0.4} fill="var(--background)" />
          </motion.g>
        </g>
      )}
    </svg>
  );
}
