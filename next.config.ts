import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Pre-formatted at build time so server and client inline the identical string —
    // an unqualified new Date() + toLocaleDateString() diverged by viewer time zone
    // (UTC server vs. e.g. America/Los_Angeles client) and threw React #418 on every
    // home-page load west of UTC. See .superpowers/sdd/2026-09-15-review-fixes.
    NEXT_PUBLIC_BUILD_DATE: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles",
    }).format(new Date()),
    NEXT_PUBLIC_BUILD_YEAR: new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      timeZone: "America/Los_Angeles",
    }).format(new Date()),
  },
  // Enable compression
  compress: true,
  // Optimize images
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },
};

export default nextConfig;
