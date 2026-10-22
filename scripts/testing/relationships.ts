import {
  createGenerationProvider,
  InferenceError,
} from "../../lib/ai/src/index.ts";
import { generationConfigSchema } from "../../lib/shared/src/models.ts";
import {
  groundRelationship,
  normalizeRelationshipAssessment,
  noteRelationshipInstructions,
  notebookRelationshipInstructions,
  noteAssessmentSchema,
  notebookAssessmentSchema,
  type RelationshipAssessment,
  type ConnectionSource,
} from "../../lib/shared/src/relationships.ts";
import { relationshipCases } from "../../tests/fixtures/relationship-quality.ts";

if (!process.argv.includes("--live") || !process.env.GENERATION_API_KEY)
  throw new Error(
    "Use --live with GENERATION_API_KEY for the bounded synthetic-only evaluation",
  );
const provider = createGenerationProvider(
  generationConfigSchema.parse({
    provider: "minimax",
    baseUrl: process.env.GENERATION_URL ?? "https://api.minimax.io/v1",
    model: process.env.GENERATION_MODEL ?? "MiniMax-M3.1-Flash",
    apiKey: process.env.GENERATION_API_KEY,
    timeoutMs: 60000,
    maxOutputTokens: 4096,
  }),
);
const results = [];
let generated: unknown;
const send = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await send(...args);
  const body = (await response.clone().json()) as {
    choices?: {
      message?: { tool_calls?: { function?: { arguments?: string } }[] };
    }[];
  };
  generated = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return response;
};
for (const fixture of relationshipCases) {
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
  generated = undefined;
  try {
    assessment = await provider.generate<RelationshipAssessment>(
      fixture.level === "note"
        ? noteAssessmentSchema
        : notebookAssessmentSchema,
      `${fixture.level === "note" ? noteRelationshipInstructions : notebookRelationshipInstructions}\nLEFT source IDs: ${left.map((s) => s.id).join(", ")}. RIGHT source IDs: ${right.map((s) => s.id).join(", ")}. Examining all supplied notes.`,
      [...left, ...right].map((s) => ({ ...s, kind: "fact" })),
    );
    assessment = normalizeRelationshipAssessment(assessment);
    const evidence = groundRelationship(assessment, fixture.level, left, right);
    results.push({
      name: fixture.name,
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
      pass: false,
      error: e instanceof InferenceError ? e.code : "invalid_evidence",
      assessment,
      generated,
    });
    if (e instanceof InferenceError && !e.retryable) break;
  }
}
console.log(
  JSON.stringify(
    {
      profile: provider.profile,
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
