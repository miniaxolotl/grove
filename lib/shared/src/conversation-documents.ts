import { z } from "zod";

export const documentStatementSchema = z
  .object({
    text: z.string().trim().min(1).max(900),
    sources: z
      .array(
        z
          .object({
            id: z.uuid(),
            version: z.number().int().positive(),
            quote: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type DocumentStatement = z.infer<typeof documentStatementSchema>;
export type ConversationDocument = {
  id: string;
  filename: string;
  bytes: number;
  status: "pending" | "ready" | "failed";
  error: string | null;
  pages: number | null;
  emptyPages: number[];
  accepted: boolean;
  taskId: string;
  retryable?: boolean;
};
export type DocumentSource = {
  id: string;
  version: number;
  documentId: string;
  filename: string;
  ordinal: number;
  content: string;
  pageStart: number;
  pageEnd: number;
  sourceStart: number;
  sourceEnd: number;
};
export type DocumentEvidence = {
  version: number;
  sources: DocumentSource[];
  documents: { id: string; version: number }[];
  shown: number;
  total: number;
  partial: boolean;
};
export type DocumentList = {
  version: number;
  documents: ConversationDocument[];
};
export const documentAcceptanceSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export const documentConversionSchema = documentAcceptanceSchema.extend({
  id: z.uuid(),
});
