import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
const module = await import("./held-operator-bootstrap.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
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
