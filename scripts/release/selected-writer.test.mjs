import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import { writeProposal } from "./selected-replay.mjs";
import { stageRelease as stage } from "./selected-writer.mjs";

// Recreate the twelve coordinated writes from Grove release #264 without
// depending on tag history in a shallow CI checkout. The server is deliberately
// one installer version behind the product to catch accidental product copying.
async function fixture(t, footer = "") {
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
            latest: field.version,
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
  git("tag", "v1.11.23", baseline);
  put(
    "packages/website/src/components/guest-writing-check.tsx",
    "// #265 UI fixture\n",
  );
  const message =
    "fix(website): identify the text in guest writing suggestions (#265)" +
    footer;
  const candidate = commit(message);
  // Use the pinned Release Please implementation. Substitute only its GitHub
  // reads. This is an isolated replay, not a claim #265 was released alone.
  const proposal = commit(
    await writeProposal(cwd, git, message, [
      "packages/website/src/components/guest-writing-check.tsx",
    ]),
  );
  targets.website = {
    oldIdentity: {
      version: "1.11.23",
      productionSha: baseline,
      deploymentId: "dpl_fixture",
      deploymentUrl: "https://grove-fixture.vercel.app",
      alias: "https://usegrove.cloud",
    },
  };
  targets.service = {
    oldIdentity: {
      phase: "ACTIVE",
      deploymentId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      imageDigest: "sha256:" + "a".repeat(64),
    },
  };
  targets.downloads = {
    oldIdentity: {
      version: "1.11.23",
      assets: Object.fromEntries(
        [
          "downloads.json",
          "packages.build.json",
          "SHA256SUMS",
          "grove-chrome.zip",
          "grove-edge.zip",
          "grove-firefox.zip",
        ].map((k) => [k, "sha256:" + "b".repeat(64)]),
      ),
    },
  };
  for (const target of Object.values(targets))
    Object.assign(target, {
      baselineSource: baseline,
      evidence: "simulated provider readback",
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

test("rejects unsuccessful or incomplete identities even when marked unchanged", async (t) => {
  const f = await fixture(t);
  f.select("website", "guest UI");
  for (const [key, patch] of [
    ["service", { phase: "ERROR" }],
    ["downloads", { assets: {} }],
    ["npm:grove", { latest: "0.1.0" }],
  ]) {
    const r = globalThis.structuredClone(f.report);
    Object.assign(r.targets[key].oldIdentity, patch);
    assert.throws(() => stage(f.proposal, r, f.cwd), /evidence|identity/i);
  }
});

test("product versions follow merged intent, never the proposal's own message", async (t) => {
  const f = await fixture(t);
  f.select("website", "guest UI");
  const paths = f
    .git("diff", "--name-only", f.report.candidate, f.proposal)
    .split("\n");
  for (const next of ["1.11.22", "2.0.0"]) {
    f.git("reset", "--hard", f.proposal);
    f.git("reset", "--soft", f.report.candidate);
    for (const path of paths)
      f.put(path, f.get(path).replaceAll("1.11.24", next));
    const wrong = f.commit(
      `chore(release): release ${next}\n\nRelease-As: ${next}`,
    );
    assert.throws(() => stage(wrong, f.report, f.cwd), /Release-As|version/i);
  }
  const explicit = await fixture(t, "\n\nRelease-As: 2.0.0");
  explicit.select("website", "guest UI");
  const out = stage(explicit.proposal, explicit.report, explicit.cwd);
  t.after(() => rmSync(out.directory, { recursive: true, force: true }));
  assert.equal(out.version, "2.0.0");
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
