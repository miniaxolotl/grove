import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      ...(site.indexable
        ? {
            allow: "/",
            disallow: [
              "/app",
              "/api",
              "/sign-in",
              "/sign-up",
              "/welcome",
              "/s/",
            ],
          }
        : {
            disallow: [
              "/",
              "/app",
              "/api",
              "/sign-in",
              "/sign-up",
              "/welcome",
              "/s/",
            ],
          }),
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
