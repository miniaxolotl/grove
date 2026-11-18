"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { telemetryOptedOut, subscribePreference } from "@/lib/telemetry-choice";

import { campaignUrl, publicCampaignDocument } from "@/lib/campaign-url";

const publicPaths = new Set([
  "/",
  "/contact",
  "/support",
  "/privacy",
  "/terms",
  "/install",
  "/self-host",
  "/pricing",
  "/docs",
  "/examples",
  "/writing",
]);

const origin = "https://usegrove.cloud";
function publicDocument(raw: string): boolean {
  return publicCampaignDocument(raw, origin, publicPaths);
}

// A private initial document must not acquire vendor scripts after client routing.
const initialUrl =
  typeof window === "undefined" ? null : new URL(window.location.href);
if (initialUrl?.searchParams.get("tracking") === "off")
  initialUrl.searchParams.delete("tracking");
const initialDocumentPublic =
  initialUrl !== null && publicDocument(initialUrl.href);

function insightsDisabled(): boolean {
  return (
    telemetryOptedOut() ||
    !initialDocumentPublic ||
    !publicDocument(window.location.href)
  );
}

function useInsightsDisabled() {
  const pathname = usePathname();
  const disabled = useSyncExternalStore(
    subscribePreference,
    insightsDisabled,
    () => true,
  );
  return disabled || !publicPaths.has(pathname);
}

export function WebsiteSpeedInsights() {
  const disabled = useInsightsDisabled();
  if (disabled) return null;
  return (
    <SpeedInsights
      beforeSend={(data) => {
        if (insightsDisabled()) return null;
        const projected = campaignUrl(data.url, origin, publicPaths);
        if (!projected) return null;
        const url = new URL(projected);
        return {
          ...data,
          url: `${url.origin}${url.pathname}`,
          route: url.pathname,
        };
      }}
    />
  );
}

export function WebsiteVercelAnalytics() {
  const disabled = useInsightsDisabled();
  return disabled ? null : (
    <Analytics
      beforeSend={(event) => {
        if (insightsDisabled()) return null;
        const url = campaignUrl(event.url, origin, publicPaths);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
