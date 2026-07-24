import { ImageResponse } from "next/og";

// The social link preview. Until now the site had no OG image at all, so every share on
// X, LinkedIn, Slack, iMessage or Discord rendered as a bare text card — invisible from
// inside the browser, and the first thing most people ever see of the site.
//
// Rendered once at build time. Everything here is a compile-time literal: Satori can't
// resolve CSS custom properties, so the dark-theme tokens are inlined as hex.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "wentao.GG — Wentao He, engineer and developer";

const BG = "#0a0a0b"; // --background (dark)
const FG = "#e8e8e2"; // --foreground (dark)
const ACCENT = "#3b82f6"; // --accent (dark)
const MUTED = "#8b8b94"; // --muted (dark)

// A regular 17-gon, drawn faceted with sharp vertices and a flat edge at the top.
//
// app/icon.svg rounds every corner with quadratic curves, which reads correctly at 32px
// but collapses into a plain circle at 232px — losing the one thing a heptadecagon is
// for. So the share card draws the true polygon: 17 straight edges, first vertex placed
// so the shape sits on a level top edge rather than balancing on a point.
const SIDES = 17;
const R = 44;
const HEPTADECAGON = `M ${Array.from({ length: SIDES }, (_, k) => {
  const a = (-90 + 180 / SIDES + (k * 360) / SIDES) * (Math.PI / 180);
  return `${(50 + R * Math.cos(a)).toFixed(3)} ${(50 + R * Math.sin(a)).toFixed(3)}`;
}).join(" L ")} Z`;

// Space Grotesk to match the site. Fetched at build time; if the network is unavailable
// the build must NOT fail, so this falls back to Satori's bundled font.
async function spaceGrotesk(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    ).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const font = await spaceGrotesk();

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

        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Satori requires an explicit display on any node with more than one child. */}
          <div
            style={{
              display: "flex",
              fontSize: 116,
              fontWeight: 700,
              letterSpacing: "-0.045em",
              color: FG,
              lineHeight: 1,
            }}
          >
            <span>wentao</span>
            <span style={{ color: ACCENT }}>.GG</span>
          </div>
          <div style={{ fontSize: 34, color: MUTED, marginTop: 26, letterSpacing: "-0.01em" }}>
            Engineering Lead at Mercor · Applied AI
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 34 }}>
            <div style={{ width: 64, height: 4, background: ACCENT }} />
            <div style={{ fontSize: 25, color: MUTED, marginLeft: 22, letterSpacing: "0.14em" }}>
              SAN FRANCISCO
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: "Space Grotesk", data: font, weight: 700 as const, style: "normal" as const }]
        : undefined,
    }
  );
}
