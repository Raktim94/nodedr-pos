import type { MetadataRoute } from "next";

const routes: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/login", priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:1994";
  const now = new Date();
  return routes.map(({ path, priority }) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority,
  }));
}
