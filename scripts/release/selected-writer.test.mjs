import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";
import { Manifest, setLogger } from "release-please";
import { stageRelease as stage } from "./selected-writer.mjs";

setLogger({ info() {}, warn() {}, error() {}, debug() {}, trace() {} });
async function* iterate(items) {
  yield* items;
}

// Recreate the twelve coordinated writes from Grove release #264 without
// depending on tag history in a shallow CI checkout. The server is deliberately
// one installer version behind the product to catch accidental product copying.
async function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "grove-writer-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const put = (path, text) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const get = (path) => readFileSync(join(cwd, path), "utf8");
  const config = JSON.parse(readFileSync("release-please-config.json"));
  const extra = config.packages["."]["extra-files"];
  const targets = {};
  function writeVersions(product, server) {
    for (const { path } of [{ path: "package.json" }, ...extra]) {
      const data = JSON.parse(readFileSync(path));
      const field = path.endsWith("marketplace.json")
        ? data.plugins[0].source
        : data;
      field.version = path === "packages/api/package.json" ? server : product;
      put(path, JSON.stringify(data, null, 2) + "\n");
      if (path.startsWith("packages/") && path.endsWith("/package.json")) {
        const target = "npm:" + data.name.split("/")[1];
        targets[target] ??= {
          oldIdentity: {
            version: field.version,
            integrity: "sha512-" + "A".repeat(86) + "==",
          },
        };
      }
    }
    put(
      ".release-please-manifest.json",
      JSON.stringify({ ".": product }, null, 2) + "\n",
    );
  }
  const commit = (msg) => {
    git("add", ".");
    git(
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      msg,
    );
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  put("release-please-config.json", JSON.stringify(config));
  writeVersions("1.11.23", "1.11.19");
  put("CHANGELOG.md", "# Changelog\n");
  const baseline = commit("chore(release): previous delivery");
  put(
    "packages/website/src/components/guest-writing-check.tsx",
    "// #265 UI fixture\n",
  );
  const message =
    "fix(website): identify the text in guest writing suggestions (#265)";
  const candidate = commit(message);
  // Use the pinned Release Please implementation. Substitute only its GitHub
  // reads. This is an isolated replay, not a claim #265 was released alone.
  const github = {
    repository: {
      owner: "miniaxolotl",
      repo: "grove",
      defaultBranch: "development",
    },
    async getFileContentsOnBranch(path) {
      if (!existsSync(join(cwd, path)))
        throw Object.assign(new Error(path), { status: 404 });
      return {
        parsedContent: get(path),
        content: Buffer.from(get(path)).toString("base64"),
        sha: git("rev-parse", `HEAD:${path}`),
      };
    },
    async getFileJson(path) {
      return JSON.parse(get(path));
    },
    releaseIterator: () =>
      iterate([{ tagName: "v1.11.23", sha: baseline, notes: "previous" }]),
    tagIterator: () => iterate([{ name: "v1.11.23", sha: baseline }]),
    pullRequestIterator: () => iterate([]),
    mergeCommitIterator: () =>
      iterate([
        {
          sha: candidate,
          message,
          files: ["packages/website/src/components/guest-writing-check.tsx"],
        },
        { sha: baseline, message: "chore: previous", files: [] },
      ]),
  };
  const releases = await (
    await Manifest.fromManifest(github, "development")
  ).buildPullRequests();
  assert.equal(releases.length, 1);
  for (const { path, updater, createIfMissing } of releases[0].updates)
    if (existsSync(join(cwd, path)) || createIfMissing)
      put(
        path,
        updater.updateContent(
          existsSync(join(cwd, path)) ? get(path) : undefined,
        ),
      );
  const proposal = commit(releases[0].title.toString());
  for (const name of ["website", "downloads", "service"])
    targets[name] = { oldIdentity: { source: baseline } };
  for (const target of Object.values(targets))
    Object.assign(target, {
      baselineSource: baseline,
      proposedIdentity: target.oldIdentity,
      state: "unchanged",
      changes: [],
      proofRequired: "provider readback",
      prerequisite: "verify compatibility",
    });
  const select = (name, effect, identity) =>
    Object.assign(targets[name], {
      state: "selected",
      effect,
      changes: ["changed-input"],
      proposedIdentity: identity ?? { source: candidate },
    });
  const report = {
    mode: "production-advisory",
    candidate,
    targets,
    storeChannels: { chrome: { state: "review" } },
  };
  return { cwd, proposal, report, select, git, put, get, commit };
}

test("UI-only release stages the upstream product files byte-for-byte and no npm manifest, native descriptor or marketplace pin", async (t) => {
  const f = await fixture(t);
  f.select("website", "guest UI");
  const out = stage(f.proposal, f.report, f.cwd);
  t.after(() => rmSync(out.directory, { recursive: true, force: true }));
  assert.deepEqual(out.files.sort(), [
    ".release-please-manifest.json",
    "CHANGELOG.md",
    "package.json",
  ]);
  for (const path of out.files)
    assert.equal(readFileSync(join(out.directory, path), "utf8"), f.get(path));
  assert.deepEqual(out.publish, []);
  assert.deepEqual(out.deliver, ["website"]);
  assert.deepEqual(out.storeChannels, f.report.storeChannels);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("hosted service and installable server can be selected independently or together", async (t) => {
  for (const [hosted, installed] of [
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const f = await fixture(t);
    if (hosted) f.select("service", "worker configuration");
    if (installed)
      f.select("npm:grove-server", "installed worker drains expired jobs", {
        version: "1.11.20",
      });
    const out = stage(f.proposal, f.report, f.cwd);
    t.after(() => rmSync(out.directory, { recursive: true, force: true }));
    assert.deepEqual(out.deliver, hosted ? ["service"] : []);
    assert.deepEqual(
      out.publish,
      installed ? ["@miniaxolotl/grove-server@1.11.20"] : [],
    );
    assert.equal(out.files.length, installed ? 4 : 3);
    if (installed)
      assert.equal(
        JSON.parse(
          readFileSync(join(out.directory, "packages/api/package.json")),
        ).version,
        "1.11.20",
      );
  }
});

test("rejects stale, partial, uncertain or unsupported selections and a proposal with non-version changes", async (t) => {
  const f = await fixture(t);
  f.select("website", "guest UI");
  for (const mutate of [
    (r) => (r.candidate = f.proposal),
    (r) => (r.mode = "source-replay"),
    (r) => delete r.targets.downloads,
    (r) => (r.targets.service.state = "review"),
    (r) => (r.targets.downloads.state = "selected"),
    (r) => (r.targets["npm:grove"].oldIdentity.version = "9.9.9"),
    (r) => (r.targets.service.unresolved = ["pnpm-lock.yaml"]),
  ]) {
    const copy = JSON.parse(JSON.stringify(f.report));
    mutate(copy);
    assert.throws(() => stage(f.proposal, copy, f.cwd));
  }
  f.git("reset", "--soft", f.report.candidate);
  const m = JSON.parse(f.get("packages/api/package.json"));
  m.description = "unreviewed edit";
  f.put("packages/api/package.json", JSON.stringify(m));
  assert.throws(
    () =>
      stage(f.commit("chore(release): modified release PR"), f.report, f.cwd),
    /non-version/i,
  );
});
