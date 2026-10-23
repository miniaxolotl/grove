import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import { Manifest, setLogger } from "release-please";

setLogger({ info() {}, warn() {}, error() {}, debug() {}, trace() {} });
const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const configuration = JSON.parse(read("release-please-config.json"));
async function* iterate(items) {
  yield* items;
}

for (const [message, path, expected] of [
  [
    "feature(memory): improve shared retrieval",
    "lib/memory/src/index.ts",
    "1.1.1",
  ],
  ["fix(cli): repair shared executable", "packages/mcp/src/cli.ts", "1.1.1"],
  [
    "fix(release): coordinate bundled packages\n\nRelease-As: 1.2.0",
    "release-please-config.json",
    "1.2.0",
  ],
]) {
  test(`coordinated release: ${message.split("\n")[0]}`, async () => {
    const paths = [
      "package.json",
      ...configuration.packages["."]["extra-files"].map((file) => file.path),
    ];
    const files = Object.fromEntries(paths.map((name) => [name, read(name)]));
    files["release-please-config.json"] = JSON.stringify(configuration);
    files[".release-please-manifest.json"] = JSON.stringify({ ".": "1.1.0" });
    const github = {
      repository: {
        owner: "miniaxolotl",
        repo: "grove",
        defaultBranch: "development",
      },
      async getFileContentsOnBranch(name) {
        assert.ok(name in files, `Unexpected source read: ${name}`);
        return {
          parsedContent: files[name],
          content: Buffer.from(files[name]).toString("base64"),
          sha: "f".repeat(40),
        };
      },
      async getFileJson(name) {
        return JSON.parse(files[name]);
      },
      releaseIterator: () => iterate([]),
      tagIterator: () => iterate([]),
      mergeCommitIterator: () =>
        iterate([
          { sha: "a".repeat(40), message, files: [path] },
          {
            sha: configuration["bootstrap-sha"],
            message: "feat: historical release",
            files: [path],
          },
        ]),
      pullRequestIterator: () => iterate([]),
    };
    const manifest = await Manifest.fromManifest(github, "development");
    const proposals = await manifest.buildPullRequests();
    assert.equal(proposals.length, 1);
    const pr = proposals[0];
    for (const update of pr.updates) {
      if (update.path in files || update.createIfMissing)
        files[update.path] = update.updater.updateContent(files[update.path]);
    }
    for (const name of paths.filter(
      (name) => name.endsWith("package.json") || name.endsWith("plugin.json"),
    )) {
      assert.equal(JSON.parse(files[name]).version, expected, name);
    }
    for (const name of [
      ".claude-plugin/marketplace.json",
      ".agents/plugins/marketplace.json",
    ]) {
      assert.equal(
        JSON.parse(files[name]).plugins[0].source.version,
        expected,
        name,
      );
    }
    assert.equal(
      JSON.parse(files[".release-please-manifest.json"])["."],
      expected,
    );
    assert.ok(
      files["CHANGELOG.md"].includes(message.split("\n")[0].split(": ")[1]),
    );
    assert.ok(!files["CHANGELOG.md"].includes("historical release"));
  });
}
