"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Minus, Crosshair } from "lucide-react";
import { WORLD_DOTS, WORLD_MAP, projectLonLat } from "./worldDots";

// A dot-matrix world map (Natural Earth land) that auto-zooms from the whole globe in to
// the visitor's approximate coordinates and drops an accent "radar" pin — then stays
// interactive: scroll / +− to zoom, drag to pan, ⌖ to recenter on the pin. The dots live
// in one <g> whose SVG transform attribute we scale+translate (viewBox units, so no
// transform-origin quirks); the pin is drawn on top at the projected point so it tracks
// the location and never scales up. prefers-reduced-motion → snap to the framed view.

const VBW = WORLD_MAP.w;
const VBH = WORLD_MAP.h;
const CX = VBW / 2;
const CY = VBH / 2;
const ZOOM = 4.2; // initial framing — the visitor's country + neighbours
const MIN_K = 1;
const MAX_K = 16;
const DOT_R = 0.34;

type View = { k: number; tx: number; ty: number };

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

// Keep at least a slice of the map on screen so it can never be dragged fully into the void.
function clampView({ k, tx, ty }: View): View {
  const ck = clampK(k);
  const m = 24;
  return {
    k: ck,
    tx: Math.min(VBW - m, Math.max(m - VBW * ck, tx)),
    ty: Math.min(VBH - m, Math.max(m - VBH * ck, ty)),
  };
}

export default function LocatorMap({
  lat,
  lon,
}: {
  lat: number | null;
  lon: number | null;
}) {
  const reduce = useReducedMotion() ?? false;
  const active = lat !== null && lon !== null;

  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const touchedRef = useRef(false); // user has taken control → stop auto-animating
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });

  // Static dot field — rendered once; stable refs so pan/zoom only updates the <g> transform.
  const dots = useMemo(
    () => WORLD_DOTS.map((d, i) => <circle key={i} cx={d.x * VBW} cy={d.y * VBH} r={DOT_R} />),
    []
  );

  // Where the visitor projects to, and the transform that frames them at ZOOM.
  const { px, py, framed } = useMemo(() => {
    if (!active) return { px: CX, py: CY, framed: { k: 1, tx: 0, ty: 0 } as View };
    const p = projectLonLat(lon as number, lat as number);
    const x = p.x * VBW;
    const y = p.y * VBH;
    return { px: x, py: y, framed: { k: ZOOM, tx: CX - ZOOM * x, ty: CY - ZOOM * y } };
  }, [active, lat, lon]);

  // Auto-zoom on mount (once). Interaction cancels it.
  useEffect(() => {
    touchedRef.current = false;
    if (!active) {
      setView({ k: 1, tx: 0, ty: 0 });
      return;
    }
    if (reduce) {
      setView(framed);
      return;
    }
    const from: View = { k: 1, tx: 0, ty: 0 };
    const dur = 1150;
    const delay = 150;
    let start = 0;
    const tick = (now: number) => {
      if (touchedRef.current) return;
      if (!start) start = now;
      const e = Math.min(1, Math.max(0, (now - start - delay) / dur));
      const s = 1 - Math.pow(1 - e, 3); // cubic-out
      setView({
        k: from.k + (framed.k - from.k) * s,
        tx: from.tx + (framed.tx - from.tx) * s,
        ty: from.ty + (framed.ty - from.ty) * s,
      });
      if (e < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [active, framed, reduce]);

  const takeControl = () => {
    touchedRef.current = true;
    cancelAnimationFrame(animRef.current);
  };

  // Convert a client point to viewBox coords (container aspect matches the viewBox, so linear).
  const toViewBox = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { vx: ((clientX - r.left) / r.width) * VBW, vy: ((clientY - r.top) / r.height) * VBH };
  };

  const zoomAround = useCallback((vx: number, vy: number, factor: number) => {
    setView((v) => {
      const worldX = (vx - v.tx) / v.k;
      const worldY = (vy - v.ty) / v.k;
      const k = clampK(v.k * factor);
      return clampView({ k, tx: vx - k * worldX, ty: vy - k * worldY });
    });
  }, []);

  // Wheel zoom — non-passive so we can keep the page from scrolling while zooming the map.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      takeControl();
      const { vx, vy } = toViewBox(e.clientX, e.clientY);
      zoomAround(vx, vy, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    takeControl();
    dragRef.current = { x: e.clientX, y: e.clientY };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const r = svgRef.current!.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.x) / r.width) * VBW;
    const dy = ((e.clientY - dragRef.current.y) / r.height) * VBH;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    svgRef.current?.releasePointerCapture(e.pointerId);
  };

  const recenter = () => {
    takeControl();
    setView(framed);
  };

  // Pin position in viewBox units under the current transform (drawn outside the scaled <g>).
  const pinX = view.k * px + view.tx;
  const pinY = view.k * py + view.ty;

  const btn =
    "grid h-6 w-6 place-items-center rounded-md border border-border/60 bg-background/60 text-muted backdrop-blur-sm transition-colors hover:text-foreground hover:border-foreground/30";

  return (
    <div className="relative h-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${VBH}`}
        className="block w-full h-full cursor-grab touch-pan-y active:cursor-grabbing"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <g
          fill="currentColor"
          className="text-foreground"
          opacity={0.22}
          transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}
        >
          {dots}
        </g>

        {active && (
          <>
            {!reduce && (
              <motion.circle
                cx={pinX}
                cy={pinY}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={0.35}
                initial={{ r: 1, opacity: 0 }}
                animate={{ r: [1, 8], opacity: [0.7, 0] }}
                transition={{ duration: 1.7, ease: "easeOut", delay: 1.25, repeat: 1, repeatDelay: 0.25 }}
              />
            )}
            <motion.g
              initial={reduce ? false : { opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { delay: 1.15, type: "spring", stiffness: 420, damping: 18 }}
            >
              <circle cx={pinX} cy={pinY} r={2.1} fill="var(--accent)" opacity={0.25} />
              <circle cx={pinX} cy={pinY} r={1.05} fill="var(--accent)" />
              <circle cx={pinX} cy={pinY} r={0.4} fill="var(--background)" />
            </motion.g>
          </>
        )}
      </svg>

      {/* Zoom / recenter controls */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button type="button" aria-label="Zoom in" className={btn} onClick={() => { takeControl(); zoomAround(CX, CY, 1.5); }}>
          <Plus size={13} />
        </button>
        <button type="button" aria-label="Zoom out" className={btn} onClick={() => { takeControl(); zoomAround(CX, CY, 1 / 1.5); }}>
          <Minus size={13} />
        </button>
        {active && (
          <button type="button" aria-label="Recenter on your location" className={btn} onClick={recenter}>
            <Crosshair size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
