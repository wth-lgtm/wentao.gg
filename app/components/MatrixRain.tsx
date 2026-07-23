"use client";

import { useEffect, useRef } from "react";

// Original "digital rain", confined to the hero and tuned to the site (accent blue,
// crisp — not retro/pixelated). Each column is a CONTINUOUS trail: a bright leading
// glyph with a solid, gradually-dimming tail of characters that mutate in place —
// the film's look, redrawn on the site's palette. Transparent overlay so the fluid
// shows through; masked to fade out toward the hero's bottom. Reduced-motion aware.

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const FONT = 16; // CSS px — crisp
    const F = FONT * dpr; // backing px
    const MIN_SPEED = 5; // rows/sec
    const MAX_SPEED = 13;

    let cols = 0;
    let rows = 0;
    let y: Float32Array = new Float32Array(0); // head row (float) per column
    let speed: Float32Array = new Float32Array(0);
    let trail: Int16Array = new Int16Array(0); // per-column trail length
    let glyphs: string[][] = []; // [col][row] — stable, mutated occasionally
    let last = 0;
    let raf = 0;

    const fresh = (i: number, startAbove: boolean) => {
      y[i] = startAbove ? -Math.floor(Math.random() * rows) : -Math.floor(Math.random() * 14) - 2;
      speed[i] = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
      trail[i] = 14 + ((Math.random() * 18) | 0);
      const g: string[] = new Array(rows + 2);
      for (let r = 0; r < g.length; r++) g[r] = randGlyph();
      glyphs[i] = g;
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
          ctx.shadowBlur = 7;
          ctx.fillStyle = "rgba(216,232,255,0.95)"; // bright leading glyph
        } else {
          ctx.shadowBlur = 0;
          const a = Math.pow(1 - d / L, 1.35) * 0.85; // solid trail fading to the tail
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${a})`;
        }
        ctx.fillText(ch, i * F, r * F);
      }
    };

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0.016, 1 / 20);
      last = now;
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
      raf = requestAnimationFrame(step);
    };

    if (reduce) {
      // static, sparse frame — no animation
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
    } else {
      last = performance.now();
      raf = requestAnimationFrame(step);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className="absolute inset-0 z-[11] overflow-hidden pointer-events-none"
      style={{
        maskImage: "linear-gradient(to bottom, black 55%, transparent 92%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 92%)",
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" style={{ opacity: 0.6 }} />
    </div>
  );
}
