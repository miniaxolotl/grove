import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("hosted quality CI requires the isolated operator regressions and lint", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const quality = workflow.split("\n  contracts-quality:")[1]?.split("\n  image:")[0];
  assert(quality, "The required contracts-quality job must exist");
  assert.match(quality, /pnpm exec eslint ops\/held-operator/);
  assert.match(quality, /for file in ops\/held-operator\/\*\.test\.mjs/);
  assert.match(quality, /\[\[ "\$file" != ops\/held-operator\/fixture\.test\.mjs \]\] \|\| continue/);
  assert.match(quality, /test "\$\{#operator_tests\[@\]\}" -gt 0/);
  assert.match(quality, /node --test --test-concurrency=1 "\$\{operator_tests\[@\]\}"/);
  assert.doesNotMatch(quality, /environment:\s*production|secrets\./);
});
