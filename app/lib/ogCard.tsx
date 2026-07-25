import { ImageResponse } from "next/og";

// The shared social-card renderer. Extracted so every route can have its OWN card without
// three near-copies of the same drawing code drifting apart.
//
// Why per-route cards at all: a route that declares its own `openGraph` in metadata
// REPLACES the parent's, including the root's file-convention image — so /projects/poweropps
// and /projects/progdash were shipping with no og:image and twitter:card="summary". Giving
// each route its own opengraph-image file fixes that at the root, and a PowerOPPS link now
// previews as PowerOPPS instead of as the homepage.
//
// Everything drawn here is a compile-time literal: Satori cannot resolve CSS custom
// properties, so the dark-theme tokens are inlined as hex.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const BG = "#0a0a0b"; // --background (dark)
const FG = "#e8e8e2"; // --foreground (dark)
const ACCENT = "#3b82f6"; // --accent (dark)
const MUTED = "#8b8b94"; // --muted (dark)

// A regular 17-gon, drawn faceted with sharp vertices and a flat edge at the top.
//
// app/icon.svg rounds every corner with quadratic curves, which reads correctly at 32px but
// collapses into a plain circle at this size — losing the one thing a heptadecagon is for.
// So the card draws the true polygon: 17 straight edges, first vertex placed so the shape
// sits on a level top edge rather than balancing on a point.
const SIDES = 17;
const R = 44;
const HEPTADECAGON = `M ${Array.from({ length: SIDES }, (_, k) => {
  const a = (-90 + 180 / SIDES + (k * 360) / SIDES) * (Math.PI / 180);
  return `${(50 + R * Math.cos(a)).toFixed(3)} ${(50 + R * Math.sin(a)).toFixed(3)}`;
}).join(" L ")} Z`;

// Space Grotesk to match the site. Fetched at build time; a network failure must NOT fail
// the build, so this falls back to Satori's bundled font — and the timeout means a hung
// font CDN cannot stall a deploy either.
async function spaceGrotesk(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(5000) }
    ).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export interface OgCardCopy {
  /** Big line. Split on the last "." so a domain renders its TLD in accent. */
  title: string;
  subtitle: string;
  /** Small tracked line under the accent rule. */
  footer?: string;
}

export async function renderOgCard({ title, subtitle, footer = "SAN FRANCISCO" }: OgCardCopy) {
  const font = await spaceGrotesk();
  const dot = title.lastIndexOf(".");
  const head = dot > 0 ? title.slice(0, dot) : title;
  const tail = dot > 0 ? title.slice(dot) : "";
  // Long project names need to step down or they collide with the emblem.
  const titleSize = title.length > 12 ? 84 : 116;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: BG,
          // One key light, up and to the right — the same direction as the hero caustic
          // and the commit board's lit faces.
          backgroundImage: `radial-gradient(1100px 700px at 88% -12%, ${ACCENT}26, transparent 62%)`,
          padding: "0 88px",
          fontFamily: font ? "Space Grotesk" : undefined,
        }}
      >
        <svg width={268} height={268} viewBox="0 0 100 100" style={{ marginRight: 72 }}>
          <path d={HEPTADECAGON} fill={FG} />
          {/* A concentric ring just inside the edge: it lands on the flats, not the
              vertices, so the facets become unmistakable instead of reading as a disc. */}
          <path
            d={HEPTADECAGON}
            fill="none"
            stroke={BG}
            strokeWidth={0.9}
            strokeOpacity={0.55}
            transform="translate(50 50) scale(0.88) translate(-50 -50)"
          />
        </svg>

        {/* Bounded width, or a long subtitle runs straight off the canvas: 1200 less the
            2x88 padding and the emblem's 268+72 leaves exactly this much room, and Satori
            clips rather than wrapping unless it is told the limit. */}
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 684 }}>
          {/* Satori requires an explicit display on any node with more than one child. */}
          <div
            style={{
              display: "flex",
              fontSize: titleSize,
              fontWeight: 700,
              letterSpacing: "-0.045em",
              color: FG,
              lineHeight: 1,
            }}
          >
            <span>{head}</span>
            {tail ? <span style={{ color: ACCENT }}>{tail}</span> : null}
          </div>
          <div
            style={{
              fontSize: 32,
              color: MUTED,
              marginTop: 24,
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
            }}
          >
            {subtitle}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 34 }}>
            <div style={{ width: 64, height: 4, background: ACCENT }} />
            <div style={{ fontSize: 25, color: MUTED, marginLeft: 22, letterSpacing: "0.14em" }}>
              {footer}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: font
        ? [{ name: "Space Grotesk", data: font, weight: 700 as const, style: "normal" as const }]
        : undefined,
    }
  );
}
