// Protected publication-only producer. It never changes provider state or runs
// an owner migration. All release effects require the separate phase controller.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  resolveHeldDecision,
  pendingPublication,
  completePublication,
} from "./held-delivery.mjs";
import { receiptHash } from "./held-state.mjs";
import { capturePublicationBaseline } from "./held-provider.mjs";
import { validateCompleteInstanceInventory } from "./held-instance-inventory.mjs";
import {
  appStateFingerprint,
  readProviderResponse,
} from "../deploy-digitalocean.mjs";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";
import { readGitHubJson } from "../ci/github-json.mjs";
import { loadPendingPublication } from "./held-artifacts.mjs";

const exec = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 262144,
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const git = (...args) => exec("git", args);
export async function publicationReadback(decision, read) {
  const app = await read(`/v2/apps/${decision.app}`),
    first = app.app;
  const instances = validateCompleteInstanceInventory(
    await read(`/v2/apps/${decision.app}/instances`),
  );
  const baseline = capturePublicationBaseline(
    first,
    instances,
    decision,
  );
  const after = (await read(`/v2/apps/${decision.app}`)).app;
  assert.equal(
    appStateFingerprint(first),
    appStateFingerprint(after),
    "Publication provider generation drift",
  );
  assert.deepEqual(
    validateCompleteInstanceInventory(
      await read(`/v2/apps/${decision.app}/instances`),
    ),
    instances,
    "Publication instance inventory drift",
  );
  return baseline;
}
async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  const source = process.env.RELEASE_SOURCE_SHA;
  assert.equal(git("rev-parse", "HEAD"), source);
  const selected = resolveHeldDecision(source, true);
  assert(selected, "An exact owner-selected held declaration is required");
  const decision = selected.manifest;
  assert.equal(process.env.DIGITALOCEAN_APP_ID, decision.app);
  const root = JSON.parse(git("show", `${source}:package.json`)),
    api = JSON.parse(git("show", `${source}:packages/api/package.json`));
  const context = {
    repository: process.env.GITHUB_REPOSITORY,
    actor: process.env.GITHUB_ACTOR,
    protected: process.env.GITHUB_REF_PROTECTED === "true",
    source,
    production: process.env.GITHUB_SHA,
    tree: git("rev-parse", `${source}^{tree}`),
    tag: process.env.RELEASE_TAG,
    apiVersion: api.version,
    run: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  };
  assert.equal(context.tag, `v${root.version}`);
  const current = () => assertCurrentRef(workflowContext());
  current();
  const read = async (path) => {
    const token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
    assert(token);
    const response = await globalThis.fetch(
      `https://api.digitalocean.com${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(30000),
      },
    );
    return readProviderResponse(response, "GET", path);
  };
  const baseline = await publicationReadback(decision, read);
  const parentRun = process.env.GROVE_HELD_PENDING_RUN,
    parentAttempt = process.env.GROVE_HELD_PENDING_ATTEMPT;
  assert(
    Boolean(parentRun) === Boolean(parentAttempt),
    "Both pending coordinates are required",
  );
  const ancestors = new Set();
  if (parentRun) {
    let run = Number(parentRun),
      attempt = Number(parentAttempt),
      count = 0;
    while (true) {
      assert(count++ < 8);
      const prior = await loadPendingPublication(
        run,
        attempt,
        context,
        decision,
      );
      assert.deepEqual(
        prior.baseline,
        baseline,
        "A pending resume cannot replace original provider custody",
      );
      const hash = receiptHash(prior);
      ancestors.add(`${run}:${attempt}`);
      if (count === 1) context.pendingParent = { run, attempt, hash };
      if (!prior.previous) break;
      run = prior.previous.run;
      attempt = prior.previous.attempt;
    }
  }
  const action = process.argv[2];
  if (action === "pending") {
    // Retries cannot silently replace custody for a prior uncertain attempt.
    const previous = readGitHubJson(
      `repos/${context.repository}/actions/workflows/deploy.yml/runs?branch=production&head_sha=${context.production}&per_page=100`,
    );
    assert(
      previous.total_count <= 8,
      "Publication history requires bounded requalification",
    );
    for (const run of previous.workflow_runs) {
      if (run.id !== context.run)
        assert.equal(
          run.status,
          "completed",
          "Wait for the prior publication run; do not cancel/race it",
        );
      const artifacts = readGitHubJson(
        `repos/${context.repository}/actions/runs/${run.id}/artifacts?per_page=100`,
      );
      assert(
        artifacts.total_count <= 100,
        "Publication inventory requires bounded requalification",
      );
      for (const item of artifacts.artifacts) {
        const match = item.name.match(/^held-pending-(\d+)$/);
        if (!match) continue;
        assert(
          ancestors.has(`${run.id}:${Number(match[1])}`),
          "Prior publication custody requires an explicit verified resume chain",
        );
      }
    }
    const pending = pendingPublication(context, decision, baseline);
    writeFileSync("held-pending.json", JSON.stringify(pending));
  } else if (action === "complete") {
    const pending = JSON.parse(readFileSync("held-pending.json", "utf8"));
    assert.equal(pending.schemaGate, "required_before_restore");
    assert.deepEqual(
      pending.baseline,
      baseline,
      "Publication baseline changed; keep all effects held",
    );
    const digest = process.env.GROVE_IMAGE_DIGEST;
    const receipt = await completePublication(
      pending,
      context,
      decision,
      digest,
      async () => {
        current();
        const packages = JSON.parse(
          exec(process.execPath, ["scripts/publish.mjs", "--verify-only"]),
        );
        const image = `ghcr.io/miniaxolotl/grove@${digest}`;
        const images = [];
        for (const repository of [
          "ghcr.io/miniaxolotl/grove",
          "miniaxolotl/grove",
        ])
          for (const tag of [`sha-${source}`, context.tag]) {
            const actual = exec("docker", [
              "buildx",
              "imagetools",
              "inspect",
              `${repository}:${tag}`,
              "--format",
              "{{.Manifest.Digest}}",
            ]);
            assert.equal(actual, digest);
            images.push({ repository, tag, digest: actual });
          }
        const metadata = JSON.parse(
          exec("docker", [
            "run",
            "--rm",
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--entrypoint=node",
            image,
            "--input-type=module",
            "-e",
            "import{readFileSync}from'node:fs';console.log(readFileSync('/app/dist/telemetry-build.json','utf8'))",
          ]),
        );
        assert.equal(metadata.revision, source);
        assert.equal(metadata.productVersion, root.version);
        assert.equal(metadata.version, api.version);
        assert.equal(metadata.holdRequired, true);
        for (const entry of ["server", "worker"]) {
          let rejected = false;
          try {
            exec("docker", [
              "run",
              "--rm",
              "--network=none",
              "--read-only",
              "--cap-drop=ALL",
              "--entrypoint=node",
              image,
              `dist/${entry}.js`,
            ]);
          } catch (error) {
            rejected =
              error.status !== 0 &&
              /held release configuration/i.test(String(error.stderr));
          }
          assert(
            rejected,
            "Published image does not fail closed before runtime effects",
          );
        }
        current();
        return {
          packages: receiptHash(packages),
          images: receiptHash({ images, metadata }),
        };
      },
    );
    writeFileSync("held-state.json", JSON.stringify(receipt));
  } else
    throw new Error(
      "Choose pending or complete; this producer cannot release effects",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    process.stderr.write(
      "Held publication remains pending/unqualified; retain release hold and reconcile source-bound evidence\n",
    );
    process.exitCode = 1;
  }
}
