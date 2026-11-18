// Fresh, read-only destination verification immediately before the selected write.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";
import { readGitHubJson } from "../ci/github-json.mjs";
const receipts = JSON.parse(
  readFileSync("scripts/release/impact-receipts.json"),
).targets;
async function json(url, token) {
  const response = await globalThis.fetch(url, {
    redirect: "error",
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: globalThis.AbortSignal.timeout(30000),
  });
  assert(
    response.ok,
    `Provider receipt returned ${response.status} at ${new globalThis.URL(url).hostname}`,
  );
  return response.json();
}
assertCurrentRef(workflowContext());
const env = process.env;
const service = receipts.service.identity;
assert.match(env.DIGITALOCEAN_APP_ID, /^[a-f0-9-]{36}$/);
assert(env.DIGITALOCEAN_ACCESS_TOKEN);
const { app } = await json(
  `https://api.digitalocean.com/v2/apps/${env.DIGITALOCEAN_APP_ID}`,
  env.DIGITALOCEAN_ACCESS_TOKEN,
);
assert.equal(app.id, env.DIGITALOCEAN_APP_ID);
assert.equal(app.active_deployment.id, service.deploymentId);
assert.equal(app.active_deployment.phase, "ACTIVE");
assert(!app.in_progress_deployment && !app.pending_deployment);
for (const [role, name] of [
  ["services", "api"],
  ["workers", "worker"],
]) {
  const entries = app.active_deployment.spec[role];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, name);
  assert.equal(entries[0].image.registry, "miniaxolotl");
  assert.equal(entries[0].image.repository, "grove");
  assert.equal(entries[0].image.digest, service.imageDigest);
}
const repo = "miniaxolotl/grove";
const download = receipts.downloads;
const release = readGitHubJson(
  `repos/${repo}/releases/tags/v${download.identity.version}`,
);
assert.equal(release.target_commitish, download.source);
assert.equal(release.draft, false);
for (const [name, digest] of Object.entries(download.identity.assets)) {
  const assets = release.assets.filter((a) => a.name === name);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].digest, digest);
}
for (const [target, { identity }] of Object.entries(receipts).filter(([name]) =>
  name.startsWith("npm:"),
)) {
  const pkg = "@miniaxolotl/" + target.slice(4);
  const current = await json(`https://registry.npmjs.org/${pkg}/latest`);
  assert.equal(current.name, pkg);
  assert.equal(current.version, identity.version);
  assert.equal(current.dist.integrity, identity.integrity);
}
const site = receipts.website;
const live = await json(
  `https://usegrove.cloud/release.json?baseline=${env.GITHUB_SHA}`,
);
const alreadyDelivered =
  live.sourceSha === env.RELEASE_SOURCE_SHA &&
  live.productionSha === env.GITHUB_SHA;
assert.deepEqual(
  live,
  alreadyDelivered
    ? {
        repository: repo,
        version: JSON.parse(readFileSync("package.json")).version,
        sourceSha: env.RELEASE_SOURCE_SHA,
        productionSha: env.GITHUB_SHA,
      }
    : {
        repository: repo,
        version: site.identity.version,
        sourceSha: site.source,
        productionSha: site.identity.productionSha,
      },
);
assert(env.VERCEL_TOKEN && env.VERCEL_ORG_ID && env.VERCEL_PROJECT_ID);
const deployment = await json(
  `https://api.vercel.com/v13/deployments/usegrove.cloud?teamId=${env.VERCEL_ORG_ID}`,
  env.VERCEL_TOKEN,
);
assert.match(deployment.id, /^dpl_[a-zA-Z0-9]+$/);
if (!alreadyDelivered) {
  assert.equal(deployment.id, site.identity.deploymentId);
  assert.equal(`https://${deployment.url}`, site.identity.deploymentUrl);
}
assert.equal(deployment.meta?.githubCommitSha, live.productionSha);
assert.equal(deployment.meta?.releaseSourceSha, live.sourceSha);
assert.equal(deployment.projectId, env.VERCEL_PROJECT_ID);
assert.equal(deployment.readyState, "READY");
assert.equal(deployment.target, "production");
assertCurrentRef(workflowContext());
if (alreadyDelivered)
  writeFileSync(
    "website-deployment.json",
    JSON.stringify({
      ...live,
      deploymentId: deployment.id,
      deploymentUrl: `https://${deployment.url}`,
    }),
  );
appendFileSync(env.GITHUB_OUTPUT, `alreadyDelivered=${alreadyDelivered}\n`);
