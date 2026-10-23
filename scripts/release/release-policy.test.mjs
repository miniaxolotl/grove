import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { Manifest, VERSION, setLogger } from "release-please";

setLogger({ info() {}, warn() {}, error() {}, debug() {}, trace() {} });
const config = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const root = config.packages["."];
const sections = [
  ["feature", "Features", false],
  ["feat", "Features", false],
  ["fix", "Bug Fixes", false],
  ["perf", "Performance Improvements", false],
  ["revert", "Reverts", false],
  ["docs", "Documentation", true],
  ["test", "Tests", true],
  ["chore", "Miscellaneous Chores", true],
  ["ci", "Continuous Integration", true],
  ["build", "Build System", true],
  ["refactor", "Code Refactoring", true],
  ["style", "Styles", true],
].map(([type, section, hidden]) => ({ type, section, hidden }));

test("family Release Please policy uses one pinned strategy and equivalent version/tag/changelog rules", () => {
  assert.equal(VERSION, "17.6.0");
  assert.equal(
    config.$schema,
    "https://raw.githubusercontent.com/googleapis/release-please/v17.6.0/schemas/config.json",
  );
  assert.deepEqual(Object.keys(config.packages), ["."]);
  for (const [key, value] of Object.entries({
    "release-type": "node",
    versioning: "always-bump-patch",
    "initial-version": "0.1.0",
    "bump-minor-pre-major": true,
    "bump-patch-for-minor-pre-major": true,
    "include-component-in-tag": false,
    "include-v-in-tag": true,
    "include-v-in-release-name": true,
    "force-tag-creation": false,
    prerelease: true,
    "changelog-path": "CHANGELOG.md",
    "pull-request-title-pattern": "chore(release): release ${version}",
    "pull-request-footer":
      "Source release only. Deployment, artifact acceptance and store submission are separate operations.",
  }))
    assert.deepEqual(root[key], value, key);
  assert.deepEqual(root["changelog-sections"], sections);
  assert.equal(
    JSON.parse(readFileSync("package.json", "utf8")).devDependencies[
      "release-please"
    ],
    "17.6.0",
  );
});

async function* iterate(values) {
  yield* values;
}
for (const [version, message, expected] of [
  ["0.3.12", "feature(core): add capability", "0.3.13"],
  ["0.3.12", "fix(core)!: change contract\n\nRelease-As: 0.4.0", "0.4.0"],
  ["1.2.3", "feature(core): add capability", "1.2.4"],
  ["1.2.3", "feature(core): select minor\n\nRelease-As: 1.3.0", "1.3.0"],
  ["1.2.3", "fix(core): repair behavior", "1.2.4"],
  ["1.2.3", "fix(core)!: change contract\n\nRelease-As: 2.0.0", "2.0.0"],
  ["1.2.3", "docs(core): clarify behavior", null],
])
  test(`real upstream version/update contract: ${version} ${message}`, async () => {
    const files = {};
    const extra = (root["extra-files"] ?? []).map((item) =>
      typeof item === "string" ? item : item.path,
    );
    for (const path of [
      "package.json",
      "package-lock.json",
      "CHANGELOG.md",
      ...extra,
    ])
      if (existsSync(path)) files[path] = readFileSync(path, "utf8");
    files["package.json"] = JSON.stringify({
      ...JSON.parse(files["package.json"]),
      version,
    });
    files["release-please-config.json"] = JSON.stringify(config);
    files[".release-please-manifest.json"] = JSON.stringify({ ".": version });
    const base = "b".repeat(40);
    const github = {
      repository: {
        owner: "fixture",
        repo: "app",
        defaultBranch: "development",
      },
      async getFileContentsOnBranch(path) {
        if (!(path in files))
          throw Object.assign(new Error("Fixture file absent"), {
            status: 404,
          });
        return {
          parsedContent: files[path],
          content: Buffer.from(files[path]).toString("base64"),
          sha: "f".repeat(40),
        };
      },
      async getFileJson(path) {
        return JSON.parse(files[path]);
      },
      releaseIterator: () =>
        iterate([{ tagName: `v${version}`, sha: base, notes: "previous" }]),
      tagIterator: () => iterate([{ name: `v${version}`, sha: base }]),
      mergeCommitIterator: () =>
        iterate([
          { sha: "a".repeat(40), message, files: ["package.json"] },
          { sha: base, message: "chore: previous", files: ["package.json"] },
        ]),
      pullRequestIterator: () => iterate([]),
    };
    const manifest = await Manifest.fromManifest(github, "development");
    const proposals = await manifest.buildPullRequests();
    assert.equal(proposals.length, expected ? 1 : 0);
    if (!expected) return;
    const pr = proposals[0];
    assert.equal(pr.title.toString(), `chore(release): release ${expected}`);
    for (const update of pr.updates)
      if (update.path in files || update.createIfMissing)
        files[update.path] = update.updater.updateContent(files[update.path]);
    assert.equal(JSON.parse(files["package.json"]).version, expected);
    assert.equal(
      JSON.parse(files[".release-please-manifest.json"])["."],
      expected,
    );
    for (const path of extra) {
      if (path.endsWith("package.json") || path.endsWith("plugin.json"))
        assert.equal(JSON.parse(files[path]).version, expected, path);
      if (path.endsWith("version.go"))
        assert.ok(files[path].includes(`var Version = "${expected}"`), path);
      if (path.endsWith("pubspec.yaml"))
        assert.ok(files[path].includes(`version: ${expected}`), path);
    }
  });
