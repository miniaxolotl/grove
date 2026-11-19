import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const subject = await import("./held-workflow-source.mjs").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});

test("held workflow source accepts only exact declared, stamped or tagged promotion trees", () => {
  assert.equal(typeof subject.resolveHeldWorkflowSelection, "function");
  const directory = mkdtempSync(join(tmpdir(), "grove-held-workflow-"));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Grove Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const write = (path, value) =>
    writeFileSync(join(directory, path), JSON.stringify(value) + "\n");
  const path = "scripts/release/held-decision.json";
  const api = {
    git,
    read: (ref, name) => git("show", `${ref}:${name}`),
    exists: (ref, name) =>
      git("ls-tree", "--name-only", ref, "--", name) === name,
  };
  const select = (ref) => subject.resolveHeldWorkflowSelection(ref, api);
  try {
    git("init", "--initial-branch=development");
    write("package.json", { version: "1.11.30" });
    write(".release-please-manifest.json", { ".": "1.11.30" });
    write("release-please-config.json", {
      packages: { ".": { "extra-files": [] } },
    });
    writeFileSync(join(directory, "CHANGELOG.md"), "# Changelog\n");
    git("add", ".");
    git("commit", "-m", "chore(release): baseline");
    const base = git("rev-parse", "HEAD");
    git("tag", "v1.11.30");
    mkdirSync(join(directory, "scripts/release"), { recursive: true });
    const decision = {
      schema: 1,
      mode: "held-publication-only",
      anchor: base,
      app: "11111111-1111-4111-8111-111111111111",
      previousDigest: "sha256:" + "d".repeat(64),
    };
    write(path, decision);
    git("add", ".");
    git("commit", "-m", "chore(release): declare source");
    const declared = git("rev-parse", "HEAD");
    assert.deepEqual(select(declared).manifest, decision);
    write("package.json", { version: "1.11.31" });
    write(".release-please-manifest.json", { ".": "1.11.31" });
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      "# Changelog\n\n## 1.11.31\n",
    );
    git("add", ".");
    git("commit", "-m", "chore(release): release 1.11.31");
    const source = git("rev-parse", "HEAD"),
      tree = git("rev-parse", `${source}^{tree}`);
    const frozen = git(
      "commit-tree",
      tree,
      "-p",
      base,
      "-p",
      source,
      "-m",
      "frozen promotion",
    );
    const production = git(
      "commit-tree",
      tree,
      "-p",
      base,
      "-p",
      frozen,
      "-m",
      "production merge",
    );
    assert.throws(
      () => select(frozen),
      "An untagged wrapper cannot select held mode",
    );
    git("tag", "v1.11.31");
    for (const ref of [source, frozen, production])
      assert.deepEqual(select(ref).manifest, decision);
    const inherited = git(
      "commit-tree",
      tree,
      "-p",
      source,
      "-m",
      "unreviewed no-op source",
    );
    assert.throws(
      () => select(inherited),
      "Same-tree arbitrary successors are not promotions",
    );
    const wrongFrozen = git(
      "commit-tree",
      tree,
      "-p",
      declared,
      "-p",
      source,
      "-m",
      "other baseline",
    );
    const wrongMerge = git(
      "commit-tree",
      tree,
      "-p",
      base,
      "-p",
      wrongFrozen,
      "-m",
      "mismatched parents",
    );
    assert.throws(() => select(wrongMerge));
    const unrelated = git(
      "commit-tree",
      tree,
      "-p",
      base,
      "-p",
      declared,
      "-m",
      "tag not an ancestor",
    );
    assert.throws(() => select(unrelated));
    writeFileSync(join(directory, "extra.txt"), "unreviewed source\n");
    git("add", ".");
    const changed = git("write-tree");
    const edited = git(
      "commit-tree",
      changed,
      "-p",
      base,
      "-p",
      frozen,
      "-m",
      "edited production",
    );
    assert.throws(
      () => select(edited),
      "A changed production tree must remain rejected",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
