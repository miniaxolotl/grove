import assert from "node:assert/strict";
import { URL } from "node:url";

export function telemetryBuild(env, version, component) {
  if (env.GROVE_TELEMETRY_BUILD !== "production")
    return {
      enabled: false,
      revision: "",
      version,
      component,
      key: "",
      cliDsn: "",
      apiDsn: "",
    };
  assert.match(
    env.RELEASE_SOURCE_SHA ?? "",
    /^[a-f0-9]{40}$/,
    "Exact release source is required for telemetry",
  );
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(
    env.GROVE_POSTHOG_KEY ?? "",
    /^phc_[A-Za-z0-9]+$/,
    "Grove PostHog ingestion key is required",
  );
  for (const name of ["GROVE_CLI_SENTRY_DSN", "GROVE_API_SENTRY_DSN"]) {
    const dsn = new URL(env[name]);
    assert(
      dsn.protocol === "https:" &&
        /^[a-f0-9]+$/.test(dsn.username) &&
        !dsn.password &&
        dsn.hostname.endsWith(".sentry.io") &&
        /^\/\d+$/.test(dsn.pathname),
      `Invalid ${name}`,
    );
  }
  return {
    enabled: true,
    revision: env.RELEASE_SOURCE_SHA,
    version,
    component,
    key: env.GROVE_POSTHOG_KEY,
    cliDsn: env.GROVE_CLI_SENTRY_DSN,
    apiDsn: env.GROVE_API_SENTRY_DSN,
  };
}
