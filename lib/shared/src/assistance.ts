import { z } from "zod";
import { sourceRefSchema, type SourceRef } from "@lib/shared/models";
import { summaryEvidenceSchema } from "@lib/shared/summaries";

export const assistancePreferences = {
  filing: "filingEnabled",
  actions: "actionListsEnabled",
  digest: "digestsEnabled",
  cleanup: "cleanupEnabled",
} as const;
export type AssistanceKind = keyof typeof assistancePreferences;
const selected = z
  .array(sourceRefSchema)
  .min(1)
  .max(6)
  .refine(
    (refs) => new Set(refs.map((r) => r.id)).size === refs.length,
    "Select distinct notes",
  );
export const assistanceRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.uuid(),
      kind: z.literal("filing"),
      sources: selected.max(1),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      kind: z.literal("actions"),
      sources: selected,
      projectId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      kind: z.literal("digest"),
      visitId: z.uuid(),
      after: z.uuid().optional(),
    })
    .strict(),
  z
    .object({ id: z.uuid(), kind: z.literal("cleanup"), projectId: z.uuid() })
    .strict(),
]);
export type AssistanceRequest = z.infer<typeof assistanceRequestSchema>;
export const actionListSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(240),
            sources: z.array(summaryEvidenceSchema).min(1).max(2),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const filingSchema = z
  .object({
    destination: z.array(z.uuid()).max(1),
    reason: z.string().trim().max(300),
    evidence: z.array(summaryEvidenceSchema).max(4),
  })
  .strict();
export type ActionItem = z.infer<typeof actionListSchema>["items"][number];
export const digestSummarySchema = z
  .object({
    items: z
      .array(
        actionListSchema.shape.items.element.extend({
          kind: z.enum(["new", "change", "decision", "open_action"]),
        }),
      )
      .max(12),
  })
  .strict();
export type FilingResult = z.infer<typeof filingSchema> & { name?: string };
export const cleanupAssessmentSchema = z
  .object({
    kind: z.enum(["duplicate", "conflicting", "superseded", "unrelated"]),
    reason: z.string().trim().max(400),
    evidence: z.array(summaryEvidenceSchema).max(4),
    replacement: z.array(z.uuid()).max(1),
    content: z.string().trim().max(6000),
  })
  .strict();
export type CleanupCandidate = z.infer<typeof cleanupAssessmentSchema> & {
  key: string;
  sources: SourceRef[];
  target: SourceRef;
  before: string;
  dismissed: boolean;
  reviewVersion: number;
};
export type DigestChange = {
  id: string;
  kind: string;
  before: number | null;
  after: number | null;
  at: string;
  title: string;
  beforeContent: string | null;
  afterContent: string | null;
};
export type AssistanceResult = {
  coverage: { total: number; examined: number };
  filing?: FilingResult;
  items?: ActionItem[];
  candidates?: CleanupCandidate[];
  changes?: DigestChange[];
  summary?: z.infer<typeof actionListSchema>;
  nextCursor?: string | null;
};
export type Assistance = {
  id: string;
  kind: AssistanceKind;
  status: "pending" | "ready" | "failed" | "stale" | "applied" | "undone";
  version: number;
  result: AssistanceResult | null;
  error: string | null;
  applied: SourceRef[];
  progress: number;
};
export const assistanceApplySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    candidate: z.string().max(128).optional(),
    action: z.enum(["combine", "update"]).optional(),
    edits: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(11),
            text: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .max(12)
      .optional(),
  })
  .strict();
export type AssistanceApply = z.infer<typeof assistanceApplySchema>;
export const assistanceReviewSchema = z
  .object({
    candidate: z.string().max(128),
    expectedVersion: z.number().int().min(0),
    dismissed: z.boolean(),
  })
  .strict();
export type AssistanceReview = z.infer<typeof assistanceReviewSchema>;
export const notebookVisitSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    token: z.string().regex(/^\d+$/).max(20),
    from: z.string().regex(/^\d+$/).max(20).nullable(),
  })
  .strict();
export type NotebookVisitRequest = z.infer<typeof notebookVisitSchema>;
export type NotebookVisit = {
  id: string;
  projectId: string;
  from: string;
  to: string;
  baseline: boolean;
  at: string;
};
