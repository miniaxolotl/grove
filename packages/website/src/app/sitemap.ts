import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { documentation } from "@/content/documentation";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url, changeFrequency: "monthly", priority: 1 },
    { url: `${site.url}/docs`, changeFrequency: "monthly", priority: 0.8 },
    ...documentation.map(({ slug }) => ({
      url: `${site.url}/docs/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${site.url}/support`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${site.url}/contact`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${site.url}/install`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${site.url}/self-host`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${site.url}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site.url}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
