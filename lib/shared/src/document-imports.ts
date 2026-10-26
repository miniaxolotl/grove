import { z } from "zod";
import { summaryEvidenceSchema } from "@lib/shared/summaries";

export const documentImportLimits = {
  files: 25,
  bytes: 3 * 1024 * 1024,
  notes: 500,
} as const;
export const importDestinationSchema = z.union([
  z
    .object({ projectId: z.uuid(), version: z.number().int().positive() })
    .strict(),
  z
    .object({
      name: z.string().trim().min(1).max(100),
      parentId: z.uuid().nullable().default(null),
    })
    .strict(),
  z.null(),
]);
export type ImportDestination = z.infer<typeof importDestinationSchema>;
export const importBatchCreateSchema = z.object({ id: z.uuid() }).strict();
export const importDraftEditSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    content: z.string().trim().min(1).max(6000).optional(),
    included: z.boolean().optional(),
    destination: importDestinationSchema.optional(),
  })
  .strict();
export const importBatchConfirmSchema = z
  .object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
  .strict();
export const importPlacementSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    destination: importDestinationSchema,
  })
  .strict();
export const importSuggestionsSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            files: z.array(z.uuid()).min(1).max(25),
            destination: z.array(z.uuid()).max(1),
            name: z.array(z.string().trim().min(1).max(100)).max(1),
            reason: z.string().min(1).max(300),
            evidence: z.array(summaryEvidenceSchema).max(6),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
export type ImportBatch = {
  id: string;
  version: number;
  status: string;
  taskId: string | null;
  expiresAt: string;
  files: {
    id: string;
    filename: string;
    bytes: number;
    status: string;
    error: string | null;
    pages: number | null;
    emptyPages: number[];
    originalReady: boolean;
  }[];
  notes: {
    id: string;
    fileId: string;
    ordinal: number;
    content: string;
    included: boolean;
    destination: ImportDestination;
    suggestion: string | null;
    pageStart: number;
    pageEnd: number;
    memoryId: string | null;
  }[];
  next: string | null;
  total: number;
  imported: number;
  selected: number;
  newNotebooks: number;
};
