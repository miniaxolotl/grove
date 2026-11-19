// Bounded trusted-workflow receipt reader. A missing/expired artifact is a hold,
// never permission to invent receipt contents or re-run a provider effect.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { readGitHubJson } from "../ci/github-json.mjs";
import {
  admitPublication,
  validateHeldReceipt,
  receiptHash,
} from "./held-state.mjs";
const repo = "miniaxolotl/grove";
function pages(endpoint, key) {
  const result = [];
  for (let page = 1; page <= 5; page++) {
    const batch = readGitHubJson(`${endpoint}?per_page=100&page=${page}`)[key];
    assert(Array.isArray(batch));
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error("Receipt inventory too large");
}
const defaults = {
  run: (id, attempt) =>
    readGitHubJson(`repos/${repo}/actions/runs/${id}/attempts/${attempt}`),
  artifacts: (id) =>
    pages(`repos/${repo}/actions/runs/${id}/artifacts`, "artifacts"),
  jobs: (id, attempt) =>
    pages(`repos/${repo}/actions/runs/${id}/attempts/${attempt}/jobs`, "jobs"),
  download: (id) =>
    execFileSync("gh", ["api", `repos/${repo}/actions/artifacts/${id}/zip`], {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 262144,
      timeout: 30000,
    }),
};
export async function loadHeldReceipt(
  runId,
  attempt,
  phase,
  context,
  io = defaults,
  now = Date.now(),
  depth = 0,
) {
  try {
    assert(depth < 6);
    assert(
      Number.isSafeInteger(runId) &&
        runId > 0 &&
        Number.isSafeInteger(attempt) &&
        attempt > 0,
    );
    const published = phase === "published_held";
    assert(
      [
        "published_held",
        "held_verified",
        "effects_approved",
        "runtime_verified",
        "public_verified",
        "website_verified",
      ].includes(phase),
    );
    const run = await io.run(runId, attempt);
    assert(
      run.id === runId &&
        run.run_attempt === attempt &&
        run.head_sha === context.production &&
        run.head_branch === "production",
    );
    assert.equal(
      run.path,
      published
        ? ".github/workflows/deploy.yml"
        : ".github/workflows/held-release.yml",
    );
    assert(
      ["push", "workflow_dispatch"].includes(run.event) &&
        (!published ? run.event === "workflow_dispatch" : true),
    );
    assert(run.status === "completed" && run.conclusion === "success");
    assert(
      run.actor?.login === "miniaxolotl" &&
        run.triggering_actor?.login === "miniaxolotl" &&
        run.head_repository?.full_name === repo,
    );
    const jobs = await io.jobs(runId, attempt);
    for (const name of published ? ["candidate", "publish"] : ["record"]) {
      const matching = jobs.filter((job) => job.name === name);
      assert(
        matching.length === 1 &&
          matching[0].run_id === runId &&
          matching[0].run_attempt === attempt &&
          matching[0].head_sha === context.production &&
          matching[0].status === "completed" &&
          matching[0].conclusion === "success",
      );
    }
    const matches = (await io.artifacts(runId)).filter(
      (artifact) =>
        artifact.name ===
        (published
          ? `held-publication-${attempt}`
          : `held-${phase}-${attempt}`),
    );
    assert.equal(matches.length, 1);
    const artifact = matches[0];
    assert(
      artifact.expired === false &&
        Date.parse(artifact.expires_at) > now &&
        artifact.workflow_run?.id === runId,
    );
    assert(artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 131072);
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
    const zip = await io.download(artifact.id);
    assert(zip.length <= 131072);
    assert.equal(
      `sha256:${createHash("sha256").update(zip).digest("hex")}`,
      artifact.digest,
    );
    const files = unzipSync(zip, {
      filter: (entry) => {
        assert(entry.originalSize <= 65536);
        return true;
      },
    });
    assert.deepEqual(Object.keys(files), ["held-state.json"]);
    const receipt = JSON.parse(strFromU8(files["held-state.json"]));
    assert.equal(receipt.phase, phase);
    assert(
      receipt.operator?.run === runId &&
        receipt.operator.attempt === attempt &&
        receipt.operator.actor === "miniaxolotl",
    );
    if (published) return admitPublication(receipt, artifact, context, now);
    const parent = receipt.parent;
    const loaded = await loadHeldReceipt(
      parent.operator.run,
      parent.operator.attempt,
      parent.phase,
      context,
      io,
      now,
      depth + 1,
    );
    assert.equal(receiptHash(loaded), receipt.previous);
    let p = loaded;
    while (p.parent) p = p.parent;
    return validateHeldReceipt(receipt, p);
  } catch {
    throw new Error(
      "Held release receipt unavailable or untrusted; retain release hold and requalify read-only",
    );
  }
}
