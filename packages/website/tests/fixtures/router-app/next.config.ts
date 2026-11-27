import type { NextConfig } from "next";
import { resolve } from "node:path";

// An isolated test application, never imported by the production configuration.
const config: NextConfig = {
  poweredByHeader: false,
  webpack(configuration) {
    configuration.resolve.alias["@clerk/nextjs$"] = resolve(
      import.meta.dirname,
      "../workspace-account.tsx",
    );
    return configuration;
  },
  env: {
    NEXT_PUBLIC_POSTHOG_ENABLED: "false",
    NEXT_PUBLIC_SENTRY_ENABLED: "false",
  },
};
export default config;
