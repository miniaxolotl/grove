"use client";

import { useEffect, useSyncExternalStore } from "react";
import { preferencesVisible } from "@/lib/cookie-consent";
import {
  consentPending,
  subscribeConsent,
  acceptCookies,
  dismissCookies,
} from "@/lib/cookie-consent";
import { capturePageview, setTelemetryOptOut } from "@/lib/analytics";
import {
  initializeCookieConsent,
  showCookieSettings,
} from "@/lib/cookie-consent";

export function WebsiteCookieConsent() {
  const preferences = useSyncExternalStore(
    subscribeConsent,
    preferencesVisible,
    () => false,
  );
  const pending = useSyncExternalStore(
    subscribeConsent,
    consentPending,
    () => false,
  );
  useEffect(() => {
    initializeCookieConsent(
      (allowed) => setTelemetryOptOut(!allowed),
      () => capturePageview(location.pathname),
    );
  }, []);
  return pending ? (
    <aside
      className="cookie-notice"
      aria-label="Cookie choices"
      hidden={preferences}
    >
      <strong>Cookies</strong>
      <p>Optional cookies help improve this site and personalize ads.</p>
      <div className="cookie-notice-actions">
        <button type="button" onClick={acceptCookies}>
          Accept all
        </button>
        <button type="button" onClick={dismissCookies}>
          No thanks
        </button>
        <button
          type="button"
          className="cookie-notice-settings"
          onClick={showCookieSettings}
        >
          Settings
        </button>
      </div>
    </aside>
  ) : null;
}

export function CookieSettings() {
  return (
    <button
      type="button"
      className="cookie-settings"
      onClick={showCookieSettings}
    >
      Cookie settings
    </button>
  );
}
