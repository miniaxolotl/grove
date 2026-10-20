"use client";

import posthog from "posthog-js";
import {
  analyticsEvents,
  maskReplayAttribute,
  pagePath,
  replayAllowed,
  safePageUrl,
  sanitizeEvent,
  surface,
  type AnalyticsEvent,
  type Operation,
  type Outcome,
  type Placement,
} from "./analytics-policy";
import {
  activateTelemetryGeneration,
  browserOptOut,
  notifyPreference,
  rotateTelemetryGeneration,
  storePreference,
  subscribePreference,
  telemetryAllowed,
  telemetryOptedOut,
} from "./telemetry-choice";

let initialized = false;
let suspended = false;
let lastPage: string | undefined;
let accountBoundary: string | null | undefined;
function registerContext() {
  posthog.register({
    product: "grove",
    surface: surface(location.href),
    environment: "production",
    version: process.env.NEXT_PUBLIC_APP_VERSION,
    release: process.env.NEXT_PUBLIC_TELEMETRY_RELEASE,
  });
  posthog.setPersonPropertiesForFlags(
    { environment: "production", surface: surface(location.href) },
    false,
  );
}
function configureReplay() {
  posthog.set_config({
    disable_session_recording:
      !telemetryAllowed() ||
      !replayAllowed(location.href) ||
      posthog.getFeatureFlag("session-replay", { send_event: false }) !== true,
  });
}
export function initializeAnalytics() {
  if (
    initialized ||
    telemetryOptedOut() ||
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT !== "production" ||
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED !== "true" ||
    !process.env.NEXT_PUBLIC_POSTHOG_KEY
  )
    return;
  try {
    activateTelemetryGeneration();
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: "https://us.i.posthog.com",
      ui_host: "https://us.posthog.com",
      defaults: "2026-01-30",
      persistence: "localStorage",
      opt_out_persistence_by_default: true,
      cross_subdomain_cookie: false,
      person_profiles: "never",
      ip: false,
      respect_dnt: true,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_performance: { web_vitals: true, network_timing: false },
      enable_recording_console_log: false,
      disable_session_recording: true,
      disable_surveys: false,
      advanced_disable_feature_flags_on_first_load: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        blockSelector:
          "img, video, canvas, iframe, [data-private], .ph-no-capture, .grove-app, .connect-shell, .auth-page, .cl-rootBox, .cl-portal",
        maskAttributeFn: maskReplayAttribute,
        captureJsonLd: false,
        recordCrossOriginIframes: false,
        collectFonts: false,
        recordHeaders: false,
        recordBody: false,
        maskCapturedNetworkRequestFn: (request) => ({
          ...request,
          name: safePageUrl(request.name),
        }),
      },
      before_send: (event) =>
        telemetryAllowed()
          ? sanitizeEvent(event, location.href, document.referrer)
          : null,
      loaded: (client) => {
        registerContext();
        client.onFeatureFlags(configureReplay);
        client.reloadFeatureFlags();
      },
    });
    initialized = true;
    subscribePreference(() => {
      if (!telemetryAllowed() && !suspended) {
        suspended = true;
        posthog.opt_out_capturing();
        posthog.stopSessionRecording();
      }
    });
  } catch {
    /* Telemetry never prevents rendering. */
  }
}
export function prepareTelemetryNavigation() {
  if (!initialized) return;
  try {
    posthog.set_config({ disable_session_recording: true });
  } catch {
    /* Best effort. */
  }
}
export function resetTelemetryIdentity() {
  initializeAnalytics();
  if (!initialized || telemetryOptedOut()) return;
  try {
    rotateTelemetryGeneration();
    posthog.stopSessionRecording();
    posthog.reset(true);
    registerContext();
    posthog.reloadFeatureFlags();
    lastPage = undefined;
  } catch {
    /* Private storage failure stops uploads. */
  }
}
// Used only in memory to detect account transitions. Never register or transmit it.
export function setAccountBoundary(account: string | null) {
  if (accountBoundary === account) return;
  const wasAnonymous = accountBoundary === undefined && account === null;
  accountBoundary = account;
  if (!wasAnonymous) resetTelemetryIdentity();
  capturePageview(location.pathname);
}
export function setTelemetryOptOut(disabled: boolean) {
  try {
    storePreference(disabled);
    if (disabled && initialized) {
      suspended = true;
      posthog.opt_out_capturing();
      posthog.stopSessionRecording();
    } else if (!disabled && !browserOptOut()) {
      suspended = false;
      activateTelemetryGeneration();
      if (initialized) posthog.reset(true);
      else initializeAnalytics();
      if (initialized) {
        posthog.opt_in_capturing({ captureEventName: false });
        registerContext();
        posthog.reloadFeatureFlags();
      }
      lastPage = undefined;
      capturePageview(location.pathname);
    }
  } catch {
    /* Storage failure keeps collection disabled. */
  } finally {
    notifyPreference();
  }
}
export function capture(
  event: AnalyticsEvent,
  properties: {
    target_product?: string;
    placement?: Placement;
    operation?: Operation;
    outcome?: Outcome;
    duration_ms?: number;
  } = {},
) {
  if (!initialized || !telemetryAllowed()) return;
  try {
    posthog.capture(event, properties);
  } catch {
    /* Best effort. */
  }
}
export function capturePageview(path: string) {
  if (surface(path) === "workspace" && !accountBoundary) return;
  initializeAnalytics();
  if (!initialized || !telemetryAllowed()) return;
  const route = pagePath(path);
  if (route === lastPage) return;
  lastPage = route;
  try {
    registerContext();
    configureReplay();
    posthog.capture("$pageview", { $current_url: safePageUrl(path) });
  } catch {
    /* Best effort. */
  }
}
export function subscribeCtaVariant(callback: () => void) {
  let unsubscribeFlags: (() => void) | undefined;
  const update = () => {
    unsubscribeFlags?.();
    unsubscribeFlags =
      initialized && telemetryAllowed()
        ? posthog.onFeatureFlags(callback)
        : undefined;
    callback();
  };
  update();
  const unsubscribePreference = subscribePreference(update);
  return () => {
    unsubscribeFlags?.();
    unsubscribePreference();
  };
}
export function ctaVariant(): "control" | "benefit" {
  return initialized &&
    telemetryAllowed() &&
    posthog.getFeatureFlag("website-cta-copy", { send_event: false }) ===
      "benefit"
    ? "benefit"
    : "control";
}
export function captureCtaExposure() {
  if (initialized && telemetryAllowed())
    posthog.getFeatureFlag("website-cta-copy");
}
export function captureLinkClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLElement>("[data-analytics-event]");
  const name = link?.dataset.analyticsEvent;
  if (!name || !(analyticsEvents as readonly string[]).includes(name)) return;
  capture(name as AnalyticsEvent, {
    target_product: link.dataset.analyticsProduct,
    placement: link.dataset.analyticsPlacement as Placement,
  });
}
