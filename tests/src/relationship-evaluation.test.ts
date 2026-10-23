import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as evaluation from "../../scripts/testing/relationship-evaluation.ts";
import { relationshipCases } from "../fixtures/relationship-quality.ts";

test("quality evaluation refuses requests beyond its explicit call budget", async () => {
  const module =
    await import("../../scripts/testing/relationship-evaluation.ts").catch(
      () => null,
    );
  assert(module, "Evaluation budget helper is required");
  assert.throws(() =>
    module.evaluationOptions(["--repeat=3", "--max-calls=10"], 38),
  );
  assert.throws(() => module.evaluationOptions(["--repeat=0"], 38));
  assert.deepEqual(
    module.evaluationOptions(["--repeat=3", "--max-calls=120"], 38),
    { repeat: 3, maxCalls: 120 },
  );
});

test("quality metrics separate false positives, missed positives and provider failures", async () => {
  const module =
    await import("../../scripts/testing/relationship-evaluation.ts").catch(
      () => null,
    );
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

test("quality request budgets count failed responses and fence concurrent retries before transport", async () => {
  const module = evaluation as unknown as {
    evaluationBudget: (limit: number) => {
      fetch: typeof fetch;
      readonly requests: number;
    };
  };
  assert.equal(typeof module.evaluationBudget, "function");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const budget = module.evaluationBudget(2);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        budget.fetch(`http://127.0.0.1:${address.port}`),
      ),
    );
    assert.equal(requests, 2);
    assert.equal(budget.requests, 2);
    assert.equal(
      outcomes.filter((result) => result.status === "fulfilled").length,
      2,
    );
    assert.equal(
      outcomes.filter((result) => result.status === "rejected").length,
      1,
    );
    await assert.rejects(
      budget.fetch(`http://127.0.0.1:${address.port}`),
      /evaluation_request_budget/,
    );
    assert.equal(requests, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("quality output is replaced atomically only after the complete report serializes", async () => {
  const module = evaluation as unknown as {
    writeEvaluationReport: (path: string, report: unknown) => Promise<void>;
  };
  assert.equal(typeof module.writeEvaluationReport, "function");
  const directory = await mkdtemp("/tmp/opencode/grove-quality-report-");
  const path = join(directory, "report.json");
  try {
    await writeFile(path, "previous complete report\n");
    await assert.rejects(
      module.writeEvaluationReport(path, { cannotSerialize: 1n }),
    );
    assert.equal(await readFile(path, "utf8"), "previous complete report\n");
    await module.writeEvaluationReport(path, { complete: true, cases: 38 });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      complete: true,
      cases: 38,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the live runner stops fatal transport failures across repetitions and preserves its last report", async () => {
  const directory = await mkdtemp("/tmp/opencode/grove-quality-runner-");
  const output = join(directory, "report.json");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(401).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    await writeFile(output, "previous complete report\n");
    let stdout = "";
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/testing/relationships.ts",
          "--live",
          "--repeat=3",
          `--max-calls=${relationshipCases.length * 3}`,
          `--output=${output}`,
        ],
        {
          cwd: resolve(import.meta.dirname, "../.."),
          env: {
            ...process.env,
            GENERATION_API_KEY: "synthetic-local-only",
            GENERATION_PROVIDER: "minimax",
            GENERATION_MODEL: "synthetic",
            GENERATION_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      (error: unknown) => {
        const result = error as { code: number; stdout: string };
        stdout = result.stdout;
        return result.code === 1;
      },
    );
    assert.equal(
      requests,
      1,
      "A fatal provider error must not repeat in later runs",
    );
    assert.equal(JSON.parse(stdout).complete, false);
    assert.equal(await readFile(output, "utf8"), "previous complete report\n");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("the live runner records actual requests and atomically saves a complete mismatched-label report", async () => {
  const directory = await mkdtemp("/tmp/opencode/grove-quality-complete-");
  const output = join(directory, "report.json");
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* drain the synthetic request */
    }
    requests++;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    name: "record_result",
                    arguments: JSON.stringify({
                      relationship: "unrelated",
                      basis: "none",
                      direction: "both",
                      reason: "",
                      evidence: [],
                      support: [],
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/testing/relationships.ts",
          "--live",
          `--max-calls=${relationshipCases.length}`,
          `--output=${output}`,
        ],
        {
          cwd: resolve(import.meta.dirname, "../.."),
          env: {
            ...process.env,
            GENERATION_API_KEY: "synthetic-local-only",
            GENERATION_PROVIDER: "minimax",
            GENERATION_MODEL: "synthetic",
            GENERATION_URL: `http://127.0.0.1:${address.port}`,
          },
        },
      ),
      (error: unknown) => (error as { code: number }).code === 1,
    );
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(requests, relationshipCases.length);
    assert.equal(report.requests, requests);
    assert.equal(report.provider, "minimax");
    assert.equal(report.model, "synthetic");
    assert.equal(report.complete, true);
    assert.equal(report.inputTokens, requests * 2);
    assert.equal(report.outputTokens, requests);
    assert(!JSON.stringify(report).includes("synthetic-local-only"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("the live runner refuses disabled or incompletely selected providers before sending credentials", async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(401).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    for (const provider of ["disabled", "openai-compatible"]) {
      await t.test(provider, async () => {
        requests = 0;
        await assert.rejects(
          promisify(execFile)(
            process.execPath,
            ["--import", "tsx", "scripts/testing/relationships.ts", "--live"],
            {
              cwd: resolve(import.meta.dirname, "../.."),
              env: {
                ...process.env,
                GENERATION_API_KEY: "synthetic-local-only",
                GENERATION_PROVIDER: provider,
                GENERATION_URL: `http://127.0.0.1:${address.port}`,
                GENERATION_MODEL:
                  provider === "disabled" ? "synthetic" : undefined,
              },
            },
          ),
        );
        assert.equal(
          requests,
          0,
          `${provider}: configuration must fail before network access`,
        );
      });
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
