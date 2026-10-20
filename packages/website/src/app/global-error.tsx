"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { telemetryAllowed } from "@/lib/telemetry-choice";

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    if (telemetryAllowed()) Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <h1>Grove could not open this page</h1>
        <p>Please try again.</p>
        <button onClick={retry}>Try again</button>
      </body>
    </html>
  );
}
