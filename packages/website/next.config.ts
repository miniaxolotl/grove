import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import packageJson from "../../package.json";

const release = `grove-website@${process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "development"}`;
const upload =
  process.env.VERCEL_ENV === "production" &&
  process.env.SENTRY_ENABLED === "true";
if (upload && !process.env.SENTRY_AUTH_TOKEN)
  throw new Error(
    "Production Sentry source-map upload requires SENTRY_AUTH_TOKEN",
  );

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: process.env.VERCEL_ENV || "development",
    NEXT_PUBLIC_TELEMETRY_RELEASE: release,
  },
};

export default withSentryConfig(nextConfig, {
  org: "bramble-labs-inc",
  project: "grove-website",
  sentryUrl: "https://us.sentry.io",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !upload,
  sourcemaps: { disable: !upload, deleteSourcemapsAfterUpload: true },
  release: { name: release, create: upload, finalize: upload },
});
