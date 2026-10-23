import assert from "node:assert/strict";
import { test } from "node:test";

test("quality evaluation refuses requests beyond its explicit call budget", async () => {
  const module = await import("../../scripts/testing/relationship-evaluation.ts").catch(() => null);
  assert(module, "Evaluation budget helper is required");
  assert.throws(() => module.evaluationOptions(["--repeat=3", "--max-calls=10"], 38));
  assert.throws(() => module.evaluationOptions(["--repeat=0"], 38));
  assert.deepEqual(module.evaluationOptions(["--repeat=3", "--max-calls=120"], 38), { repeat: 3, maxCalls: 120 });
});

test("quality metrics separate false positives, missed positives and provider failures", async () => {
  const module = await import("../../scripts/testing/relationship-evaluation.ts").catch(() => null);
  assert(module, "Evaluation metrics helper is required");
  const result = module.relationshipMetrics([
    { expected: ["complementary"], actual: "complementary" },
    { expected: ["unrelated"], actual: "complementary" },
    { expected: ["complementary"], actual: "unrelated" },
    { expected: ["duplicate"], error: "provider_timeout" },
  ]);
  assert.equal(result.errors, 1);
  assert.equal(result.byLabel.complementary.precision, 0.5);
  assert.equal(result.byLabel.complementary.recall, 0.5);
});
