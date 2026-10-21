import test from "node:test";
import assert from "node:assert/strict";
import { telemetryBuild } from "./telemetry-build.mjs";

test("only explicit exact-source production builds embed public ingestion settings", () => {
  const env = {
    GROVE_TELEMETRY_BUILD: "production",
    RELEASE_SOURCE_SHA: "a".repeat(40),
    GROVE_POSTHOG_KEY: "phc_fixture",
    GROVE_CLI_SENTRY_DSN: "https://aaaaaaaa@o0.ingest.us.sentry.io/1",
    GROVE_API_SENTRY_DSN: "https://bbbbbbbb@o0.ingest.us.sentry.io/2",
    SENTRY_AUTH_TOKEN: "PRIVATE_UPLOAD_TOKEN",
    NODE_AUTH_TOKEN: "PRIVATE_NPM_TOKEN",
    GROVE_TELEMETRY_SALT: "PRIVATE_RUNTIME_SALT",
  };
  const result = telemetryBuild(env, "1.6.0", "cli");
  assert(result.enabled);
  assert(!JSON.stringify(result).includes("PRIVATE"));
  for (const key of [
    "RELEASE_SOURCE_SHA",
    "GROVE_POSTHOG_KEY",
    "GROVE_API_SENTRY_DSN",
    "GROVE_CLI_SENTRY_DSN",
  ])
    assert.throws(() => telemetryBuild({ ...env, [key]: "" }, "1.6.0", "cli"));
  for (const mode of ["", "staging", "preview"]) {
    const disabled = telemetryBuild(
      { ...env, GROVE_TELEMETRY_BUILD: mode },
      "1.6.0",
      "api",
    );
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.key, "");
    assert.equal(disabled.apiDsn, "");
  }
});
