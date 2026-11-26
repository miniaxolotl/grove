import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
const module = await import("./held-operator-bootstrap.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});

test("source configuration cannot leave the verified bundle's admitted-source resolution graph", () => {
  assert.equal(typeof module.assertBundledSource, "function");
  const root = "/opt/reviewed/ops/held-operator";
  module.assertBundledSource(root, "/opt/reviewed/admitted-source");
  for (const source of [
    "/opt/other/admitted-source",
    "/var/lib/operator/matching-source-with-writable-dependencies",
    "/opt/reviewed",
  ])
    assert.throws(
      () => module.assertBundledSource(root, source),
      /BUNDLED_SOURCE_REQUIRED/,
    );
});

test("unchanged pinned OS files do not admit a changed Python launch resolution", async () => {
  const root = await mkdtemp(process.cwd() + "/.python-launch-pin-");
  try {
    const code = "export const fixtureOnly = true;\n";
    const reviewedPython = await realpath("/usr/bin/false");
    assert.notEqual(await realpath("/usr/bin/python3"), reviewedPython);
    await writeFile(root + "/operator-plan.mjs", code);
    const closure = JSON.stringify({
      schema: 1,
      files: { "operator-plan.mjs": hash(code) },
      toolFiles: [
        { path: reviewedPython, sha256: hash(await readFile(reviewedPython)) },
      ],
      tools: { pythonPath: reviewedPython },
    });
    await writeFile(root + "/qualified-code.json", closure);
    await assert.rejects(
      module.verifyOperatorRoot(
        root,
        { schema: 1, closureSha256: hash(closure) },
        { fixtureOnly: true },
      ),
      /PYTHON_LAUNCH_DRIFT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const hash = (b) => createHash("sha256").update(b).digest("hex");
test("trusted bootstrap rejects unpinned/tampered executable roots before importing their claimed manifest", async () => {
  assert.equal(typeof module.verifyOperatorRoot, "function");
  const root = await mkdtemp(process.cwd() + "/.operator-bootstrap-");
  try {
    const code = 'throw new Error("UNTRUSTED_CODE_EXECUTED");\n';
    await writeFile(root + "/operator-plan.mjs", code);
    const closure = JSON.stringify({
      schema: 1,
      files: { "operator-plan.mjs": hash(code) },
    });
    await writeFile(root + "/qualified-code.json", closure);
    await assert.rejects(
      module.verifyOperatorRoot(root, { schema: 1, closureSha256: null }),
      /NOT_PINNED/,
    );
    await module.verifyOperatorRoot(
      root,
      { schema: 1, closureSha256: hash(closure) },
      { fixtureOnly: true },
    );
    await assert.rejects(
      module.verifyOperatorRoot(root, {
        schema: 1,
        closureSha256: hash(closure),
      }),
      /IMMUTABLE/,
    );
    await writeFile(root + "/operator-plan.mjs", code + "// tampered");
    await assert.rejects(
      module.verifyOperatorRoot(
        root,
        { schema: 1, closureSha256: hash(closure) },
        { fixtureOnly: true },
      ),
      /CODE_DRIFT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
