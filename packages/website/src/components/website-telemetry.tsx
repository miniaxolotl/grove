"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { CookieSettings } from "./cookie-consent";
import { consentAllowed, showCookieSettings } from "@/lib/cookie-consent";
import {
  captureCtaExposure,
  captureLinkClick,
  capturePageview,
  ctaVariant,
  setAccountBoundary,
  setTelemetryOptOut,
  subscribeCtaVariant,
} from "@/lib/analytics";
import {
  browserOptOut,
  subscribePreference,
  telemetryOptedOut,
} from "@/lib/telemetry-choice";

export function WebsiteTelemetry() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname.startsWith("/app")) setAccountBoundary(null);
    capturePageview(pathname);
  }, [pathname]);
  useEffect(() => {
    document.addEventListener("click", captureLinkClick);
    return () => document.removeEventListener("click", captureLinkClick);
  }, []);
  return null;
}
export function TelemetryChoice() {
  const optedOut = useSyncExternalStore(
    subscribePreference,
    telemetryOptedOut,
    () => false,
  );
  return (
    <>
      <CookieSettings />
      <button
        type="button"
        className="text-xs underline underline-offset-4"
        disabled={optedOut && browserOptOut()}
        onClick={() =>
          optedOut && !consentAllowed("analytics")
            ? showCookieSettings()
            : setTelemetryOptOut(!optedOut)
        }
      >
        {optedOut
          ? browserOptOut()
            ? "Telemetry disabled by browser"
            : "Enable website telemetry"
          : "Disable website telemetry"}
      </button>
    </>
  );
}
export function HeroCtaCopy() {
  const variant = useSyncExternalStore(
    subscribeCtaVariant,
    ctaVariant,
    () => "control",
  );
  useEffect(() => {
    captureCtaExposure();
  }, [variant]);
  return variant === "benefit" ? "Save your first note" : "Start your notebook";
}
