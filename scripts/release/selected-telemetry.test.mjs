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
      if (path === "package.json") return { version: "3.0.0" };
      if (path === "packages/api/package.json") return { version: "2.3.4" };
      assert.equal(path, "packages/api/dist/telemetry-build.json");
      return {
        enabled: true,
        revision,
        version: "2.3.4",
        component: "api",
        holdRequired: false,
        productVersion: "3.0.0",
      };
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

test("coordinated diagnostics validate product and API-only hold metadata before any upload", () => {
  const revision = "a".repeat(40);
  const env = {
    GROVE_TELEMETRY_BUILD: "production",
    GROVE_HELD_RELEASE_BUILD: "true",
    RELEASE_SOURCE_SHA: revision,
    SENTRY_AUTH_TOKEN: "fixture",
    GROVE_POSTHOG_KEY: "phc_fixture",
    GROVE_API_SENTRY_DSN: "https://abc@o0.ingest.us.sentry.io/1",
    GROVE_CLI_SENTRY_DSN: "https://abc@o0.ingest.us.sentry.io/2",
  };
  const writes = [];
  const read = (path) => {
    if (path === "package.json") return { version: "3.0.0" };
    if (path.endsWith("/package.json")) return { version: "2.3.4" };
    const component = path.includes("/api/")
      ? "api"
      : path.includes("/mcp/")
        ? "cli"
        : "opencode";
    return {
      enabled: true,
      revision,
      version: "2.3.4",
      component,
      holdRequired: component === "api",
      productVersion: "3.0.0",
    };
  };
  const io = {
    read,
    head: () => revision,
    resolve: () => null,
    run: (...args) => writes.push(args),
  };
  releaseDiagnostics(env, io);
  assert.equal(writes.length, 12);
  for (const field of ["productVersion", "holdRequired"]) {
    writes.length = 0;
    assert.throws(() =>
      releaseDiagnostics(env, {
        ...io,
        read: (path) => {
          const value = read(path);
          if (!path.includes("/grove-opencode-plugin/dist/")) return value;
          return {
            ...value,
            [field]: field === "productVersion" ? "unexpected" : true,
          };
        },
      }),
    );
    assert.equal(writes.length, 0);
  }
  assert.throws(() =>
    releaseDiagnostics({ ...env, GROVE_HELD_RELEASE_BUILD: "invalid" }, io),
  );
  assert.equal(writes.length, 0);
});
