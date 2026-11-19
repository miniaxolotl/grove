import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";

test("Source Release discovers a strict held stamp without a released CLI flag", () => {
  const directory = mkdtempSync(join(tmpdir(), "grove-held-source-"));
  const script = resolve("scripts/release/proofing-release.mjs");
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
  try {
    git("init", "--initial-branch=development");
    write("package.json", { version: "1.11.29" });
    write(".release-please-manifest.json", { ".": "1.11.29" });
    write("release-please-config.json", {
      packages: { ".": { "extra-files": [] } },
    });
    writeFileSync(join(directory, "CHANGELOG.md"), "# Changelog\n");
    git("add", ".");
    git("commit", "-m", "chore(release): baseline");
    git("tag", "v1.11.29");
    const anchor = git("rev-parse", "HEAD");
    mkdirSync(join(directory, "scripts/release"), { recursive: true });
    write("scripts/release/held-decision.json", {
      schema: 1,
      mode: "held-publication-only",
      anchor,
      app: "11111111-1111-4111-8111-111111111111",
      previousDigest: "sha256:" + "d".repeat(64),
    });
    git("add", ".");
    git("commit", "-m", "chore(release): declare held source");
    write("package.json", { version: "1.11.30" });
    write(".release-please-manifest.json", { ".": "1.11.30" });
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      "# Changelog\n\n## 1.11.30\n",
    );
    git("add", ".");
    git("commit", "-m", "chore(release): release 1.11.30");
    const output = join(directory, "scope.txt");
    const run = spawnSync(
      process.execPath,
      [script, git("rev-parse", "HEAD")],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: output },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(readFileSync(output, "utf8"), /^mode=coordinated$/m);
    assert.match(readFileSync(output, "utf8"), /^held=true$/m);
    assert.match(readFileSync(output, "utf8"), /^website=false$/m);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
