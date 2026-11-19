import assert from "node:assert/strict";
import test from "node:test";
import { releaseDiagnostics } from "./telemetry-release.mjs";

test("hosted-only diagnostics use the preserved API package version and never publish CLI diagnostics", () => {
  const revision = "a".repeat(40),
    hash = "b".repeat(64),
    writes = [];
  const env = {
    GROVE_TELEMETRY_BUILD: "production",
    RELEASE_SOURCE_SHA: revision,
    RELEASE_DECISION_HASH: hash,
    SENTRY_AUTH_TOKEN: "fixture",
    GROVE_POSTHOG_KEY: "phc_fixture",
    GROVE_API_SENTRY_DSN: "https://abc@o0.ingest.us.sentry.io/1",
    GROVE_CLI_SENTRY_DSN: "https://abc@o0.ingest.us.sentry.io/2",
  };
  const io = {
    head: () => revision,
    resolve: () => ({ hash, manifest: { deliver: ["service"] } }),
    read: (path) => {
      if (path === "packages/api/package.json") return { version: "2.3.4" };
      assert.equal(path, "packages/api/dist/telemetry-build.json");
      return { enabled: true, revision, version: "2.3.4", component: "api" };
    },
    run: (...args) => writes.push(args),
  };
  releaseDiagnostics(env, io);
  assert.equal(writes.length, 4);
  assert(writes.every((args) => args[0] === "grove-api"));
  writes.length = 0;
  assert.throws(() =>
    releaseDiagnostics({ ...env, RELEASE_DECISION_HASH: "c".repeat(64) }, io),
  );
  assert.equal(writes.length, 0);
  assert.throws(() =>
    releaseDiagnostics(env, {
      ...io,
      read: (path) =>
        path.endsWith("package.json")
          ? { version: "2.3.4" }
          : { enabled: true, revision, version: "9.9.9", component: "api" },
    }),
  );
  assert.equal(writes.length, 0);
});
