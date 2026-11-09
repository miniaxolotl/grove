import type { Metadata } from "next";
import { site } from "@/lib/site";

export function pageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  const image = {
    url: `${site.url}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: site.imageAlt,
  };

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: `${site.url}${path}`,
      siteName: site.name,
      title,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
