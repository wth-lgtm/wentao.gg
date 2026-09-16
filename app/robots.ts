import type { MetadataRoute } from "next";

// There was no robots.txt at all, so crawlers had no sitemap pointer and no directives.
//
// The origin is spelled out here, in app/sitemap.ts and in app/layout.tsx's
// `metadataBase` — three copies, all currently "https://wentao.gg". They are left as
// literals rather than hoisted because the only module that could hold the constant for
// all three is the root layout, and importing it into these two would pull the fonts and
// the provider tree into a robots.txt build. So: if the origin ever changes, it changes
// in THREE files, and a mismatch shows up as a canonical URL disagreeing with the
// sitemap rather than as a build error.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://wentao.gg/sitemap.xml",
    host: "https://wentao.gg",
  };
}
