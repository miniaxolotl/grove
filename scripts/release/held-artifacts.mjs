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
import { pendingPublication } from "./held-delivery.mjs";
const repo = "miniaxolotl/grove";
const v36Tooling = Object.freeze({source:'a55f9e89df2131fdc993fc41bdbe648c8ec8e9d2',production:'e1a7baf8eae1e2874f963416f3d01336db745d06',tree:'345abbcbc6f079ee2fbcbd6096434b3e485b25c1',tag:'v1.11.36',workflow:'.github/workflows/held-release-operator.yml'});
// This one repaired recorder retains only the already authenticated, frozen v36
// ancestry of the original v34 publication. No floating/future-tooling fallback.
export function heldReceiptContext(run, phase, context) {
  if(context.source==='4cd44cc891fbb4013b4465bde1eced4ebaedbee0' &&
    context.production==='51048850e1895635febf142996390c7c893f8e89' &&
    context.tooling?.tag==='v1.11.37' && context.tooling.workflow===v36Tooling.workflow &&
    ['held_verified','lifecycle_verified','effects_approved'].includes(phase) &&
    run.path===v36Tooling.workflow && run.head_sha===v36Tooling.production)
    return {...context,tooling:v36Tooling};
  return context;
}
export function assertHeldWorkflowRun(run,{runId,attempt,published,context}) {
  const operational=!published && run.path==='.github/workflows/held-release-operator.yml';
  assert(run.id===runId && run.run_attempt===attempt && run.head_branch==='production');
  if(operational){
    assert(context.tooling);
    assert.equal(context.tooling.workflow,run.path);
    assert.equal(run.head_sha,context.tooling.production);
  }else{
    assert.equal(run.head_sha,context.production);
    assert.equal(run.path,published?'.github/workflows/deploy.yml':'.github/workflows/held-release.yml');
  }
  return operational;
}
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
export const loadPublication = (
  run,
  attempt,
  context,
  io = defaults,
  now = Date.now(),
) => loadHeldReceipt(run, attempt, "published_held", context, io, now);
export async function loadReceipt(
  { run, attempt, phase, publication },
  context,
  io = defaults,
  now = Date.now(),
) {
  const receipt = await loadHeldReceipt(run, attempt, phase, context, io, now);
  let root = receipt;
  while (root.parent) root = root.parent;
  assert.equal(
    receiptHash(root),
    receiptHash(publication),
    "Different publication custody",
  );
  return receipt;
}
async function artifactJson(artifact, runId, filename, io, now) {
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
  assert.deepEqual(Object.keys(files), [filename]);
  return JSON.parse(strFromU8(files[filename]));
}
export async function loadPendingPublication(
  runId,
  attempt,
  context,
  decision,
  io = defaults,
  now = Date.now(),
  depth = 0,
) {
  try {
    assert(depth < 8);
    for (const value of [runId, attempt])
      assert(Number.isSafeInteger(value) && value > 0);
    const run = await io.run(runId, attempt);
    assert(
      run.id === runId &&
        run.run_attempt === attempt &&
        run.head_sha === context.production &&
        run.head_branch === "production" &&
        run.path === ".github/workflows/deploy.yml" &&
        ["push", "workflow_dispatch"].includes(run.event) &&
        run.status === "completed" &&
        run.actor?.login === "miniaxolotl" &&
        run.triggering_actor?.login === "miniaxolotl" &&
        run.head_repository?.full_name === repo,
    );
    const jobs = await io.jobs(runId, attempt);
    for (const name of ["candidate", "publish"]) {
      const matching = jobs.filter((job) => job.name === name);
      assert.equal(matching.length, 1);
      const job = matching[0];
      assert(
        job.run_id === runId &&
          job.run_attempt === attempt &&
          job.head_sha === context.production &&
          job.status === "completed",
      );
      if (name === "candidate") assert.equal(job.conclusion, "success");
      else
        assert(
          job.steps?.some(
            (step) =>
              step.name === "Preserve pending source-bound publication" &&
              step.status === "completed" &&
              step.conclusion === "success",
          ),
        );
    }
    const matches = (await io.artifacts(runId)).filter(
      (artifact) => artifact.name === `held-pending-${attempt}`,
    );
    assert.equal(matches.length, 1);
    const pending = await artifactJson(
      matches[0],
      runId,
      "held-pending.json",
      io,
      now,
    );
    assert.deepEqual(
      pending,
      pendingPublication(
        { ...context, run: runId, attempt, pendingParent: pending.previous },
        decision,
        pending.baseline,
        Date.parse(pending.at),
      ),
    );
    if (pending.previous) {
      const prior = pending.previous;
      assert(prior.run !== runId || prior.attempt < attempt);
      const previous = await loadPendingPublication(
        prior.run,
        prior.attempt,
        context,
        decision,
        io,
        now,
        depth + 1,
      );
      assert.equal(receiptHash(previous), prior.hash);
      assert.deepEqual(previous.baseline, pending.baseline);
    }
    return pending;
  } catch {
    throw new Error(
      "Held pending receipt unavailable or untrusted; retain hold and requalify read-only",
    );
  }
}
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
    assert(depth < 8);
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
        "lifecycle_verified",
        "effects_approved",
        "runtime_verified",
        "public_verified",
        "website_verified",
      ].includes(phase),
    );
    const run = await io.run(runId, attempt);
    context=heldReceiptContext(run,phase,context);
    const operational=assertHeldWorkflowRun(run,{runId,attempt,published,context});
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
    for (const name of published
      ? ["candidate", "publish"]
      : ["candidate", "record"]) {
      const matching = jobs.filter((job) => job.name === name);
      assert(
        matching.length === 1 &&
          matching[0].run_id === runId &&
          matching[0].run_attempt === attempt &&
          matching[0].head_sha === (operational?context.tooling.production:context.production) &&
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
    const receipt = await artifactJson(
      artifact,
      runId,
      "held-state.json",
      io,
      now,
    );
    assert.equal(receipt.phase, phase);
    if(operational)assert.deepEqual(receipt.operator?.tooling,context.tooling);
    else assert.equal(receipt.operator?.tooling,undefined);
    assert(
      receipt.operator?.run === runId &&
        receipt.operator.attempt === attempt &&
        receipt.operator.actor === "miniaxolotl",
    );
    if (published) {
      if (context.heldDecision) {
        assert.equal(
          receipt.evidence.decisionHash,
          receiptHash(context.heldDecision),
        );
        const pending = await loadPendingPublication(
          runId,
          attempt,
          context,
          context.heldDecision,
          io,
          now,
        );
        assert.equal(receipt.evidence.pendingHash, receiptHash(pending));
      }
      return admitPublication(receipt, artifact, context, now);
    }
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
