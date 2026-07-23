"use client";

import { useEffect, useRef } from "react";

// Original "digital rain" — low-res / CRT feel, in the site's accent blue, confined to
// the hero. Transparent overlay (glyphs fade via destination-out) so the fluid shows
// through; pixelated upscale + scanlines + phosphor glow give the old-screen look.
// Decorative + reduced-motion aware.

// Generic glyph set (half-width katakana + digits + a few latin/symbols) — no movie assets.
const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモ0123456789:.=*+<>";

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

    const SCALE = 0.5; // render at half-res → pixelated upscale = chunky, low-res glyphs
    const FONT = 14; // glyph size on the low-res backing
    let cols = 0;
    let drops: number[] = [];
    let raf = 0;

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.max(1, Math.floor(w * SCALE));
      canvas.height = Math.max(1, Math.floor(h * SCALE));
      cols = Math.max(1, Math.floor(canvas.width / FONT));
      drops = Array.from({ length: cols }, () => Math.floor((Math.random() * -canvas.height) / FONT));
      ctx.font = `${FONT}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const step = () => {
      const w = canvas.width;
      const h = canvas.height;
      // fade existing pixels toward transparent (keeps the overlay see-through)
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.085)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";

      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * FONT;
        const y = drops[i] * FONT;
        const head = Math.random() > 0.88;
        ctx.shadowColor = `rgb(${ar},${ag},${ab})`;
        ctx.shadowBlur = head ? 9 : 3;
        ctx.fillStyle = head
          ? "rgba(206,224,255,0.95)" // bright phosphor head
          : `rgba(${ar},${ag},${ab},0.8)`;
        ctx.fillText(ch, x, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        else drops[i] += 1;
      }
      raf = requestAnimationFrame(step);
    };

    if (reduce) {
      // static, sparse frame — no animation
      ctx.shadowBlur = 2;
      ctx.shadowColor = `rgb(${ar},${ag},${ab})`;
      for (let i = 0; i < cols; i++) {
        const n = 2 + ((Math.random() * 4) | 0);
        for (let k = 0; k < n; k++) {
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.12 + Math.random() * 0.25})`;
          ctx.fillText(
            GLYPHS[(Math.random() * GLYPHS.length) | 0],
            i * FONT,
            ((Math.random() * canvas.height) / FONT | 0) * FONT,
          );
        }
      }
    } else {
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
        // fade the rain out toward the hero's bottom so it hands off to the fluid
        maskImage: "linear-gradient(to bottom, black 55%, transparent 92%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 92%)",
      }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated", opacity: 0.7 }}
      />
      {/* CRT scanlines */}
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
