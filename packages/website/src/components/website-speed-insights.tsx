"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";

const publicPaths = new Set(["/", "/install", "/privacy", "/terms"]);

export function WebsiteSpeedInsights() {
  return (
    <SpeedInsights
      beforeSend={(data) => {
        const url = new URL(data.url);
        if (!publicPaths.has(url.pathname)) return null;
        return {
          ...data,
          url: `${url.origin}${url.pathname}`,
          route: url.pathname,
        };
      }}
    />
  );
}
