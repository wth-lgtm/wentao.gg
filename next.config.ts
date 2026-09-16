import type { NextConfig } from "next";

// Both env values below are pinned to this one instant so date and year can never
// disagree with each other.
const build = new Date();

const nextConfig: NextConfig = {
  env: {
    // Pre-formatted once, here, so server and client inline the identical literal.
    // The home page is a static prerender (x-nextjs-prerender: 1): the previous
    // env value baked in a raw ISO instant and Footer.tsx re-formatted it at
    // render time with no timeZone, so the UTC server and a viewer's local clock
    // formatted the same instant into different calendar dates — production's
    // 2026-09-16T04:23:28Z build rendered "Sep 16, 2026" server-side (UTC) but
    // "Sep 15, 2026" in America/Los_Angeles, a text-node mismatch that threw
    // React #418 on every home-page load west of UTC. Formatting with an explicit
    // zone at build time removes the divergence entirely.
    NEXT_PUBLIC_BUILD_DATE: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles",
    }).format(build),
    NEXT_PUBLIC_BUILD_YEAR: new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      timeZone: "America/Los_Angeles",
    }).format(build),
  },
  // Next 16.3 defaults this on: `next dev` (app-info-log.js → generate-agent-files.js)
  // writes AGENTS.md — untracked and absent from .gitignore — plus an `@AGENTS.md`
  // CLAUDE.md into the repo root. Being gitignored does not stop that CLAUDE.md from
  // being read back as this repo's agent instructions, and a dev server does not get
  // to author those.
  agentRules: false,
  // Enable compression
  compress: true,
  // Optimize images
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },
  // `curl -sI` against every production surface — /, /projects/hl-whale-tracker,
  // /projects/progdash, /api/geo, /api/github-stats, /sitemap.xml — came back with
  // strict-transport-security and nothing else: Vercel adds HSTS, the app added no
  // headers at all. These five are the subset that is provably inert here, so they
  // can be ENFORCED rather than shipped Report-Only:
  //   - DENY/frame-ancestors: the repo has no <iframe>, no postMessage, and
  //     signIn("google") is a top-level redirect, so nothing renders us framed.
  //   - Permissions-Policy: no navigator.geolocation, getUserMedia or clipboard
  //     call exists anywhere (the visitor geo probes are plain fetches).
  //     interest-cohort=() is deliberately absent — FLoC is dead.
  //   - nosniff: every response here declares its own type — NextResponse.json for the
  //     nine /api routes, ImageResponse for the four opengraph-image routes, the static
  //     /icon.svg — so nothing on this origin depends on a browser GUESSING a type, and
  //     the guess is the vector: a JSON body sniffed as HTML executes as HTML. Inert
  //     here, which is why it can be enforced rather than reported.
  //   - Referrer-Policy: strict-origin-when-cross-origin is already the default in
  //     current Chrome and Firefox, so this PINS a default rather than changing
  //     behaviour — for older engines, for any future change to it, and because the
  //     URLs on this site carry state: the whale page writes the selected trader
  //     address, window and tab into its query string (lib/urlState.ts) and the rows on
  //     that page link out to app.hyperliquid.xyz. Under a full-URL referrer the board's
  //     state travels to every third party a visitor clicks through to. Nothing here
  //     needs a cross-origin referrer, so there is nothing to trade away.
  // script-src is deliberately NOT here. The served home HTML carries 15 inline
  // <script> blocks, 8 of them self.__next_f.push RSC flight chunks whose contents
  // change per build and per page, so a hash-based policy breaks hydration and a
  // nonce-based one has to move to proxy.ts and forfeit the prerender these pages
  // currently serve from (x-nextjs-prerender: 1). That trade is a separate change.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
