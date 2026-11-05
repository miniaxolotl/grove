import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { pathToFileURL, URL } from "node:url";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";

const origin = "https://usegrove.cloud";
function configuration(env) {
  for (const key of ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"])
    assert(env[key]?.trim(), `${key} is required`);
  assert.match(env.VERCEL_ORG_ID, /^team_[\w]+$/);
  assert.match(env.VERCEL_PROJECT_ID, /^prj_[\w]+$/);
}
async function request(env, path, fetch) {
  const response = await fetch(
    `https://api.vercel.com${path}?teamId=${env.VERCEL_ORG_ID}`,
    {
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(30_000),
    },
  );
  assert(response.ok, `Vercel request failed (HTTP ${response.status})`);
  return response.json();
}

export async function preflightWebsite(env, fetch = globalThis.fetch) {
  configuration(env);
  const project = await request(
    env,
    `/v9/projects/${env.VERCEL_PROJECT_ID}`,
    fetch,
  );
  assert.equal(project.id, env.VERCEL_PROJECT_ID, "Vercel project mismatch");
  assert.equal(project.accountId, env.VERCEL_ORG_ID, "Vercel team mismatch");
  assert.equal(
    project.rootDirectory,
    "packages/website",
    "Vercel root mismatch",
  );
  assert.equal(
    project.commandForIgnoringBuildStep,
    "exit 0",
    "Disable independent Git builds before publication",
  );
  const { envs } = await request(
    env,
    `/v10/projects/${env.VERCEL_PROJECT_ID}/env`,
    fetch,
  );
  const keys = new Set(
    envs
      .filter((item) => item.target?.includes("production"))
      .map((item) => item.key),
  );
  assert(
    [
      "CLERK_SECRET_KEY",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "GROVE_API_URL",
      "SITE_URL",
    ].every((key) => keys.has(key)),
    "Missing Vercel production configuration",
  );
}

export async function deployWebsite(
  env,
  { run, fetch = globalThis.fetch, assertCurrent, writeIdentity, version },
) {
  configuration(env);
  assert.match(
    env.RELEASE_SOURCE_SHA ?? "",
    /^[a-f0-9]{40}$/,
    "Invalid source SHA",
  );
  assert.match(
    env.GITHUB_SHA ?? "",
    /^[a-f0-9]{40}$/,
    "Invalid production SHA",
  );
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const identity = {
    repository: "miniaxolotl/grove",
    version,
    sourceSha: env.RELEASE_SOURCE_SHA,
    productionSha: env.GITHUB_SHA,
  };
  // VERCEL_TOKEN/ORG_ID/PROJECT_ID already select the exact project. --scope
  // triggers a user lookup that project-only tokens intentionally cannot access.
  assertCurrent();
  run(["pull", "--yes", "--environment=production"]);
  writeIdentity(identity);
  run(["build", "--prod"]);
  assertCurrent();
  const url = new URL(
    run([
      "deploy",
      "--prebuilt",
      "--yes",
      "--prod",
      "--meta",
      `releaseSourceSha=${env.RELEASE_SOURCE_SHA}`,
      "--meta",
      `githubCommitSha=${env.GITHUB_SHA}`,
    ]).trim(),
  );
  assert(
    url.protocol === "https:" &&
      url.hostname.endsWith(".vercel.app") &&
      !url.username &&
      !url.password,
    "Unexpected Vercel deployment URL",
  );
  const deployment = await request(
    env,
    `/v13/deployments/${url.hostname}`,
    fetch,
  );
  assert.equal(
    deployment.projectId,
    env.VERCEL_PROJECT_ID,
    "Deployment project mismatch",
  );
  assert.equal(
    deployment.readyState,
    "READY",
    "Website deployment is not ready",
  );
  assert.equal(deployment.target, "production");
  assert.equal(
    deployment.meta?.releaseSourceSha,
    env.RELEASE_SOURCE_SHA,
    "Deployment source mismatch",
  );
  assert.equal(
    deployment.meta?.githubCommitSha,
    env.GITHUB_SHA,
    "Deployment production mismatch",
  );
  const live = await fetch(`${origin}/release.json?sha=${env.GITHUB_SHA}`, {
    cache: "no-store",
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  assert(live.ok, "Website release identity is unavailable");
  assert.deepEqual(
    await live.json(),
    identity,
    "Live website identity mismatch",
  );
  const home = await fetch(origin, {
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  assert(home.ok, "Website homepage is not healthy");
  assertCurrent();
  return { ...identity, deploymentUrl: url.origin };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await preflightWebsite(process.env);
    if (process.argv[2] === "deploy") {
      const evidence = await deployWebsite(process.env, {
        version: JSON.parse(readFileSync("package.json", "utf8")).version,
        assertCurrent: () => assertCurrentRef(workflowContext()),
        writeIdentity: (identity) =>
          writeFileSync(
            "packages/website/public/release.json",
            `${JSON.stringify(identity)}\n`,
          ),
        run: (args) =>
          execFileSync("npx", ["--yes", "vercel@65.2.0", ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "inherit"],
            timeout: 20 * 60_000,
            env: {
              ...process.env,
              VERCEL_GIT_COMMIT_SHA: process.env.RELEASE_SOURCE_SHA,
            },
          }),
      });
      writeFileSync(
        "website-deployment.json",
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
    } else
      assert.equal(
        process.argv[2],
        "preflight",
        "Expected preflight or deploy",
      );
  } catch {
    console.error(
      "Website delivery failed: check production configuration, current ref, build and exact deployment identity.",
    );
    process.exitCode = 1;
  }
}
