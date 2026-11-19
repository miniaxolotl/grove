import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { packArtifact } from "./release/pack.mjs";
import { resolveDecision } from "./release/selected-decision.mjs";
import {
  assertRepository,
  registryIntegrity,
  waitForPublication,
} from "./release/publication.mjs";

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const verifyOnly = process.argv.includes("--verify-only");
assert(!(dryRun && verifyOnly), "Choose preflight or verification, not both");
if (
  !dryRun &&
  !verifyOnly &&
  (process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/production")
) {
  throw new Error(
    "Publish through the protected production Deploy workflow; local checks use --dry-run",
  );
}
const version = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
).version;
const temporary = process.env.CI ? tmpdir() : "/tmp/opencode";
const pending = [];
const verified = [];
// Even a direct invocation cannot turn an admitted hosted-only decision into
// coordinated npm publication. Structural/source validation precedes any npm read.
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert.equal(
  process.env.RELEASE_SOURCE_SHA ?? head,
  head,
  "Publisher checkout differs from admitted source",
);
const decision = resolveDecision(head, true);
if (verifyOnly)
  assert(
    !decision,
    "Complete coordinated publication verification cannot omit selected packages",
  );
if (process.env.RELEASE_DECISION_HASH)
  assert.equal(
    decision?.hash,
    process.env.RELEASE_DECISION_HASH,
    "Publisher decision drift",
  );
await mkdir(temporary, { recursive: true });
const directory = await mkdtemp(join(temporary, "grove-publish-"));
try {
  // Preflight every artifact before publishing any package. A historical version
  // must never silently skip changed code while newer sibling packages publish.
  for (const name of decision
    ? []
    : [
        "api",
        "mcp",
        "grove-opencode-plugin",
        "grove-claude-plugin",
        "grove-codex-plugin",
      ]) {
    const path = join(root, "packages", name);
    const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    assertRepository(pkg);
    if (pkg.version !== version)
      throw new Error(
        `${pkg.name} must share the product release version ${version}`,
      );
    const integrity = registryIntegrity(`${pkg.name}@${pkg.version}`);
    const destination = join(directory, name);
    const archive = packArtifact(path, destination);
    const digest = `sha512-${createHash("sha512")
      .update(await readFile(archive))
      .digest("base64")}`;
    if (integrity && integrity !== digest)
      throw new Error(
        `${pkg.name}@${pkg.version} is already published with different contents. Merge a new version release before publishing.`,
      );
    if (verifyOnly && !integrity)
      throw new Error(
        `${pkg.name}@${pkg.version} is not published; publication remains pending`,
      );
    if (integrity)
      verified.push({ name: pkg.name, version: pkg.version, integrity });
    if (!integrity)
      pending.push({
        archive,
        name: `${pkg.name}@${pkg.version}`,
        integrity: digest,
      });
  }
  for (const pkg of pending) {
    if (dryRun) process.stdout.write(`Would publish ${pkg.name}\n`);
    else {
      execFileSync(
        "npm",
        [
          "publish",
          pkg.archive,
          "--access",
          "public",
          "--ignore-scripts",
          "--provenance",
        ],
        { stdio: "inherit" },
      );
      await waitForPublication(pkg);
    }
  }
  if (verifyOnly) {
    assert.equal(verified.length, 5);
    process.stdout.write(
      JSON.stringify({
        schema: 1,
        packages: verified.sort((a, b) => a.name.localeCompare(b.name)),
      }) + "\n",
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
