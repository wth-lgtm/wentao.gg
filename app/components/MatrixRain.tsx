"use client";

import { useEffect, useRef } from "react";

// Original "digital rain" — low-res / CRT feel, in the site's accent blue, confined to
// the hero. Transparent overlay (trails fade via destination-out) so the fluid shows
// through; pixelated upscale + scanlines + phosphor glow give the old-screen look.
// Per-column variable speed + in-place glyph mutation for organic variation.
// Decorative + reduced-motion aware.

// Half-width katakana (the narrow, movie-authentic glyphs) + digits + a few latin/symbols.
const KATAKANA = Array.from({ length: 0xff9d - 0xff66 + 1 }, (_, i) => String.fromCharCode(0xff66 + i)).join("");
const GLYPHS = KATAKANA + "0123456789" + "ABCDEFGHKLMNПRSTZ" + ":.=*+<>|-";
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
    const HEAD = "rgba(206,224,255,0.95)"; // bright phosphor head
    const TRAIL = `rgba(${ar},${ag},${ab},0.78)`;

    const SCALE = 0.5; // half-res backing → pixelated upscale = chunky, low-res glyphs
    const FONT = 14; // glyph size on the backing
    const MIN_SPEED = 2.5; // rows/sec — slow
    const MAX_SPEED = 9; // rows/sec — a bit quicker; per-column randomised for variation

    let cols = 0;
    let rows = 0;
    let y: Float32Array = new Float32Array(0); // head row (float) per column
    let speed: Float32Array = new Float32Array(0); // rows/sec per column
    let head: string[] = []; // current head glyph per column (stable until it steps a cell)
    let last = 0;
    let raf = 0;

    const draw = (col: number, row: number, ch: string, color: string, glow: number) => {
      ctx.shadowColor = `rgb(${ar},${ag},${ab})`;
      ctx.shadowBlur = glow;
      ctx.fillStyle = color;
      ctx.fillText(ch, col * FONT, row * FONT);
    };

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.max(1, Math.floor(w * SCALE));
      canvas.height = Math.max(1, Math.floor(h * SCALE));
      cols = Math.max(1, Math.floor(canvas.width / FONT));
      rows = Math.ceil(canvas.height / FONT);
      y = new Float32Array(cols);
      speed = new Float32Array(cols);
      head = new Array(cols);
      for (let i = 0; i < cols; i++) {
        y[i] = -Math.random() * rows; // staggered starts
        speed[i] = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
        head[i] = randGlyph();
      }
      ctx.font = `${FONT}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0.016, 1 / 20);
      last = now;

      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.05)"; // gentle fade → longer, softer trails
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";

      for (let i = 0; i < cols; i++) {
        const prev = Math.floor(y[i]);
        y[i] += speed[i] * dt;
        const row = Math.floor(y[i]);
        if (row !== prev) head[i] = randGlyph(); // new glyph as the head steps down
        if (row >= 0) draw(i, row, head[i], HEAD, 8); // bright head, drawn each frame

        // reset past the bottom with a fresh speed + start
        if (row > rows + 3 && Math.random() > 0.985) {
          y[i] = -Math.random() * 12;
          speed[i] = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
        }

        // in-trail mutation: occasionally re-light a glyph behind the head (flicker)
        if (Math.random() < 0.04) {
          const fr = row - 1 - ((Math.random() * 16) | 0);
          if (fr >= 0) draw(i, fr, randGlyph(), TRAIL, 3);
        }
      }
      raf = requestAnimationFrame(step);
    };

    if (reduce) {
      // sparse static frame — no animation
      ctx.shadowColor = `rgb(${ar},${ag},${ab})`;
      ctx.shadowBlur = 2;
      for (let i = 0; i < cols; i++) {
        const n = 2 + ((Math.random() * 4) | 0);
        for (let k = 0; k < n; k++) {
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.12 + Math.random() * 0.25})`;
          ctx.fillText(randGlyph(), i * FONT, ((Math.random() * rows) | 0) * FONT);
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
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated", opacity: 0.7 }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, rgba(0,0,0,0.22), rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)",
          opacity: 0.5,
        }}
      />
    </div>
  );
}
