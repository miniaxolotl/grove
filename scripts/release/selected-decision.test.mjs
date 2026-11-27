import assert from "node:assert/strict";
import test from "node:test";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import process from "node:process";
import {
  validateDecision,
  selectDecision,
  decisionHash,
  assertPredecessor,
  withComparisonEnvironment,
} from "./selected-decision.mjs";
import { selectedServiceReadback } from "./selected-retry.mjs";
import { deploySelected } from "./selected-deploy.mjs";

const candidate = "a".repeat(40),
  declaration = "b".repeat(40),
  stamp = "c".repeat(40);
test("comparison builds cannot inherit provenance credentials and restore tooling state after failure", async () => {
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "fixture-private";
  try {
    await assert.rejects(
      withComparisonEnvironment(async () => {
        assert.equal(process.env.GH_TOKEN, undefined);
        assert(process.env.PATH);
        throw new Error("fixture build failure");
      }),
      /fixture build failure/,
    );
    assert.equal(process.env.GH_TOKEN, "fixture-private");
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
  }
});
function fixture() {
  const receipts = JSON.parse(
    readFileSync("scripts/release/impact-receipts.json"),
  ).targets;
  const d = {
    schema: 1,
    candidate,
    predecessor: {
      tag: "v4.7.8",
      source: "d".repeat(40),
      production: "e".repeat(40),
    },
    deliver: ["service", "website"],
    publish: [],
    topology: "existing",
    receipts,
    reviewedInputs: {},
  };
  const root = { private: true, version: "4.7.8" };
  const io = {
    git: (cmd, ...args) => {
      if (cmd === "merge-base") return "";
      if (cmd === "diff")
        return args.includes(declaration) && !args.includes(stamp)
          ? "scripts/release/decision.json"
          : "CHANGELOG.md\npackage.json\n.release-please-manifest.json";
      const ref = args.at(-1);
      if (ref.endsWith("^{tree}")) return "1".repeat(40);
      if (ref === `${declaration}^1`) return candidate;
      if (ref === `${stamp}^1`) return declaration;
      if (ref === "refs/tags/v4.7.8^{commit}") return "d".repeat(40);
      throw new Error(`Unexpected git ${cmd} ${args}`);
    },
    read: (ref, path) =>
      path === "package.json"
        ? { ...root, version: ref === stamp ? "4.7.9" : root.version }
        : path === ".release-please-manifest.json"
          ? { ".": ref === stamp ? "4.7.9" : root.version }
          : d,
    pulls: () => [
      {
        merged_at: "now",
        merge_commit_sha: declaration,
        user: { login: "miniaxolotl" },
        base: { ref: "development", repo: { full_name: "miniaxolotl/grove" } },
        head: { sha: declaration, repo: { full_name: "miniaxolotl/grove" } },
      },
    ],
    reviews: () => [],
    predecessor: predecessorEvidence,
  };
  const snapshot = (source) => ({
    source,
    policy: 3,
    mode: "comparison",
    toolchain: "fixture",
    versions: Object.fromEntries(
      Object.entries(receipts)
        .filter(([n]) => n.startsWith("npm:"))
        .map(([n, r]) => [n, r.identity.version]),
    ),
    targets: Object.fromEntries(
      Object.keys(receipts).map((n) => [n, { input: "old" }]),
    ),
    watch: {},
  });
  const baseline = snapshot(Object.values(receipts)[0].source),
    current = snapshot(candidate);
  current.targets.service.input = "new";
  current.targets.website.input = "new";
  return { d, io, baseline, current };
}
test("ordinary future candidate and direct root-only patch carry the same source-bound decision", () => {
  const f = fixture();
  assert.equal(
    validateDecision(f.d, declaration, false, f.io).hash,
    decisionHash(f.d),
  );
  assert.equal(
    validateDecision(f.d, stamp, true, f.io).hash,
    decisionHash(f.d),
  );
  assert.deepEqual(selectDecision(f.d, f.current, [f.baseline]).deliver, [
    "service",
    "website",
  ]);
});
test("missing review, drifted predecessor, inherited decision and non-root release edits hold", () => {
  for (const mutate of [
    (f) => f.d.publish.push("npm:grove"),
    (f) => (f.d.topology = "checker"),
    (f) => (f.d.schema = 2),
    (f) => (f.d.extra = true),
    (f) => (f.io.pulls = () => []),
    (f) => (f.d.predecessor.source = "f".repeat(40)),
    (f) => {
      const git = f.io.git;
      f.io.git = (cmd, ...args) =>
        cmd === "diff" ? "packages/api/src/app.ts" : git(cmd, ...args);
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateDecision(f.d, stamp, true, f.io));
  }
  const f = fixture();
  assert.throws(() => validateDecision(f.d, "f".repeat(40), true, f.io));
  assert.throws(() => validateDecision(f.d, declaration, true, f.io));
});
test("service is never website-only and changed installers/downloads never get republished implicitly", () => {
  for (const name of [
    "service",
    "downloads",
    "npm:grove-server",
    "npm:grove",
    "npm:grove-codex-plugin",
  ]) {
    const f = fixture();
    if (name === "service") f.d.deliver = ["website"];
    else f.current.targets[name].input = "changed";
    assert.throws(() => selectDecision(f.d, f.current, [f.baseline]));
  }
  const f = fixture();
  f.current.watch["pnpm-lock.yaml"] = "drift";
  assert.throws(() => selectDecision(f.d, f.current, [f.baseline]));
});
test("exact reviewed watch pairs do not conceal changed archives or accept stale fingerprints", () => {
  const f = fixture();
  f.baseline.watch.tool = "old";
  f.current.watch.tool = "new";
  f.d.reviewedInputs[f.baseline.source] = { tool: ["old", "new"] };
  assert.equal(selectDecision(f.d, f.current, [f.baseline]).publish.length, 0);
  f.current.watch.tool = "other";
  assert.throws(() => selectDecision(f.d, f.current, [f.baseline]));
});
test("reviewed watch overrides cannot conceal browser or marketplace pin changes", () => {
  for (const path of [
    "browserVersions",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
  ]) {
    const f = fixture();
    f.baseline.watch[path] = "old";
    f.current.watch[path] = "new";
    f.d.reviewedInputs[f.baseline.source] = { [path]: ["old", "new"] };
    assert.throws(() => selectDecision(f.d, f.current, [f.baseline]), /pin/i);
  }
});
function predecessorEvidence(p) {
  const pr = (ref, source) => ({
    merged_at: "now",
    merge_commit_sha: source,
    base: { ref, repo: { full_name: "miniaxolotl/grove" } },
    head: {
      ref: `promote/production/${p.tag}`,
      sha: p.source,
      repo: { full_name: "miniaxolotl/grove" },
    },
    labels: [{ name: "autorelease: tagged" }],
  });
  return {
    release: { tag_name: p.tag, draft: false },
    sourcePr: pr("development", p.source),
    productionPr: pr("production", p.production),
  };
}
test("predecessor production must be the admitted promotion of the declared source release", () => {
  const p = fixture().d.predecessor;
  assert.doesNotThrow(() => assertPredecessor(p, predecessorEvidence(p)));
  for (const mutate of [
    (e) => (e.productionPr.merge_commit_sha = "f".repeat(40)),
    (e) => (e.productionPr.head.ref = "other"),
    (e) => (e.sourcePr.labels = []),
    (e) => (e.release.draft = true),
  ]) {
    const e = predecessorEvidence(p);
    mutate(e);
    assert.throws(() => assertPredecessor(p, e));
  }
});
test("partial delivery/retry accepts baseline or exact admitted digest, never uncertain or unrelated deployment", () => {
  const baseline = {
    deploymentId: "old",
    imageDigest: "sha256:" + "a".repeat(64),
  };
  const digest = "sha256:" + "b".repeat(64);
  const app = (id, image) => ({
    active_deployment: {
      id,
      phase: "ACTIVE",
      spec: {
        services: [{ name: "api", image: { digest: image } }],
        workers: [{ name: "worker", image: { digest: image } }],
      },
    },
  });
  assert.equal(
    selectedServiceReadback(app("old", baseline.imageDigest), baseline, digest),
    false,
  );
  assert.equal(
    selectedServiceReadback(app("new", digest), baseline, digest),
    true,
  );
  for (const change of [
    app("other", "sha256:" + "c".repeat(64)),
    { ...app("new", digest), pending_deployment: { id: "pending" } },
    { ...app("new", digest), in_progress_deployment: { id: "uncertain" } },
    {
      active_deployment: {
        ...app("new", digest).active_deployment,
        phase: "ERROR",
      },
    },
  ])
    assert.throws(() => selectedServiceReadback(change, baseline, digest));
  assert.throws(() =>
    selectedServiceReadback(app("new", digest), baseline, null),
  );
});
test("ordinary release and publication no longer consume selective decisions", () => {
  const source = readFileSync(".github/workflows/release.yml", "utf8");
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  const publisher = readFileSync("scripts/publish.mjs", "utf8");
  for (const text of [source, deploy, publisher])
    assert.doesNotMatch(
      text,
      /resolveDecision|RELEASE_DECISION_HASH|selected-decision|outputs\.mode/,
    );
  assert.match(deploy, /run: node scripts\/publish\.mjs/);
});
test("the actual selected deploy entry rechecks scope/hash and reconciles uncertain and completed retries without another write", async () => {
  const f = fixture(),
    hash = decisionHash(f.d),
    digest = "sha256:" + "b".repeat(64);
  const old = f.d.receipts.service.identity;
  const env = {
    RELEASE_DECISION_HASH: hash,
    GROVE_IMAGE_DIGEST: digest,
    RELEASE_SOURCE_SHA: stamp,
    DIGITALOCEAN_APP_ID: "app",
  };
  const spec = (image) => ({
    services: [
      {
        name: "api",
        image: { digest: image, registry: "miniaxolotl", repository: "grove" },
      },
    ],
    workers: [
      {
        name: "worker",
        image: { digest: image, registry: "miniaxolotl", repository: "grove" },
      },
    ],
  });
  const app = (id, image) => ({
    id: "app",
    spec: spec(image),
    active_deployment: { id, phase: "ACTIVE", spec: spec(image) },
  });
  let state = app(old.deploymentId, old.imageDigest),
    writes = 0;
  const deps = {
    resolve: () => ({ hash, manifest: f.d }),
    current: () => {},
    verifyBaselines: () => {},
    fingerprint: () => "f".repeat(64),
    readApp: async () => state,
    deploy: async () => {
      writes++;
      state = { ...state, pending_deployment: { id: "pending" } };
      throw new Error("uncertain provider response");
    },
  };
  await assert.rejects(deploySelected(env, deps), /uncertain/);
  await assert.rejects(deploySelected(env, deps), /pending/);
  assert.equal(writes, 1);
  state = app("completed", digest);
  assert.equal((await deploySelected(env, deps)).action, "already-active");
  assert.equal(writes, 1);
  await assert.rejects(
    deploySelected({ ...env, RELEASE_DECISION_HASH: "f".repeat(64) }, deps),
    /drift/,
  );
  f.d.deliver = ["website"];
  await assert.rejects(deploySelected(env, deps), /authorize/);
  assert.equal(writes, 1);
});

test("legacy offline declarations and patch stamps preserve installer bytes", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "grove-selected-decision-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const put = (path, value) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), value);
  };
  const json = (path, value) =>
    put(path, JSON.stringify(value, null, 2) + "\n");
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  json("package.json", { private: true, version: "7.2.40" });
  json(".release-please-manifest.json", { ".": "7.2.40" });
  put("CHANGELOG.md", "# Changes\n");
  const pin = "packages/mcp/package.json";
  const pinBytes = '{"name":"@miniaxolotl/grove","version":"3.4.5"}\n';
  put(pin, pinBytes);
  let predecessor = commit();
  git("tag", "v7.2.40");
  let firstDecision;
  for (const patch of [41, 42]) {
    put("website.txt", `edit ${patch}`);
    const candidate = commit();
    const d = fixture().d;
    d.candidate = candidate;
    d.deliver = ["website"];
    d.predecessor = {
      tag: `v7.2.${patch - 1}`,
      source: predecessor,
      production: predecessor,
    };
    for (const r of Object.values(d.receipts)) r.source = predecessor;
    json("scripts/release/decision.json", d);
    const declaration = commit();
    const io = {
      git,
      read: (ref, path) => JSON.parse(git("show", `${ref}:${path}`)),
      predecessor: predecessorEvidence,
      pulls: () => [
        {
          merged_at: "now",
          merge_commit_sha: declaration,
          user: { login: "miniaxolotl" },
          base: {
            ref: "development",
            repo: { full_name: "miniaxolotl/grove" },
          },
          head: { repo: { full_name: "miniaxolotl/grove" } },
        },
      ],
    };
    const result = validateDecision(d, declaration, false, io);
    if (firstDecision) assert.notEqual(result.hash, firstDecision.hash);
    else firstDecision = result;
    json("package.json", { private: true, version: `7.2.${patch}` });
    json(".release-please-manifest.json", { ".": `7.2.${patch}` });
    put("CHANGELOG.md", `# Changes ${patch}\n`);
    const stamp = commit();
    git("tag", `v7.2.${patch}`);
    assert.equal(validateDecision(d, stamp, true, io).hash, result.hash);
    assert.equal(readFileSync(join(cwd, pin), "utf8"), pinBytes);
    predecessor = stamp;
  }
});
