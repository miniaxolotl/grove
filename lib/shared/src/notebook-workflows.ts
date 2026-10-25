import { z } from "zod";
import { sourceRefSchema } from "@lib/shared/models";
import { summaryEvidenceSchema } from "@lib/shared/summaries";

/** Shared product catalog, not a list of meeting templates or enabled features. */
export const notebookWorkflows = {
  weekly_review: {
    title: "Weekly review",
    description:
      "Review new ideas, changed decisions and unfinished actions for a week.",
    preference: "weeklyReviewEnabled",
  },
  meeting: {
    title: "Meeting preparation",
    description:
      "Prepare relevant decisions, previous discussions and open questions.",
    preference: "meetingPreparationEnabled",
  },
  study: {
    title: "Study mode",
    description:
      "Practice with source-linked quizzes, flashcards and explanations.",
    preference: "studyModeEnabled",
  },
  knowledge_gaps: {
    title: "Knowledge gaps",
    description:
      "Review unanswered questions and evidence not found in a notebook.",
    preference: "knowledgeGapsEnabled",
  },
  similar_problems: {
    title: "Similar past problems",
    description:
      "Find earlier solutions, recorded outcomes and important differences.",
    preference: "similarProblemsEnabled",
  },
} as const;
export type NotebookWorkflowKind = keyof typeof notebookWorkflows;

const selectedSources = z
  .array(sourceRefSchema)
  .min(1)
  .max(12)
  .refine(
    (refs) => new Set(refs.map((ref) => ref.id)).size === refs.length,
    "Select distinct notes",
  );
const sourceScope = {
  projectId: z.uuid().nullable(),
  sources: selectedSources.optional(),
};
const exactScope = (input: {
  projectId: string | null;
  sources?: unknown[];
}) => (input.sources ? input.projectId === null : input.projectId !== null);
const topic = z.string().trim().max(1000).default("");

export const meetingWorkflowRequestSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("meeting"),
    title: z.string().trim().min(1).max(120),
    agenda: z.string().trim().min(1).max(1000),
    meetingDate: z.iso.date().optional(),
    ...sourceScope,
  })
  .strict()
  .refine(exactScope, "Choose selected notes or one notebook");

export const weeklyReviewRequestSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("weekly_review"),
    projectId: z.uuid(),
    weekStart: z.iso
      .date()
      .refine(
        (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 1,
        "Choose a Monday",
      ),
    timeZone: z
      .string()
      .min(1)
      .max(80)
      .refine((timeZone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone });
          return true;
        } catch {
          return false;
        }
      }, "Choose a supported IANA timezone"),
  })
  .strict();
export const studyRequestSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("study"),
    ...sourceScope,
    topic,
    format: z.enum(["quiz", "flashcards", "explanations"]),
  })
  .strict()
  .refine(exactScope, "Choose selected notes or one notebook");
export const knowledgeGapsRequestSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("knowledge_gaps"),
    projectId: z.uuid(),
    topic,
  })
  .strict();
export const similarProblemsRequestSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("similar_problems"),
    projectId: z.uuid(),
    problem: z.string().trim().min(1).max(1000),
  })
  .strict();

export const notebookWorkflowRequestSchema = z.discriminatedUnion("kind", [
  weeklyReviewRequestSchema,
  meetingWorkflowRequestSchema,
  studyRequestSchema,
  knowledgeGapsRequestSchema,
  similarProblemsRequestSchema,
]);
export type NotebookWorkflowRequest = z.infer<
  typeof notebookWorkflowRequestSchema
>;
export function workflowQuery(input: NotebookWorkflowRequest): string {
  switch (input.kind) {
    case "meeting":
      return `${input.title} ${input.agenda}`;
    case "study":
    case "knowledge_gaps":
      return input.topic;
    case "similar_problems":
      return input.problem;
    case "weekly_review":
      return ""; // Calendar evidence is selected by its window, not agenda relevance.
  }
}

const evidence = z.array(summaryEvidenceSchema).min(1).max(2);
const citedItem = z
  .object({ text: z.string().trim().min(1).max(240), sources: evidence })
  .strict();
export const studySetSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            prompt: z.string().trim().min(1).max(240),
            answer: z.string().trim().min(1).max(400),
            explanation: z.string().trim().min(1).max(600),
            sources: evidence,
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const weeklyReviewSchema = z
  .object({
    ideas: z.array(citedItem).max(4),
    decisions: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(240),
            before: evidence,
            after: evidence,
          })
          .strict(),
      )
      .max(4),
    openActions: z.array(citedItem).max(4),
  })
  .strict();

export const knowledgeGapsSchema = z
  .object({
    findings: z
      .array(
        citedItem
          .extend({
            kind: z.enum(["unanswered_question", "missing_evidence"]),
            scope: z.literal("not_found_in_reviewed_evidence"),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
const outcomeSchema = z
  .object({
    status: z.enum(["tested", "proposed", "failed", "unknown"]),
    evidence: z.array(summaryEvidenceSchema).max(2),
  })
  .strict()
  .refine(
    (outcome) => outcome.status === "unknown" || outcome.evidence.length > 0,
    "Recorded outcomes require supporting evidence",
  );
export const pastProblemsSchema = z
  .object({
    matches: z
      .array(
        z
          .object({
            problem: citedItem,
            solution: citedItem,
            outcome: outcomeSchema,
            similarities: z.array(citedItem).min(1).max(3),
            differences: z.array(citedItem).max(3),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

/** Retrieval accepts explicit scope and search text, never a meeting-specific input. */
export type WorkflowEvidenceInput = {
  projectId: string | null;
  sources?: z.infer<typeof selectedSources>;
  query: string;
};
