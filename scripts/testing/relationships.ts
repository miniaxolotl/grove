import {
  createGenerationProvider,
  InferenceError,
} from "../../lib/ai/src/index.ts";
import { generationConfigSchema } from "../../lib/shared/src/models.ts";
import {
  groundRelationship,
  assessRelationship,
  noteRelationshipInstructions,
  notebookRelationshipInstructions,
  noteAssessmentSchema,
  notebookAssessmentSchema,
  type RelationshipAssessment,
  type RelationshipJudgment,
  type ConnectionSource,
} from "../../lib/shared/src/relationships.ts";
import { relationshipCases } from "../../tests/fixtures/relationship-quality.ts";
import { evaluationOptions, relationshipMetrics } from "./relationship-evaluation.ts";

if (!process.argv.includes("--live") || !process.env.GENERATION_API_KEY)
  throw new Error(
    "Use --live with GENERATION_API_KEY for the bounded synthetic-only evaluation",
  );
const provider = createGenerationProvider(
  generationConfigSchema.parse({
    provider: process.env.GENERATION_PROVIDER ?? "minimax",
    baseUrl: process.env.GENERATION_URL ?? "https://api.minimax.io/v1",
    model: process.env.GENERATION_MODEL ?? "MiniMax-M3.1-Flash",
    apiKey: process.env.GENERATION_API_KEY,
    timeoutMs: 60000,
    maxOutputTokens: 4096,
  }),
);
const split = process.argv.find((s) => s.startsWith("--split="))?.split("=")[1];
if (split && !["development", "held-out"].includes(split)) throw new Error("Unknown split");
const selected = relationshipCases.filter((c) => !split || (c.split ?? "development") === split);
const { repeat, maxCalls } = evaluationOptions(process.argv, selected.length);
const results: Array<{
  name: string; domain: string; split: string; run: number; pass: boolean;
  expected: RelationshipAssessment["relationship"][];
  actual?: RelationshipAssessment["relationship"];
  error?: string;
  [key: string]: unknown;
}> = [];
let inputTokens = 0, outputTokens = 0;
const started = performance.now();
for (let run = 1; run <= repeat; run++) for (const fixture of selected) {
  const sources = (texts: string[], side: number): ConnectionSource[] =>
    texts.map((content, i) => ({
      id: `00000000-0000-4000-8000-${String(side * 100 + i).padStart(12, "0")}`,
      version: 1,
      title: "Synthetic source",
      content,
      projectId:
        fixture.level === "note"
          ? null
          : `00000000-0000-4000-8000-${String(side).padStart(12, "0")}`,
    }));
  const left = sources(fixture.left, 1),
    right = sources(fixture.right, 2);
  let assessment: RelationshipAssessment | undefined;
  try {
    const judgment = await provider.generate<RelationshipJudgment>(
      fixture.level === "note"
        ? noteAssessmentSchema
        : notebookAssessmentSchema,
      `${fixture.level === "note" ? noteRelationshipInstructions : notebookRelationshipInstructions}\nLEFT source IDs: ${left.map((s) => s.id).join(", ")}. RIGHT source IDs: ${right.map((s) => s.id).join(", ")}. Examining all supplied notes.`,
      [...left, ...right].map(({ id, version, content }) => ({ id, version, content, kind: "fact" })),
      { onUsage: (usage) => { inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; } },
    );
    assessment = assessRelationship(judgment, fixture.level, left, right);
    const evidence = groundRelationship(assessment, fixture.level, left, right);
    results.push({
      name: fixture.name,
      domain: fixture.domain ?? "general", split: fixture.split ?? "development", run,
      expected: fixture.expected,
      actual: assessment.relationship,
      pass: fixture.expected.includes(assessment.relationship),
      reason: assessment.reason,
      basis: assessment.basis,
      direction: assessment.direction,
      evidence,
    });
  } catch (e) {
    results.push({
      name: fixture.name,
      domain: fixture.domain ?? "general", split: fixture.split ?? "development", run,
      expected: fixture.expected,
      pass: false,
      error: e instanceof InferenceError ? e.code : "invalid_evidence",
      assessment,
    });
    if (e instanceof InferenceError && !e.retryable) break;
  }
}
console.log(
  JSON.stringify(
    {
      profile: provider.profile,
      maxCalls, repeat, inputTokens, outputTokens, durationMs: Math.round(performance.now() - started),
      metrics: relationshipMetrics(results),
      domains: Object.fromEntries([...new Set(results.map((r) => r.domain))].map((domain) => [domain, relationshipMetrics(results.filter((r) => r.domain === domain))])),
      cases: results.length,
      passed: results.filter((r) => r.pass).length,
      abstentions: results.filter((r) => r.actual === "unrelated").length,
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
