import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import type { RelationshipAssessment } from "../../lib/shared/src/relationships.ts";

type Label = RelationshipAssessment["relationship"];
export function evaluationBudget(
  limit: number,
  send: typeof fetch = globalThis.fetch,
) {
  assert(
    Number.isInteger(limit) && limit >= 1 && limit <= 200,
    "Invalid request budget",
  );
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    fetch: (async (...args) => {
      if (requests >= limit) throw new Error("evaluation_request_budget");
      requests++;
      return send(...args);
    }) as typeof fetch,
  };
}

export async function writeEvaluationReport(path: string, report: unknown) {
  const serialized = JSON.stringify(report, null, 2);
  assert(serialized !== undefined, "Report must serialize to JSON");
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${serialized}\n`);
    await file.close();
    await rename(temporary, path);
  } finally {
    await file.close();
    await rm(temporary, { force: true });
  }
}

export function evaluationOptions(args: string[], cases: number) {
  const repeat = Number(
    args.find((s) => s.startsWith("--repeat="))?.split("=")[1] ?? 1,
  );
  const maxCalls = Number(
    args.find((s) => s.startsWith("--max-calls="))?.split("=")[1] ?? 50,
  );
  assert(
    Number.isInteger(repeat) && repeat >= 1 && repeat <= 3,
    "repeat must be 1–3",
  );
  assert(
    Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 200,
    "max-calls must be 1–200",
  );
  assert(
    cases > 0 && cases * repeat <= maxCalls,
    "Selected cases exceed the explicit call budget",
  );
  return { repeat, maxCalls };
}

export function relationshipMetrics(
  results: { expected: Label[]; actual?: Label; error?: string }[],
) {
  const labels: Label[] = [
    "complementary",
    "connected",
    "conflicting",
    "duplicate",
    "unrelated",
  ];
  return {
    cases: results.length,
    errors: results.filter((r) => r.error).length,
    correct: results.filter((r) => r.actual && r.expected.includes(r.actual))
      .length,
    byLabel: Object.fromEntries(
      labels.map((label) => {
        const predicted = results.filter((r) => r.actual === label);
        const required = results.filter(
          (r) => r.expected.length === 1 && r.expected[0] === label,
        );
        return [
          label,
          {
            predicted: predicted.length,
            required: required.length,
            precision: predicted.length
              ? predicted.filter((r) => r.expected.includes(label)).length /
                predicted.length
              : null,
            recall: required.length
              ? required.filter((r) => r.actual === label).length /
                required.length
              : null,
          },
        ];
      }),
    ) as Record<
      Label,
      {
        predicted: number;
        required: number;
        precision: number | null;
        recall: number | null;
      }
    >,
  };
}
