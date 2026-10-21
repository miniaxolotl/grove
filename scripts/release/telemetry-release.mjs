import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { telemetryBuild } from "./telemetry-build.mjs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const config = telemetryBuild(process.env, version, "api");
assert(config.enabled, "Release telemetry must be enabled");
assert(process.env.SENTRY_AUTH_TOKEN, "SENTRY_AUTH_TOKEN is required");
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  config.revision,
);
for (const [component, directory, project] of [
  ["api", "api", "grove-api"],
  ["cli", "mcp", "grove-cli"],
  ["opencode", "grove-opencode-plugin", "grove-cli"],
]) {
  const release = `grove-${component}@${config.revision}`;
  const metadata = JSON.parse(
    readFileSync(`packages/${directory}/dist/telemetry-build.json`, "utf8"),
  );
  assert.deepEqual(metadata, {
    enabled: true,
    revision: config.revision,
    version,
    component,
  });
  const run = (...args) =>
    execFileSync("pnpm", ["exec", "sentry-cli", ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        SENTRY_ORG: "bramble-labs-inc",
        SENTRY_PROJECT: project,
        SENTRY_URL: "https://sentry.io/",
      },
    });
  run("releases", "new", "--project", project, release);
  run(
    "releases",
    "set-commits",
    release,
    "--commit",
    `miniaxolotl/grove@${config.revision}`,
  );
  run(
    "sourcemaps",
    "upload",
    "--release",
    release,
    "--url-prefix",
    "app:///",
    "--rewrite",
    "--validate",
    `packages/${directory}/dist`,
  );
  run("releases", "finalize", release);
}
