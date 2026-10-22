import { z } from "zod";
import { sourceRefSchema, type BriefContent } from "@lib/shared/models";

export const summaryEvidenceSchema = sourceRefSchema.extend({
  quote: z.string().trim().min(1).max(600),
});
export const notebookSummarySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(80),
            statements: z
              .array(
                z
                  .object({
                    text: z.string().trim().min(1).max(500),
                    sources: z.array(summaryEvidenceSchema).min(1).max(2),
                  })
                  .strict(),
              )
              .max(3),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type NotebookSummary = z.infer<typeof notebookSummarySchema>;
export type SummaryEvidence = z.infer<typeof summaryEvidenceSchema>;
export type SummaryCoverage = {
  total: number;
  examined: number;
  cited: number;
};

export function summaryContent(value: NotebookSummary): BriefContent {
  return {
    title: value.title,
    sections: value.sections.map((section) => ({
      ...section,
      statements: section.statements.map((statement) => ({
        ...statement,
        sources: statement.sources.map(({ id, version }) => ({ id, version })),
      })),
    })),
  };
}
