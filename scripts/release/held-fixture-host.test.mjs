import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const root = process.cwd();
const heldPath = "scripts/release/held-decision.json";
const selectedPath = "scripts/release/decision.json";
const contract = "scripts/release/held-declaration-contract.test.mjs";
const contexts = ["source", "accepted-merge", "stamp-source", "stamped-merge"];
const expectedCases = contexts.flatMap((context) => [
  `actual ${context} test/entrypoints keep an absent declaration unselected`,
  `actual ${context} test/entrypoints accept only a valid source-bound held declaration`,
  ...[
    "malformed",
    "extra-edit",
    "wrong-anchor",
    "foreign-decision",
    "mixed-decisions",
  ].map(
    (invalid) =>
      `actual ${context} rejects ${invalid} in both the test and production entrypoint`,
  ),
]);
for (const context of contexts.filter((name) => name.includes("stamp"))) {
  for (const invalid of [
    "changed-decision",
    "uncoordinated-pin",
    "extra-stamp-edit",
  ])
    expectedCases.push(
      `actual ${context} rejects ${invalid} instead of accepting any present file`,
    );
}
for (const target of [
  "deploy",
  "website",
  "provider-post",
  "unselected-pending",
])
  expectedCases.push(
    `actual workflow mutation control detects a removed ${target} exclusion`,
  );
for (const context of ["source", "accepted-merge"])
  expectedCases.push(
    `an ordinary commit inheriting a ${context} declaration cannot activate held delivery`,
  );
assert.equal(expectedCases.length, 40);

function host(t, context) {
  const cwd = mkdtempSync(join(tmpdir(), "grove-held-host-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(
      join(cwd, path),
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
  };
  // The outer host has its own history and authorizations, never the caller's.
  for (const directory of ["scripts/release", "scripts/ci"])
    cpSync(resolve(root, directory), join(cwd, directory), {
      recursive: true,
      filter: (path) =>
        ![resolve(root, heldPath), resolve(root, selectedPath)].includes(path),
    });
  for (const path of [
    ".github/workflows/deploy.yml",
    "package.json",
    ".release-please-manifest.json",
    "release-please-config.json",
  ])
    write(path, readFileSync(resolve(root, path), "utf8"));
  const config = JSON.parse(
    readFileSync(join(cwd, "release-please-config.json")),
  ).packages["."];
  for (const { path } of config["extra-files"])
    write(path, readFileSync(resolve(root, path), "utf8"));
  const fields = [
    ["package.json", ["version"]],
    [".release-please-manifest.json", ["."]],
    ...config["extra-files"].map(({ path, jsonpath }) => [
      path,
      jsonpath.slice(2).replace("[0]", ".0").split("."),
    ]),
  ];
  const version = (next) => {
    for (const [path, keys] of fields) {
      const value = JSON.parse(readFileSync(join(cwd, path)));
      let cursor = value;
      for (const key of keys.slice(0, -1)) cursor = cursor[key];
      cursor[keys.at(-1)] = next;
      write(path, value);
    }
  };
  version("1.11.29");
  write("CHANGELOG.md", "# Synthetic hosting changelog\n");
  write("host.txt", cwd);
  // No inherited credentials or real gh executable: unexpected CLI calls fail.
  write(".host-bin/gh", `#!${process.execPath}\nprocess.exit(90);\n`);
  chmodSync(join(cwd, ".host-bin/gh"), 0o755);
  const env = {
    PATH: `${join(cwd, ".host-bin")}:${process.env.PATH}`,
    HOME: cwd,
    LANG: "C.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    TMPDIR: tmpdir(),
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (message) => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-qb", "development");
  git("config", "user.name", "Fixture Host");
  git("config", "user.email", "fixture-host@example.invalid");
  write(".git/info/exclude", ".host-bin/\n");
  const baseline = commit("fix: synthetic hosting baseline");
  git("tag", "v1.11.29");
  const decision = {
    schema: 1,
    mode: "held-publication-only",
    anchor: baseline,
    app: "11111111-1111-4111-8111-111111111111",
    previousDigest: `sha256:${"a".repeat(64)}`,
  };
  if (context !== "absent") {
    git("checkout", "-qb", "declaration");
    if (context === "malformed") write(heldPath, '{"schema":');
    else if (context === "selected") write(selectedPath, '{"schema":');
    else
      write(heldPath, {
        ...decision,
        ...(context === "foreign" ? { anchor: "f".repeat(40) } : {}),
      });
    let declared = commit("chore(release): synthetic hosting declaration");
    if (["accepted-merge", "stamp-source", "stamped-merge"].includes(context)) {
      git("checkout", "-q", "development");
      git(
        "merge",
        "--no-ff",
        "-qm",
        "chore(release): accept hosting declaration",
        declared,
      );
      declared = git("rev-parse", "HEAD");
    }
    if (context.includes("stamp")) {
      git("checkout", "-qb", "stamp");
      version("1.11.30");
      write(
        "CHANGELOG.md",
        "# Synthetic hosting changelog\n\n## 1.11.30\n\nFixture only.\n",
      );
      const stamped = commit("chore(release): release 1.11.30");
      if (context === "stamped-merge") {
        git("checkout", "-q", "development");
        git(
          "merge",
          "--no-ff",
          "-qm",
          "chore(release): accept hosting stamp",
          stamped,
        );
      }
      assert.equal(git("rev-parse", "HEAD^1"), declared);
      // Verify all root/package/native/marketplace fields, not a root-only stamp.
      for (const [path, keys] of fields) {
        let value = JSON.parse(readFileSync(join(cwd, path)));
        for (const key of keys) value = value[key];
        assert.equal(value, "1.11.30", path);
      }
      assert.equal(fields.length, 11);
    }
  }
  const source = git("rev-parse", "HEAD");
  const execute = (args) => {
    const result = spawnSync(process.execPath, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(
      result.signal,
      null,
      "A killed/timed-out child cannot qualify a host",
    );
    assert(
      [0, 1].includes(result.status),
      "Unexpected child exit is not a contract result",
    );
    return result;
  };
  return { cwd, source, decision, execute, git };
}

for (const context of [
  "absent",
  ...contexts,
  "malformed",
  "foreign",
  "selected",
]) {
  test(`entire inner held contract suite is hermetic in ${context} hosting checkout`, (t) => {
    const f = host(t, context);
    const invalid = ["malformed", "foreign"].includes(context);
    const admission = f.execute([
      "--input-type=module",
      "-e",
      "import{resolveHeldDecision}from'./scripts/release/held-delivery.mjs';console.log(JSON.stringify(resolveHeldDecision(process.argv[1],process.argv[2]==='true')));",
      f.source,
      String(context.includes("stamp")),
    ]);
    assert.equal(
      admission.status,
      invalid ? 1 : 0,
      admission.stdout + admission.stderr,
    );
    if (!invalid) {
      const selection = JSON.parse(admission.stdout);
      if (["absent", "selected"].includes(context))
        assert.equal(selection, null);
      else assert.deepEqual(selection.manifest, f.decision);
    }
    const guards = f.execute([
      "--test",
      "--test-reporter=tap",
      "scripts/release/held-workflow.test.mjs",
      "scripts/release/held-delivery.test.mjs",
    ]);
    assert.equal(guards.status, invalid ? 1 : 0, guards.stdout + guards.stderr);
    assert.match(guards.stdout, /^# tests 9$/m);
    assert.match(guards.stdout, /^# skipped 0$/m);
    assert.match(guards.stdout, new RegExp(`^# fail ${invalid ? 1 : 0}$`, "m"));
    if (invalid)
      assert.match(
        guards.stdout,
        /not ok \d+ - only a source-bound declaration or coordinated stamp selects the held workflow matrix/,
      );

    const before = f.git("status", "--porcelain");
    // Deliberately name only the actual inner file: never recursively run this matrix.
    const suite = f.execute(["--test", "--test-reporter=tap", contract]);
    assert.match(suite.stdout, /^# tests 40$/m, suite.stdout);
    assert.match(suite.stdout, /^# skipped 0$/m);
    assert.match(suite.stdout, /^# cancelled 0$/m);
    const cases = [...suite.stdout.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(
      cases.sort(),
      [...expectedCases].sort(),
      "All 40 original cases must run, not a subset/skip",
    );
    assert.equal(
      f.git("status", "--porcelain"),
      before,
      "Child suite must not hide/delete/change host inputs",
    );
    assert.equal(suite.status, 0, suite.stdout + suite.stderr);
    assert.match(suite.stdout, /^# pass 40$/m);
    assert.match(suite.stdout, /^# fail 0$/m);
    t.diagnostic(
      `${context}: all 40 inner cases pass without skips; host guards ${invalid ? "reject invalid source" : "pass"}`,
    );
  });
}
