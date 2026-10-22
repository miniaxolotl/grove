"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { telemetryAllowed } from "@/lib/telemetry-choice";
import { RotateCw } from "lucide-react";
import { RecoveryPage } from "@/components/recovery-page";

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
      <head>
        <title>Page unavailable · Grove</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </head>
      <body className="recovery-document">
        <RecoveryPage
          label="Page unavailable"
          title="This page couldn’t open"
          description="Something interrupted loading. Try again in a moment, or return to Grove."
          actions={
            <>
              <button type="button" className="recovery-button" onClick={retry}>
                <RotateCw size={16} aria-hidden="true" /> Try again
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recover with a new document if the root layout or router failed. */}
              <a href="/" className="recovery-button secondary">
                Back to Grove
              </a>
            </>
          }
        />
      </body>
    </html>
  );
}
