import assert from "node:assert/strict";
import test from "node:test";
import {
  cpSync,
  existsSync,
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

const root = process.cwd(),
  decisionPath = "scripts/release/held-decision.json";
const contexts = ["source", "accepted-merge", "stamp-source", "stamped-merge"];
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "grove-held-contract-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(
      join(cwd, path),
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
  };
  for (const directory of ["scripts/release", "scripts/ci"])
    cpSync(resolve(root, directory), join(cwd, directory), {
      recursive: true,
      filter: (path) =>
        ![decisionPath, "scripts/release/decision.json"].some(
          (decision) => path === resolve(root, decision),
        ),
    });
  for (const path of [decisionPath, "scripts/release/decision.json"])
    assert.equal(
      existsSync(join(cwd, path)),
      false,
      "Synthetic baseline must not inherit host authorization",
    );
  for (const path of [
    ".github/workflows/deploy.yml",
    "package.json",
    ".release-please-manifest.json",
    "release-please-config.json",
  ]) {
    write(path, readFileSync(resolve(root, path), "utf8"));
  }
  const config = JSON.parse(
    readFileSync(join(cwd, "release-please-config.json")),
  ).packages["."];
  for (const { path } of config["extra-files"])
    write(path, readFileSync(resolve(root, path), "utf8"));
  const setVersion = (version) => {
    for (const [path, keys] of [
      ["package.json", ["version"]],
      [".release-please-manifest.json", ["."]],
      ...config["extra-files"].map(({ path, jsonpath }) => [
        path,
        jsonpath.slice(2).replace("[0]", ".0").split("."),
      ]),
    ]) {
      const value = JSON.parse(readFileSync(join(cwd, path)));
      let cursor = value;
      for (const key of keys.slice(0, -1)) cursor = cursor[key];
      cursor[keys.at(-1)] = version;
      write(path, value);
    }
  };
  // These synthetic histories always exercise 1.11.29 -> 1.11.30, even when
  // the real hosting checkout is already stamped at a later product version.
  setVersion("1.11.29");
  write("CHANGELOG.md", "# Fixture changelog\n");
  write("fixture.txt", cwd);
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    LANG: "C.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
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
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  const seed = commit("chore: fixture seed");
  write("fixture.txt", `${cwd}\nbaseline\n`);
  const baseline = commit("fix: fixture baseline");
  git("tag", "v1.11.29");
  write(".git/info/exclude", ".fixture-bin/\nscope-output\n");
  // Only the historical and exact operational read-only route lookups are supported. Any other
  // credential/provider/provenance command fails instead of reaching the network.
  write(
    ".fixture-bin/gh",
    `#!${process.execPath}\nconst args=process.argv.slice(2);if(args.length!==2||args[0]!=="api"||!/^repos\\/miniaxolotl\\/grove\\/pulls\\/(293|303|337|340|343)$/.test(args[1]))process.exit(90);console.log(JSON.stringify({number:Number(args[1].split("/").at(-1)),merged:false,head:{ref:"fixture-unselected"}}));\n`,
  );
  execFileSync("chmod", ["+x", join(cwd, ".fixture-bin/gh")]);
  const execute = (args) =>
    spawnSync(process.execPath, args, {
      cwd,
      env: {
        ...env,
        PATH: `${join(cwd, ".fixture-bin")}:${env.PATH}`,
        GITHUB_OUTPUT: join(cwd, "scope-output"),
      },
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    });
  const declaration = {
    schema: 1,
    mode: "held-publication-only",
    anchor: baseline,
    app: "11111111-1111-4111-8111-111111111111",
    previousDigest: `sha256:${"a".repeat(64)}`,
  };
  const stamp = () => {
    setVersion("1.11.30");
    write(
      "CHANGELOG.md",
      "# Fixture changelog\n\n## 1.11.30\n\nFixture stamp.\n",
    );
  };
  const build = (context, mutation = () => {}) => {
    git("checkout", "-qb", "declaration", baseline);
    mutation("declaration");
    const source = commit("chore(release): fixture declaration");
    if (context === "source") return source;
    git("checkout", "-q", "development");
    git(
      "merge",
      "--no-ff",
      "-qm",
      "chore(release): accept fixture declaration",
      source,
    );
    const accepted = git("rev-parse", "HEAD");
    if (context === "accepted-merge") return accepted;
    git("checkout", "-qb", "stamp");
    stamp();
    mutation("stamp");
    const stamped = commit("chore(release): release 1.11.30");
    if (context === "stamp-source") return stamped;
    git("checkout", "-q", "development");
    git(
      "merge",
      "--no-ff",
      "-qm",
      "chore(release): accept fixture stamp",
      stamped,
    );
    return git("rev-parse", "HEAD");
  };
  const check = (context) => {
    const source = git("rev-parse", "HEAD"),
      released = context.includes("stamp");
    const resolver = execute([
      "--input-type=module",
      "-e",
      `import{resolveHeldDecision}from'./scripts/release/held-delivery.mjs';console.log(JSON.stringify(resolveHeldDecision(process.argv[1],process.argv[2]==="true")));`,
      source,
      String(released),
    ]);
    const tests = execute(["--test", "scripts/release/held-workflow.test.mjs"]);
    const route = execute([
      "scripts/release/proofing-release.mjs",
      source,
      ...(released ? ["released"] : []),
    ]);
    for (const result of [resolver, tests, route]) {
      assert.ifError(result.error);
      assert.equal(
        result.signal,
        null,
        "A killed/timed-out child is not a semantic rejection",
      );
      assert(
        [0, 1].includes(result.status),
        "Unexpected subprocess failure is not an admission result",
      );
    }
    let output = "";
    try {
      output = readFileSync(join(cwd, "scope-output"), "utf8");
    } catch {
      /* No output is expected when admission is rejected. */
    }
    return { resolver, tests, route, output, source };
  };
  return { cwd, write, git, commit, seed, baseline, declaration, build, check };
}
for (const context of contexts) {
  test(`actual ${context} test/entrypoints keep an absent declaration unselected`, (t) => {
    const f = fixture(t);
    f.build(context, (phase) => {
      if (phase === "declaration")
        f.write("fixture.txt", "ordinary source, no declaration\n");
    });
    const r = f.check(context);
    assert.equal(r.resolver.status, 0, r.resolver.stderr);
    assert.equal(r.resolver.stdout.trim(), "null");
    assert.equal(r.tests.status, 0, r.tests.stdout + r.tests.stderr);
    assert.equal(r.route.status, 0, r.route.stderr);
    assert.match(r.output, /mode=website-only/);
    assert.doesNotMatch(r.output, /held=true|mode=coordinated/);
  });
  test(`actual ${context} test/entrypoints accept only a valid source-bound held declaration`, (t) => {
    const f = fixture(t);
    f.build(context, (phase) => {
      if (phase === "declaration") f.write(decisionPath, f.declaration);
    });
    const r = f.check(context);
    assert.equal(r.resolver.status, 0, r.resolver.stderr);
    assert.deepEqual(JSON.parse(r.resolver.stdout).manifest, f.declaration);
    assert.equal(r.tests.status, 0, r.tests.stdout + r.tests.stderr);
    assert.equal(r.route.status, 0, r.route.stderr);
    assert.match(r.output, /mode=coordinated/);
    assert.match(r.output, /config=release-please-config.json/);
    assert.match(r.output, /held=true/);
    assert.match(r.output, /checker=false/);
  });
  for (const invalid of [
    "malformed",
    "extra-edit",
    "wrong-anchor",
    "foreign-decision",
    "mixed-decisions",
  ]) {
    test(`actual ${context} rejects ${invalid} in both the test and production entrypoint`, (t) => {
      const f = fixture(t);
      const foreign = invalid === "foreign-decision" ? fixture(t) : null;
      f.build(context, (phase) => {
        if (phase !== "declaration") return;
        f.write(
          decisionPath,
          invalid === "malformed"
            ? '{"schema":'
            : {
                ...f.declaration,
                ...(invalid === "wrong-anchor"
                  ? { anchor: f.seed }
                  : invalid === "foreign-decision"
                    ? { anchor: foreign.baseline }
                    : {}),
              },
        );
        if (invalid === "extra-edit")
          f.write("unreviewed.txt", "not declaration metadata\n");
        if (invalid === "mixed-decisions")
          f.write("scripts/release/decision.json", {
            schema: 1,
            candidate: f.baseline,
            predecessor: {
              tag: "v1.11.29",
              source: f.baseline,
              production: f.baseline,
            },
            deliver: ["service"],
            publish: [],
            topology: "existing",
            receipts: JSON.parse(
              readFileSync(join(root, "scripts/release/impact-receipts.json")),
            ).targets,
            reviewedInputs: {},
          });
      });
      const r = f.check(context);
      assert.notEqual(r.resolver.status, 0, `${invalid} unexpectedly resolved`);
      assert.notEqual(
        r.tests.status,
        0,
        `${invalid} unexpectedly passed the actual workflow test`,
      );
      assert.notEqual(
        r.route.status,
        0,
        `${invalid} unexpectedly entered a production route`,
      );
      assert.doesNotMatch(r.output, /held=true/);
    });
  }
}
for (const context of contexts.filter((name) => name.includes("stamp"))) {
  for (const invalid of [
    "changed-decision",
    "uncoordinated-pin",
    "extra-stamp-edit",
  ]) {
    test(`actual ${context} rejects ${invalid} instead of accepting any present file`, (t) => {
      const f = fixture(t);
      f.build(context, (phase) => {
        if (phase === "declaration") f.write(decisionPath, f.declaration);
        else if (invalid === "changed-decision")
          f.write(decisionPath, {
            ...f.declaration,
            app: "22222222-2222-4222-8222-222222222222",
          });
        else if (invalid === "uncoordinated-pin") {
          const path = "packages/api/package.json",
            value = JSON.parse(readFileSync(join(f.cwd, path)));
          value.version = "1.11.29";
          f.write(path, value);
        } else f.write("unreviewed-stamp.txt", "not a coordinated stamp\n");
      });
      const r = f.check(context);
      assert.notEqual(r.resolver.status, 0);
      assert.notEqual(r.tests.status, 0);
      assert.notEqual(r.route.status, 0);
      assert.doesNotMatch(r.output, /held=true/);
    });
  }
}
for (const target of [
  "deploy",
  "website",
  "provider-post",
  "unselected-pending",
]) {
  test(`actual workflow mutation control detects a removed ${target} exclusion`, (t) => {
    const f = fixture(t);
    f.build("source", (phase) => {
      if (phase === "declaration")
        f.write(
          target === "unselected-pending" ? "fixture.txt" : decisionPath,
          target === "unselected-pending"
            ? "unselected fixture\n"
            : f.declaration,
        );
    });
    const path = ".github/workflows/deploy.yml",
      original = readFileSync(join(f.cwd, path), "utf8");
    const marker =
      target === "provider-post"
        ? "      - name: Validate the admitted topology before npm publication\n"
        : target === "unselected-pending"
          ? "      - name: Persist pending held publication before irreversible writes\n"
          : `\n  ${target}:\n`;
    const start = original.indexOf(marker);
    assert(start > 0);
    const tail = original.slice(start),
      condition =
        target === "unselected-pending"
          ? "needs.candidate.outputs.held == 'true'"
          : "needs.candidate.outputs.held != 'true'";
    assert(tail.includes(condition));
    f.write(path, original.slice(0, start) + tail.replace(condition, "true"));
    // Mutate only the disposable working workflow, not its committed declaration:
    // source admission must stay valid while the actual exclusion tests fail.
    const r = f.check("source");
    assert.equal(r.resolver.status, 0, r.resolver.stderr);
    assert.equal(r.route.status, 0, r.route.stderr);
    assert.notEqual(
      r.tests.status,
      0,
      `${target} guard removal escaped the actual workflow test`,
    );
  });
}
for (const context of ["source", "accepted-merge"]) {
  test(`an ordinary commit inheriting a ${context} declaration cannot activate held delivery`, (t) => {
    const f = fixture(t);
    f.build(context, (phase) => {
      if (phase === "declaration") f.write(decisionPath, f.declaration);
    });
    f.write("fixture.txt", "later ordinary source, not a stamp\n");
    f.commit("fix: later fixture source");
    const r = f.check("source");
    assert.notEqual(r.resolver.status, 0);
    assert.notEqual(r.tests.status, 0);
    assert.notEqual(r.route.status, 0);
    assert.doesNotMatch(r.output, /held=true/);
  });
}
