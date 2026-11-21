import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { telemetryBuild } from "./telemetry-build.mjs";
import { resolveDecision } from "./selected-decision.mjs";
import { pathToFileURL } from "node:url";

export function releaseDiagnostics(env, { read, head, resolve, run }) {
  const selected = env.RELEASE_DECISION_HASH
    ? resolve(env.RELEASE_SOURCE_SHA)
    : null;
  if (env.RELEASE_DECISION_HASH) {
    assert.equal(selected?.hash, env.RELEASE_DECISION_HASH);
    assert(selected.manifest.deliver.includes("service"));
  }
  assert(env.SENTRY_AUTH_TOKEN, "SENTRY_AUTH_TOKEN is required");
  assert(
    env.GROVE_HELD_RELEASE_BUILD === undefined ||
      ["true", "false"].includes(env.GROVE_HELD_RELEASE_BUILD),
    "Invalid held image build control",
  );
  const productVersion = read("package.json").version;
  const targets = [
    ["api", "api", "grove-api"],
    ["cli", "mcp", "grove-cli"],
    ["opencode", "grove-opencode-plugin", "grove-cli"],
  ].filter(([component]) => !selected || component === "api");
  // Check every selected map before creating any remote diagnostics release.
  for (const [component, directory] of targets) {
    const version = read(`packages/${directory}/package.json`).version;
    const config = telemetryBuild(env, version, component);
    assert(config.enabled, "Release telemetry must be enabled");
    assert.equal(head(), config.revision);
    const metadata = read(`packages/${directory}/dist/telemetry-build.json`);
    assert.deepEqual(metadata, {
      enabled: true,
      revision: config.revision,
      version,
      component,
      holdRequired:
        component === "api" && env.GROVE_HELD_RELEASE_BUILD === "true",
      productVersion,
    });
  }
  for (const [component, directory, project] of targets) {
    const release = `grove-${component}@${env.RELEASE_SOURCE_SHA}`;
    run(project, "releases", "new", "--project", project, release);
    run(
      project,
      "releases",
      "set-commits",
      release,
      "--commit",
      `miniaxolotl/grove@${env.RELEASE_SOURCE_SHA}`,
    );
    run(
      project,
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
    run(project, "releases", "finalize", release);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  releaseDiagnostics(process.env, {
    read: (path) => JSON.parse(readFileSync(path, "utf8")),
    head: () =>
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    resolve: (source) => resolveDecision(source, true),
    run: (project, ...args) =>
      execFileSync("pnpm", ["exec", "sentry-cli", ...args], {
        stdio: "inherit",
        env: {
          ...process.env,
          SENTRY_ORG: "bramble-labs-inc",
          SENTRY_PROJECT: project,
          SENTRY_URL: "https://sentry.io/",
        },
      }),
  });
}
