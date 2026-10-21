import * as Sentry from "@sentry/nextjs";
import {
  dataCollection,
  sanitizeError,
  sanitizeSpan,
} from "./lib/diagnostics-policy";

export function register() {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.SENTRY_ENABLED !== "true" ||
    !process.env.SENTRY_DSN
  )
    return;
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: "production",
      release: process.env.NEXT_PUBLIC_TELEMETRY_RELEASE,
      dataCollection,
      includeServerName: false,
      sendClientReports: false,
      tracesSampleRate: 0.1,
      tracePropagationTargets: [],
      strictTraceContinuation: true,
      beforeBreadcrumb: () => null,
      beforeSend: sanitizeError,
      beforeSendSpan: sanitizeSpan,
      beforeSendLog: () => null,
      beforeSendMetric: () => null,
    });
  } catch {
    /* Provider initialization must not prevent website startup. */
  }
}
export const onRequestError = Sentry.captureRequestError;
