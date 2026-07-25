import type { MetadataRoute } from "next";

// There was no robots.txt at all, so crawlers had no sitemap pointer and no directives.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://wentao.gg/sitemap.xml",
    host: "https://wentao.gg",
  };
}
