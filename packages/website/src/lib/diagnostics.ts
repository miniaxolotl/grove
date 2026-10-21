"use client";

import * as Sentry from "@sentry/nextjs";
import {
  dataCollection,
  sanitizeError,
  sanitizeLog,
  sanitizeMetric,
  sanitizeSpan,
} from "./diagnostics-policy";
import {
  activateTelemetryGeneration,
  subscribePreference,
  telemetryAllowed,
  telemetryOptedOut,
} from "./telemetry-choice";
import { capture } from "./analytics";
import { surface, type Operation, type Outcome } from "./analytics-policy";

let initialized = false;
export function initializeDiagnostics() {
  if (
    initialized ||
    telemetryOptedOut() ||
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT !== "production" ||
    process.env.NEXT_PUBLIC_SENTRY_ENABLED !== "true" ||
    !process.env.NEXT_PUBLIC_SENTRY_DSN
  )
    return;
  try {
    activateTelemetryGeneration();
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: "production",
      release: process.env.NEXT_PUBLIC_TELEMETRY_RELEASE,
      dataCollection,
      sendClientReports: false,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
      tracePropagationTargets: [/^https:\/\/usegrove\.cloud\/api\/grove\//],
      beforeBreadcrumb: () => null,
      beforeSend: (event) => (telemetryAllowed() ? sanitizeError(event) : null),
      beforeSendSpan: sanitizeSpan,
      beforeSendLog: (log) => (telemetryAllowed() ? sanitizeLog(log) : null),
      beforeSendMetric: (metric) =>
        telemetryAllowed() ? sanitizeMetric(metric) : null,
      transport: (options) => {
        const transport = Sentry.makeFetchTransport(options);
        return {
          ...transport,
          send: (envelope) =>
            telemetryAllowed()
              ? transport.send(envelope)
              : Promise.resolve({ statusCode: 200 }),
        };
      },
    } satisfies Sentry.BrowserOptions);
    initialized = true;
  } catch {
    /* Diagnostics are independent of product behavior. */
  }
}
export function observeDiagnosticsPreference() {
  initializeDiagnostics();
  subscribePreference(initializeDiagnostics);
}
export function recordWebsiteOperation(
  operation: Operation,
  outcome: Outcome,
  duration: number,
) {
  capture("operation_completed", { operation, outcome, duration_ms: duration });
  if (!initialized || !telemetryAllowed()) return;
  try {
    const attributes = { operation, outcome, surface: surface(location.href) };
    // Successful reads can be frequent; metrics cover them without text logs.
    if (operation !== "workspace_read" || outcome !== "success")
      Sentry.logger.info("Website operation completed", attributes);
    Sentry.metrics.count("website.operation.count", 1, { attributes });
    Sentry.metrics.distribution("website.operation.duration", duration, {
      unit: "millisecond",
      attributes,
    });
  } catch {
    /* Best effort. */
  }
}
