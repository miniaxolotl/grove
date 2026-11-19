// Opt-in hosted-only decisions. This file has no publishing or deployment effects.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { plan } from "./impact-plan.mjs";
import { successfulReceipt } from "./impact-identity.mjs";
import { assertManifestVersion } from "./release-intent.mjs";
import { readGitHubJson } from "../ci/github-json.mjs";

export const decisionPath = "scripts/release/decision.json";
const repo = "miniaxolotl/grove",
  sha = /^[a-f0-9]{40}$/;
const inventory = [
  "website",
  "service",
  "downloads",
  ...[
    "grove",
    "grove-server",
    "grove-claude-plugin",
    "grove-codex-plugin",
    "grove-opencode-plugin",
  ].map((n) => `npm:${n}`),
].sort();
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const read = (ref, path) => JSON.parse(git("show", `${ref}:${path}`));
const io = {
  git,
  read,
  pulls: (ref) =>
    readGitHubJson(`repos/${repo}/commits/${ref}/pulls?per_page=100`),
  predecessor: (p) => ({
    release: readGitHubJson(`repos/${repo}/releases/tags/${p.tag}`),
    sourcePr: readGitHubJson(
      `repos/${repo}/commits/${p.source}/pulls?per_page=100`,
    ).find(
      (pr) =>
        pr.merge_commit_sha === p.source && pr.base?.ref === "development",
    ),
    productionPr: readGitHubJson(
      `repos/${repo}/commits/${p.production}/pulls?per_page=100`,
    ).find(
      (pr) =>
        pr.merge_commit_sha === p.production && pr.base?.ref === "production",
    ),
  }),
};
const keys = (value, expected) =>
  assert.deepEqual(
    Object.keys(value).sort(),
    expected.toSorted(),
    "Unknown or missing decision fields",
  );
export const decisionHash = (d) =>
  createHash("sha256").update(JSON.stringify(d)).digest("hex");

export function assertPredecessor(p, evidence) {
  const { release, sourcePr, productionPr } = evidence;
  assert(
    release?.tag_name === p.tag && release.draft === false,
    "Predecessor source release is not published",
  );
  for (const [pr, branch, commit] of [
    [sourcePr, "development", p.source],
    [productionPr, "production", p.production],
  ]) {
    assert(
      pr?.merged_at &&
        pr.merge_commit_sha === commit &&
        pr.base?.ref === branch &&
        pr.base.repo?.full_name === repo &&
        pr.head?.repo?.full_name === repo,
      "Predecessor promotion provenance mismatch",
    );
  }
  assert(
    sourcePr.labels?.some((l) => /^autorelease:\s*tagged$/.test(l.name)),
    "Predecessor Release Please provenance missing",
  );
  assert.equal(
    productionPr.head.ref,
    `promote/production/${p.tag}`,
    "Predecessor production promoted a different source tag",
  );
}

export function validateDecision(d, source, released = false, api = io) {
  keys(d, [
    "schema",
    "candidate",
    "predecessor",
    "deliver",
    "publish",
    "topology",
    "receipts",
    "reviewedInputs",
  ]);
  assert.equal(d.schema, 1);
  assert.match(source, sha);
  assert.match(d.candidate, sha);
  keys(d.predecessor, ["tag", "source", "production"]);
  assert.match(d.predecessor.tag, /^v\d+\.\d+\.\d+$/);
  for (const ref of [d.predecessor.source, d.predecessor.production])
    assert.match(ref, sha);
  assert.equal(
    d.topology,
    "existing",
    "Selected delivery cannot authorize checker/topology changes",
  );
  assert.deepEqual(
    d.publish,
    [],
    "Selected npm/download publication is not enabled",
  );
  assert(
    Array.isArray(d.deliver) && d.deliver.length > 0 && d.deliver.length <= 2,
  );
  assert.deepEqual(d.deliver, [...new Set(d.deliver)].sort());
  assert(d.deliver.every((n) => ["service", "website"].includes(n)));
  assert.deepEqual(Object.keys(d.receipts).sort(), inventory);
  for (const [name, receipt] of Object.entries(d.receipts)) {
    keys(receipt, ["source", "identity", "evidence"]);
    assert.match(receipt.source, sha);
    assert(
      successfulReceipt(name, receipt.identity, receipt.evidence),
      `Incomplete receipt: ${name}`,
    );
    api.git("merge-base", "--is-ancestor", receipt.source, d.candidate);
  }
  assert.equal(
    api.git("rev-parse", `refs/tags/${d.predecessor.tag}^{commit}`),
    d.predecessor.source,
    "Predecessor tag drift",
  );
  api.git("merge-base", "--is-ancestor", d.predecessor.source, d.candidate);
  const predecessor = api.predecessor(d.predecessor);
  assertPredecessor(d.predecessor, predecessor);
  const tree = api.git("rev-parse", `${d.predecessor.source}^{tree}`);
  assert.equal(
    api.git("rev-parse", `${d.predecessor.production}^{tree}`),
    tree,
    "Predecessor production/source trees differ",
  );
  assert.equal(
    api.git("rev-parse", `${predecessor.productionPr.head.sha}^{tree}`),
    tree,
    "Predecessor frozen tree drift",
  );
  api.git(
    "merge-base",
    "--is-ancestor",
    d.predecessor.source,
    predecessor.productionPr.head.sha,
  );
  const before = api.read(d.candidate, "package.json");
  assert.equal(before.private, true);
  assert.equal(
    before.version,
    d.predecessor.tag.slice(1),
    "Predecessor version mismatch",
  );
  const parent = api.git("rev-parse", `${source}^1`);
  const declaration = parent === d.candidate ? source : parent;
  assert.equal(
    api.git("rev-parse", `${declaration}^1`),
    d.candidate,
    "Stale or inherited release decision",
  );
  assert.equal(
    api.git("diff", "--name-only", "--no-renames", d.candidate, declaration),
    decisionPath,
    "Decision PR must change only its manifest",
  );
  assert.deepEqual(
    api.read(declaration, decisionPath),
    d,
    "Decision drift in release stamp",
  );
  const prs = api.pulls(declaration);
  assert(
    prs.some(
      (pr) =>
        pr.merged_at &&
        pr.merge_commit_sha === declaration &&
        pr.user?.login === "miniaxolotl" &&
        pr.base?.ref === "development" &&
        pr.base.repo?.full_name === repo &&
        pr.head?.repo?.full_name === repo,
    ),
    "An owner-authored merged development decision PR is required",
  );
  if (source === declaration) {
    assert(!released, "A source decision is not a published release");
  } else {
    const after = api.read(source, "package.json");
    assertManifestVersion(before.version, after.version, null);
    assert.deepEqual(after, { ...before, version: after.version });
    assert.deepEqual(api.read(source, ".release-please-manifest.json"), {
      ".": after.version,
    });
    const changed = api
      .git("diff", "--name-only", "--no-renames", declaration, source)
      .split("\n")
      .sort();
    assert.deepEqual(
      changed,
      [".release-please-manifest.json", "CHANGELOG.md", "package.json"],
      "Selected stamp must preserve every installer/pin and decision byte",
    );
  }
  return { manifest: d, declaration, source, hash: decisionHash(d) };
}

export function resolveDecision(source, released = false, api = io) {
  assert.match(source ?? "", sha);
  if (!api.git("ls-tree", source, "--", decisionPath)) return null;
  return validateDecision(
    api.read(source, decisionPath),
    source,
    released,
    api,
  );
}

export function selectDecision(d, candidate, snapshots) {
  assert.equal(candidate.source, d.candidate);
  const baselines = globalThis.structuredClone(snapshots);
  assert(
    Object.keys(d.reviewedInputs).every((ref) =>
      baselines.some((s) => s.source === ref),
    ),
    "Unknown review baseline",
  );
  for (const baseline of baselines) {
    for (const [path, pair] of Object.entries(
      d.reviewedInputs[baseline.source] ?? {},
    )) {
      assert(
        ![
          "browserVersions",
          ".agents/plugins/marketplace.json",
          ".claude-plugin/marketplace.json",
        ].includes(path),
        "Installer pins cannot be overridden by reviewed inputs",
      );
      assert(Array.isArray(pair) && pair.length === 2);
      assert.deepEqual(
        baseline.watch[path] ?? null,
        pair[0],
        `Unexpected baseline: ${path}`,
      );
      assert.deepEqual(
        candidate.watch[path] ?? null,
        pair[1],
        `Unreviewed input: ${path}`,
      );
      if (pair[1] === null) delete baseline.watch[path];
      else baseline.watch[path] = pair[1];
    }
  }
  const report = plan(candidate, baselines, d.receipts);
  assert.deepEqual(Object.keys(report.targets).sort(), inventory);
  for (const [name, item] of Object.entries(report.targets)) {
    assert(!item.unresolved?.length, `Unreviewed inputs for ${name}`);
    assert.equal(
      item.state,
      d.deliver.includes(name) ? "selected" : "unchanged",
      `Decision does not cover changed ${name}`,
    );
    if (!d.deliver.includes(name))
      assert.deepEqual(item.proposedIdentity, d.receipts[name].identity);
  }
  return { deliver: d.deliver, publish: [], topology: d.topology, report };
}

export async function verifyDecision(source, released = false) {
  const result = resolveDecision(source, released);
  assert(result, "Missing selected decision");
  const { snapshot } = await import("./impact-snapshot.mjs");
  return withComparisonEnvironment(async () => {
    const d = result.manifest,
      baselines = [];
    for (const ref of new Set(Object.values(d.receipts).map((r) => r.source)))
      baselines.push(await snapshot(ref));
    return {
      ...result,
      ...selectDecision(d, await snapshot(d.candidate), baselines),
    };
  });
}

// Provenance reads finish before executing any reviewed revision's build code.
// This is not a filesystem sandbox; use only the unprivileged comparison job.
export async function withComparisonEnvironment(run) {
  const saved = { ...process.env };
  const keep = new Set([
    "PATH",
    "HOME",
    "PNPM_HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "NODE_DISABLE_COMPILE_CACHE",
    "npm_config_store_dir",
    "NPM_CONFIG_STORE_DIR",
  ]);
  try {
    for (const key of Object.keys(process.env))
      if (!keep.has(key)) delete process.env[key];
    return await run();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, source, phase] = process.argv.slice(2);
  assert(["prepare", "verify"].includes(command));
  const result =
    command === "verify"
      ? await verifyDecision(source, phase === "released")
      : resolveDecision(source, phase === "released");
  assert(result, "Missing selected decision");
  if (process.env.RELEASE_DECISION_HASH)
    assert.equal(
      result.hash,
      process.env.RELEASE_DECISION_HASH,
      "Admitted decision hash drift",
    );
  writeFileSync(
    "selected-receipts.json",
    JSON.stringify({ targets: result.manifest.receipts }, null, 2),
  );
  writeFileSync("selected-decision.json", JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `decision=${result.hash}\n`);
}
