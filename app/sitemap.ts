import type { MetadataRoute } from "next";

// A static list on purpose: five hand-known routes beat a filesystem walk that would also
// pick up API routes and image handlers.
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/projects/poweropps", priority: 0.8, changeFrequency: "monthly" },
  { path: "/projects/progdash", priority: 0.8, changeFrequency: "monthly" },
  { path: "/projects/hl-whale-tracker", priority: 0.8, changeFrequency: "monthly" },
  { path: "/projects/progdash/privacy", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `https://wentao.gg${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
