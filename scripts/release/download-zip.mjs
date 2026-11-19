import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";
import { readGitHubJson } from "../ci/github-json.mjs";
import { prepareAssets } from "./assets.mjs";
import { resolveBrowserVersions } from "./browser-versions.mjs";
import { admitPromotion, assertCi, verifyCi } from "./promotion.mjs";

export async function reconcile(wanted, { read, upload, guard }) {
  await guard();
  let existing = await read();
  if (existing == null) {
    await guard();
    let failure;
    try {
      await upload();
    } catch (e) {
      failure = e;
    }
    existing = await read();
    if (existing == null) throw failure ?? Error("Upload not confirmed");
  }
  assert.equal(
    existing,
    wanted,
    "Destination digest mismatch; never overwrite",
  );
  await guard();
}

const repo = "miniaxolotl/grove";
const tag = "v1.11.25";
const api = (path) => readGitHubJson(`repos/${repo}/${path}`);
const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const binary = (path, headers = []) =>
  execFileSync("gh", ["api", `repos/${repo}/${path}`, ...headers], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000,
  });
const releaseAsset = (id) =>
  binary(`releases/assets/${id}`, ["-H", "Accept: application/octet-stream"]);
const single = (list, match) => {
  const found = list.filter(match);
  assert.equal(found.length, 1, "Expected one matching GitHub object");
  return found[0];
};
const json = (path) => JSON.parse(readFileSync(path));

export function nextVersion(previous, storeFloor) {
  for (const version of [previous, storeFloor]) resolveBrowserVersions(version);
  const highest = [previous, storeFloor]
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .at(-1);
  const [major, minor, patch] = highest.split(".");
  const next = `${major}.${minor}.${Number(patch) + 1}`;
  resolveBrowserVersions(next);
  return next;
}

export function approvedVersion(previous, store, digest) {
  const next = nextVersion(previous, store.previousFloor);
  assert.equal(store.version, next, "Competing store version");
  assert.equal(
    store.submittedDigest,
    digest,
    "Store submission is not the approved ZIP",
  );
  return next;
}

export function assertDeploy(deploy, production) {
  assert.ok(
    deploy.path === ".github/workflows/deploy.yml" &&
      deploy.head_repository.full_name === repo &&
      deploy.head_branch === "production" &&
      deploy.head_sha === production &&
      ["push", "workflow_dispatch"].includes(deploy.event) &&
      deploy.status === "completed" &&
      deploy.conclusion === "success",
  );
}

export function assertEvidence(pin, { deploy, artifact, tagSha }) {
  assertDeploy(deploy, pin.production);
  assert.ok(
    !artifact.expired &&
      artifact.id === pin.artifactId &&
      artifact.workflow_run.id === pin.sourceRun &&
      artifact.workflow_run.head_sha === pin.source,
  );
  assert.equal(tagSha, pin.source, "Release tag moved");
}

async function main() {
  const ctx = workflowContext(),
    browser = process.env.BROWSER_TARGET;
  assert.equal(ctx.repository, repo);
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(process.env.GITHUB_ACTOR, "miniaxolotl");
  assert.equal(process.env.GITHUB_TRIGGERING_ACTOR, "miniaxolotl");
  assert.equal(git("rev-parse", "HEAD"), ctx.sha);
  assertCurrentRef(ctx);
  assert.ok(
    ["edge", "firefox"].includes(browser),
    "Chrome reservation remains unconfirmed",
  );
  const pin = json("scripts/release/download-approval.json")[browser];
  assert.ok(pin, "No reviewed post-freeze approval for this ZIP");
  for (const id of [
    pin.promotionPr,
    pin.sourceRun,
    pin.deployRun,
    pin.artifactId,
  ])
    assert.ok(Number.isSafeInteger(id) && id > 0);
  for (const hash of [pin.source, pin.production])
    assert.match(hash, /^[a-f0-9]{40}$/);
  const policy = json("scripts/release/policy.json");
  const pr = api(`pulls/${pin.promotionPr}`);
  assert.ok(
    pr.merged_at &&
      pr.base.repo.full_name === repo &&
      pr.base.ref === "production" &&
      pr.merge_commit_sha === pin.production,
  );
  git("merge-base", "--is-ancestor", pin.production, ctx.sha);
  const candidate = admitPromotion(policy, pr, pin.production);
  assert.equal(candidate.tag, tag);
  assert.equal(candidate.sha, pin.source);
  verifyCi(policy, pin.production);
  const deploy = api(`actions/runs/${pin.deployRun}`);
  const ci = api(`actions/runs/${pin.sourceRun}`);
  const jobs = api(
    `actions/runs/${ci.id}/attempts/${ci.run_attempt}/jobs?per_page=100`,
  );
  assert.equal(jobs.total_count, jobs.jobs.length);
  assert.equal(ci.head_branch, "development");
  // A rerun can retain an earlier attempt's artifact under the same name.
  assert.equal(ci.run_attempt, 1, "Ambiguous artifact attempt");
  assert.ok(
    assertCi(ci, jobs.jobs, {
      repository: repo,
      sha: pin.source,
      required: policy.ciJobs,
    }),
  );
  const artifacts = api(`actions/runs/${ci.id}/artifacts?per_page=100`);
  assert.equal(artifacts.total_count, artifacts.artifacts.length);
  const artifact = single(
    artifacts.artifacts,
    (a) => a.name === `grove-browser-extensions-${pin.source}`,
  );
  assert.ok(!artifact.expired && artifact.id === pin.artifactId);
  const outer = binary(`actions/artifacts/${artifact.id}/zip`);
  assert.equal(sha(outer), artifact.digest);
  assert.equal(artifact.digest, pin.containerDigest);
  const files = unzipSync(outer, {
    filter: (entry) => {
      assert.ok(entry.originalSize < 32 * 1024 * 1024);
      return true;
    },
  });
  assert.deepEqual(Object.keys(files).sort(), [
    "grove-chrome.zip",
    "grove-edge.zip",
    "grove-firefox.zip",
    "packages.build.json",
  ]);
  const browserVersions = JSON.parse(
    git("show", `${pin.source}:packages/browser-extension/package.json`),
  ).browserVersions;
  await prepareAssets({
    version: tag.slice(1),
    sourceSha: pin.source,
    files,
    browserVersions,
  });
  const report = single(
    JSON.parse(Buffer.from(files["packages.build.json"])),
    (r) => r.target === browser,
  );
  assert.deepEqual(report.config, {
    target: browser,
    apiOrigin: "https://api.grovenote.app",
    siteOrigin: "https://grovenote.app",
    issuer: "https://clerk.grovenote.app",
  });
  const name = `grove-${browser}.zip`,
    wanted = sha(files[name]);
  assert.equal(wanted, pin.zipDigest);
  const baseline = JSON.parse(
    git("show", `${pin.source}:scripts/release/impact-receipts.json`),
  ).targets.downloads;
  assert.equal(baseline.identity.version, "1.11.24");
  const prior = api("releases/tags/v1.11.24");
  assert.equal(prior.target_commitish, baseline.source);
  for (const [n, d] of Object.entries(baseline.identity.assets))
    assert.equal(single(prior.assets, (a) => a.name === n).digest, d);
  const priorReport = releaseAsset(
    single(prior.assets, (a) => a.name === "packages.build.json").id,
  );
  assert.equal(
    sha(priorReport),
    baseline.identity.assets["packages.build.json"],
  );
  const previous = single(JSON.parse(priorReport), (r) => r.target === browser);
  assert.equal(previous.sourceVersion, "1.11.24");
  assert.equal(
    report.sourceVersion,
    approvedVersion(previous.sourceVersion, pin.store, wanted),
  );
  assert.equal("sha256:" + previous.sha256, baseline.identity.assets[name]);
  assert.ok(
    [
      ...new Set([
        ...Object.keys(previous.files),
        ...Object.keys(report.files),
      ]),
    ].some(
      (k) => k !== "manifest.json" && previous.files[k] !== report.files[k],
    ),
    "No installer impact",
  );
  const release = api(`releases/tags/${tag}`);
  assert.equal(release.id, pin.releaseId);
  let receipt;
  const guard = () => {
    assertCurrentRef(ctx);
    const latestDeploy = api(
      `actions/workflows/deploy.yml/runs?branch=production&head_sha=${ctx.sha}&per_page=1`,
    ).workflow_runs[0];
    assertDeploy(latestDeploy, ctx.sha);
    const recent = api("releases?per_page=100");
    const last = recent.findIndex((r) => r.id === prior.id);
    assert.ok(last >= 0, "Cannot establish current download baseline");
    for (const newer of recent
      .slice(0, last)
      .filter((r) => r.id !== release.id)) {
      const assets = api(`releases/${newer.id}/assets?per_page=100`);
      assert.ok(
        assets.length < 100 && !assets.some((a) => a.name === name),
        "Newer browser release requires reconciliation",
      );
    }
    const live = api(`releases/tags/${tag}`);
    assert.ok(
      live.id === release.id &&
        live.tag_name === tag &&
        live.target_commitish === pin.source &&
        !live.draft &&
        !live.prerelease,
    );
    assertEvidence(pin, {
      deploy,
      artifact,
      tagSha: git(
        "ls-remote",
        "origin",
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      )
        .split("\n")
        .at(-1)
        .split("\t")[0],
    });
  };
  const read = () => {
    const assets = api(`releases/${release.id}/assets?per_page=100`);
    assert.ok(assets.length < 100, "Ambiguous release inventory");
    assert.ok(
      !assets.some((a) =>
        ["downloads.json", "packages.build.json", "SHA256SUMS"].includes(
          a.name,
        ),
      ),
      "Coordinated metadata requires reconciliation",
    );
    const found = assets.filter((a) => a.name === name);
    if (!found.length) return null;
    assert.equal(found.length, 1);
    assert.equal(found[0].state, "uploaded");
    const digest = sha(releaseAsset(found[0].id));
    assert.equal(found[0].digest, digest);
    receipt = {
      assetId: found[0].id,
      bytes: found[0].size,
      url: found[0].browser_download_url,
    };
    return digest;
  };
  await reconcile(wanted, {
    guard,
    read,
    upload: () =>
      execFileSync(
        "gh",
        [
          "api",
          "--method",
          "POST",
          `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${name}`,
          "-H",
          "Content-Type: application/zip",
          "--input",
          "-",
        ],
        { input: files[name], timeout: 120000 },
      ),
  });
  console.log(
    JSON.stringify({
      tag,
      browser,
      name,
      releaseId: release.id,
      browserVersion: report.sourceVersion,
      ...pin,
      ...receipt,
      verifiedDigest: wanted,
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
