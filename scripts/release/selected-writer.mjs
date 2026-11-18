import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { successfulReceipt } from "./impact-identity.mjs";
import {
  assertManifestVersion,
  assertReleaseIntent,
  reconcileGroveReleaseHistory,
} from "./release-intent.mjs";

const packages = {
  api: "grove-server",
  mcp: "grove",
  ...Object.fromEntries(
    ["claude", "codex", "opencode"].map((agent) => [
      `grove-${agent}-plugin`,
      `grove-${agent}-plugin`,
    ]),
  ),
};
const pins = {
  "packages/grove-claude-plugin/.claude-plugin/plugin.json":
    "grove-claude-plugin",
  "packages/grove-codex-plugin/plugin.json": "grove-codex-plugin",
  ".agents/plugins/marketplace.json": "grove-codex-plugin",
  ".claude-plugin/marketplace.json": "grove-claude-plugin",
};
const product = [
  "package.json",
  ".release-please-manifest.json",
  "CHANGELOG.md",
];
const sha = /^[a-f0-9]{40}$/;

// Reconcile a reviewed one-commit Release Please proposal with its input tree.
// Write complete replacement files relative to the *candidate*, never on top of
// the coordinated proposal: omitted npm files must retain their candidate bytes.
export function stageRelease(proposal, report, cwd = process.cwd()) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  const { candidate, targets } = report;
  assert.match(proposal, sha);
  assert.match(candidate, sha);
  assert.equal(report.mode, "production-advisory");
  assert.equal(
    git("show", "-s", "--format=%P", proposal).trim(),
    candidate,
    "Proposal must have just the planned candidate as its parent",
  );
  const blob = (ref, path) => git("show", `${ref}:${path}`);
  const owners = {
    ...pins,
    ...Object.fromEntries(
      Object.entries(packages).map(([dir, name]) => [
        `packages/${dir}/package.json`,
        name,
      ]),
    ),
  };
  const inventory = [
    "website",
    "service",
    "downloads",
    ...Object.values(packages).map((n) => "npm:" + n),
  ];
  assert.deepEqual(
    Object.keys(targets).sort(),
    inventory.sort(),
    "Incomplete delivery inventory",
  );
  const changed = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    candidate,
    proposal,
  )
    .split("\0")
    .filter(Boolean);
  assert.deepEqual(
    changed.sort(),
    [...product, ...Object.keys(owners)].sort(),
    "Expected coordinated release-only writes",
  );
  const staged = {},
    publish = [],
    deliver = [];
  for (const path of product) staged[path] = blob(proposal, path);
  const root = JSON.parse(staged["package.json"]),
    version = root.version;
  const baseRoot = JSON.parse(blob(candidate, "package.json"));
  assert(root.private && version !== baseRoot.version);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(
    root,
    { ...baseRoot, version },
    "Unexpected non-version root edit",
  );
  assert.deepEqual(JSON.parse(staged[".release-please-manifest.json"]), {
    ".": version,
  });
  assert.deepEqual(
    JSON.parse(blob(candidate, ".release-please-manifest.json")),
    { ".": baseRoot.version },
  );
  const tag = `v${baseRoot.version}`;
  const previousSource = git(
    "rev-parse",
    "--verify",
    `refs/tags/${tag}^{commit}`,
  ).trim();
  git("merge-base", "--is-ancestor", previousSource, candidate);
  const records = git(
    "log",
    "--first-parent",
    "-z",
    "--format=%H%x00%B",
    `${previousSource}..${candidate}`,
  ).split("\0");
  assert.equal(records.pop(), "");
  const history = [];
  for (let i = 0; i < records.length; i += 2)
    history.push({ sha: records[i], message: records[i + 1] });
  const intent = assertReleaseIntent(
    reconcileGroveReleaseHistory(tag, previousSource, history),
    baseRoot.version,
  );
  assertManifestVersion(baseRoot.version, version, intent);

  for (const [name, t] of Object.entries(targets)) {
    assert(!t.unresolved?.length, `Unresolved inputs for ${name}`);
    assert.match(t.baselineSource, sha);
    git("merge-base", "--is-ancestor", t.baselineSource, candidate);
    assert(
      successfulReceipt(name, t.oldIdentity, t.evidence) &&
        t.prerequisite &&
        t.proofRequired,
      `Missing evidence for ${name}`,
    );
    if (t.state === "unchanged") {
      assert.deepEqual(t.oldIdentity, t.proposedIdentity);
      assert.deepEqual(t.changes, []);
    } else {
      assert.equal(t.state, "selected", `Unresolved ${name}`);
      assert(
        t.effect?.trim() && t.changes?.length,
        `Missing effect for ${name}`,
      );
      assert(
        ["website", "service", "npm:grove-server"].includes(name),
        `Unsupported selection: ${name}`,
      );
      if (!name.startsWith("npm:")) {
        assert.equal(t.proposedIdentity.source, candidate);
        deliver.push(name);
      }
    }
  }

  for (const [path, name] of Object.entries(owners)) {
    const t = targets[`npm:${name}`],
      before = JSON.parse(blob(candidate, path)),
      after = JSON.parse(blob(proposal, path));
    const marketplace = path.endsWith("marketplace.json");
    const field = marketplace ? before.plugins[0].source : before;
    const fullName = "@miniaxolotl/" + name;
    if (marketplace) assert.equal(field.package, fullName);
    if (path.endsWith("/package.json")) assert.equal(before.name, fullName);
    assert.match(t.oldIdentity.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    const previous = t.oldIdentity.version;
    assert.equal(
      field.version,
      previous,
      `Candidate and receipt disagree for ${path}`,
    );
    field.version = version;
    assert.deepEqual(
      after,
      before,
      `Unexpected non-version release edit to ${path}`,
    );
    if (t.state === "selected") {
      const next = t.proposedIdentity.version;
      const history = git(
        "log",
        "--format=%B%x00",
        `${t.baselineSource}..${candidate}`,
      ).split("\0");
      assert.equal(
        assertReleaseIntent(history, previous),
        null,
        "Explicit version intent requires separate review",
      );
      assert.notEqual(next, previous);
      assertManifestVersion(previous, next, null);
      field.version = next;
      staged[path] = JSON.stringify(before, null, 2) + "\n";
      publish.push(`${fullName}@${next}`);
    }
  }
  assert(deliver.length + publish.length, "No selected deliveries");
  const directory = mkdtempSync(join(tmpdir(), "grove-release-overlay-"));
  try {
    for (const [path, text] of Object.entries(staged)) {
      mkdirSync(join(directory, dirname(path)), { recursive: true });
      writeFileSync(join(directory, path), text, { flag: "wx" });
    }
    return {
      mode: "dry-run",
      candidate,
      proposal,
      version,
      directory,
      files: Object.keys(staged),
      publish,
      deliver,
      targets,
      storeChannels: report.storeChannels,
    };
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(
    process.argv.length,
    4,
    "Usage: selected-writer.mjs <upstream-proposal-sha> <impact-report.json>",
  );
  process.stdout.write(
    JSON.stringify(
      stageRelease(
        process.argv[2],
        JSON.parse(readFileSync(process.argv[3], "utf8")),
      ),
      null,
      2,
    ) + "\n",
  );
}
