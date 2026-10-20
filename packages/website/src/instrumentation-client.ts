import * as Sentry from "@sentry/nextjs";
import { observeDiagnosticsPreference } from "./lib/diagnostics";
import { prepareTelemetryNavigation } from "./lib/analytics";

observeDiagnosticsPreference();
export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart =
  (...args) => {
    prepareTelemetryNavigation();
    Sentry.captureRouterTransitionStart(...args);
  };
