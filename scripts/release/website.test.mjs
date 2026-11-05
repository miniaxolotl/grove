import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deployWebsite, preflightWebsite } from "./website.mjs";

const env = {
  VERCEL_TOKEN: "fixture",
  VERCEL_ORG_ID: "team_fixture",
  VERCEL_PROJECT_ID: "prj_fixture",
  RELEASE_SOURCE_SHA: "a".repeat(40),
  GITHUB_SHA: "b".repeat(40),
};
const project = {
  id: env.VERCEL_PROJECT_ID,
  accountId: env.VERCEL_ORG_ID,
  rootDirectory: "packages/website",
  commandForIgnoringBuildStep: "exit 0",
};
const keys = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "GROVE_API_URL",
  "SITE_URL",
];
const response = (body) => ({ ok: true, json: async () => body });

test("website preflight rejects missing credentials, wrong project and missing production settings", async () => {
  for (const key of ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"])
    await assert.rejects(
      preflightWebsite({ ...env, [key]: "" }, async () => {
        throw new Error("must not fetch");
      }),
      /required/,
    );
  const fetch = async (url) =>
    response(
      url.includes("/env?")
        ? { envs: keys.map((key) => ({ key, target: ["production"] })) }
        : project,
    );
  await preflightWebsite(env, fetch);
  for (const change of [
    { id: "prj_other" },
    { accountId: "team_other" },
    { rootDirectory: "packages/old" },
    { commandForIgnoringBuildStep: null },
  ])
    await assert.rejects(
      preflightWebsite(env, async () => response({ ...project, ...change })),
    );
  await assert.rejects(
    preflightWebsite(env, async (url) =>
      response(url.includes("/env?") ? { envs: [] } : project),
    ),
    /production configuration/,
  );
});

test("website publishes only after build and current-ref checks, then verifies exact deployment and live identity", async () => {
  const calls = [];
  let identity;
  const run = (args) => {
    assert.ok(
      !args.includes("--scope"),
      "project-scoped tokens must use the explicit project/team environment, not CLI user scope resolution",
    );
    assert.ok(!args.includes("--token"), "credentials stay in the environment");
    assert.ok(!args.includes(env.VERCEL_TOKEN));
    calls.push(args[0]);
    if (args[0] === "deploy") return "https://fixture.vercel.app\n";
  };
  const fetch = async (url) => {
    calls.push(url.includes("api.vercel.com") ? "inspect" : "live");
    return response(
      url.includes("api.vercel.com")
        ? {
            projectId: env.VERCEL_PROJECT_ID,
            readyState: "READY",
            target: "production",
            meta: {
              releaseSourceSha: env.RELEASE_SOURCE_SHA,
              githubCommitSha: env.GITHUB_SHA,
            },
          }
        : identity,
    );
  };
  const dependencies = {
    run,
    fetch,
    assertCurrent: () => calls.push("current"),
    writeIdentity: (value) => {
      identity = value;
      calls.push("identity");
    },
    version: "1.2.3",
  };
  await deployWebsite(env, dependencies);
  assert.deepEqual(calls, [
    "current",
    "pull",
    "identity",
    "build",
    "current",
    "deploy",
    "inspect",
    "live",
    "live",
    "current",
  ]);
  assert.equal(identity.sourceSha, env.RELEASE_SOURCE_SHA);
  assert.equal(identity.productionSha, env.GITHUB_SHA);
  calls.length = 0;
  await assert.rejects(
    deployWebsite(env, {
      ...dependencies,
      run: (args) => {
        calls.push(args[0]);
        if (args[0] === "build") throw new Error("build failed");
      },
    }),
    /build failed/,
  );
  assert.ok(!calls.includes("deploy"));
  await assert.rejects(
    deployWebsite(env, {
      ...dependencies,
      fetch: async () =>
        response({
          projectId: env.VERCEL_PROJECT_ID,
          target: "production",
          readyState: "READY",
          meta: {
            releaseSourceSha: "c".repeat(40),
            githubCommitSha: env.GITHUB_SHA,
          },
        }),
    }),
    /source/,
  );
  await assert.rejects(
    deployWebsite(env, {
      ...dependencies,
      assertCurrent: () => {
        throw new Error("superseded");
      },
    }),
    /superseded/,
  );
});

test("website job requires successful backend deployment and preflight precedes publication", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /website:\n\s+needs: \[candidate, deploy\]/);
  const website = workflow.split("\n  website:\n")[1];
  assert.doesNotMatch(website, /always\(\)|continue-on-error/);
  assert.match(website, /ref: \$\{\{ needs.candidate.outputs.sha \}\}/);
  assert.ok(
    workflow.indexOf("node scripts/release/website.mjs preflight") <
      workflow.indexOf("name: Publish all coordinated npm artifacts"),
  );
});
