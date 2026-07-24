"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";

// Original "digital rain", spanning the full page and tuned to the site (accent blue,
// crisp — not retro/pixelated). Each column is a CONTINUOUS trail: a bright leading
// glyph with a solid, gradually-dimming tail of characters that mutate in place —
// the film's look, redrawn on the site's palette. Sits at the very back (z-0) as a
// fixed layer so the fluid (z-10) and the liquid-glass cards (z-20) both read over it.
// Kept ambient (low opacity), throttled to ~30fps, and paused when the tab is hidden.
// Reduced-motion aware.

// Half-width katakana (narrow, movie-authentic) + digits + a few latin/symbols.
const KATAKANA = Array.from({ length: 0xff9d - 0xff66 + 1 }, (_, i) => String.fromCharCode(0xff66 + i)).join("");
const GLYPHS = KATAKANA + "0123456789ABCDEFGHKLMNPRSTUVZ:.=*+<>";
const randGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

function parseColor(v: string): [number, number, number] {
  const s = v.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const int = parseInt(n, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }
  const m = s.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [59, 130, 246];
}

export default function MatrixRain() {
  const { resolvedTheme } = useTheme();
  const light = resolvedTheme === "light";
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cs = getComputedStyle(document.documentElement);
    const [ar, ag, ab] = parseColor(cs.getPropertyValue("--accent") || "#3b82f6");
    // On dark, the head is the brightest glyph (near-white); on white that vanishes, so
    // the head becomes the DARKEST/most-saturated blue and the trail fades from there.
    const headFill = light ? "rgba(23,58,138,0.98)" : "rgba(216,232,255,0.95)";
    const headShadow = light ? 0 : 2; // glow muddies on white
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // capped: full-page fill cost scales with device pixels

    const FONT = 18; // CSS px — crisp, a touch larger
    const F = FONT * dpr; // backing px
    const MIN_SPEED = 3.5; // rows/sec — gentle drift
    const MAX_SPEED = 9;
    const FRAME_MS = 1000 / 30; // throttle to ~30fps — reads identically, halves the work

    let cols = 0;
    let rows = 0;
    let y: Float32Array = new Float32Array(0); // head row (float) per column
    let speed: Float32Array = new Float32Array(0);
    let trail: Int16Array = new Int16Array(0); // per-column trail length
    let glyphs: string[][] = []; // [col][row] — stable, mutated occasionally
    let lastDraw = 0;
    let raf = 0;

    const fresh = (i: number, startAbove: boolean) => {
      y[i] = startAbove ? -Math.floor(Math.random() * rows) : -Math.floor(Math.random() * 14) - 2;
      speed[i] = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
      trail[i] = 14 + ((Math.random() * 18) | 0);
      const g: string[] = new Array(rows + 2);
      for (let r = 0; r < g.length; r++) g[r] = randGlyph();
      glyphs[i] = g;
    };

    // Static, sparse frame for reduced motion — no animation, drawn once per sizing.
    const drawStill = () => {
      for (let i = 0; i < cols; i++) {
        const hRow = (Math.random() * rows) | 0;
        const L = trail[i];
        for (let d = L; d >= 0; d--) {
          const r = hRow - d;
          if (r < 0 || r >= rows) continue;
          ctx.shadowBlur = 0;
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${Math.pow(1 - d / L, 1.4) * 0.5})`;
          ctx.fillText(glyphs[i][r], i * F, r * F);
        }
      }
    };

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      cols = Math.max(1, Math.floor(canvas.width / F));
      rows = Math.ceil(canvas.height / F) + 2;
      y = new Float32Array(cols);
      speed = new Float32Array(cols);
      trail = new Int16Array(cols);
      glyphs = new Array(cols);
      for (let i = 0; i < cols; i++) fresh(i, true);
      ctx.font = `${F}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      // Setting canvas.width above CLEARS the bitmap, and ResizeObserver fires a
      // mandatory initial callback — so the still frame must be re-drawn here, or
      // reduced-motion visitors get an empty canvas (no rain at all).
      if (reduce) drawStill();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const renderColumn = (i: number) => {
      const hRow = Math.floor(y[i]);
      const L = trail[i];
      const col = glyphs[i];
      for (let d = L; d >= 0; d--) {
        const r = hRow - d;
        if (r < 0 || r >= rows) continue;
        const ch = col[r];
        if (d === 0) {
          ctx.shadowColor = `rgb(${ar},${ag},${ab})`;
          ctx.shadowBlur = headShadow; // tiny glow only (dark); off on light — a full per-glyph gaussian is the top 2D cost
          ctx.fillStyle = headFill; // leading glyph — bright on dark, saturated-dark on light
        } else {
          ctx.shadowBlur = 0;
          const a = Math.pow(1 - d / L, 1.35) * 0.85; // solid trail fading to the tail
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${a})`;
        }
        ctx.fillText(ch, i * F, r * F);
      }
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const elapsed = now - lastDraw;
      if (elapsed < FRAME_MS) return; // ~30fps gate
      const dt = Math.min(elapsed / 1000 || 0.016, 1 / 20);
      lastDraw = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // occasional in-place glyph mutation (flicker), distributed across columns
      const muts = Math.max(1, (cols * 0.4) | 0);
      for (let k = 0; k < muts; k++) {
        const i = (Math.random() * cols) | 0;
        const g = glyphs[i];
        if (g) g[(Math.random() * g.length) | 0] = randGlyph();
      }

      for (let i = 0; i < cols; i++) {
        renderColumn(i);
        y[i] += speed[i] * dt;
        if (Math.floor(y[i]) - trail[i] > rows) fresh(i, false); // fully off the bottom → recycle
      }
    };

    if (!reduce) {
      lastDraw = performance.now();
      raf = requestAnimationFrame(step);
    }

    // Pause the loop while the tab is hidden — a full-page fixed rain would otherwise
    // keep animating (and forcing every glass card's backdrop to re-blur) unseen.
    const onVisibility = () => {
      if (reduce) return;
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        lastDraw = performance.now();
        raf = requestAnimationFrame(step);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [light]);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
    >
      {/* light needs a touch more presence to read on white; dark stays ambient */}
      <canvas ref={canvasRef} className="block h-full w-full" style={{ opacity: light ? 0.4 : 0.28 }} />
    </div>
  );
}
