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
