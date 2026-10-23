import { z } from "zod";
import { operationSchema, type Notebook } from "@lib/shared/contracts";

export const notebookLifecycleSchema = z
  .object({
    operationId: operationSchema,
    expectedVersion: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type NotebookLifecycleInput = z.infer<typeof notebookLifecycleSchema>;
export type NotebookLifecycleAction = "archive" | "restore" | "delete";
export type NotebookLifecyclePreview = {
  project: Notebook;
  projectIds: string[];
  notebooks: number;
  notes: number;
  fingerprint: string;
  canRestore: boolean;
};
export type NotebookLifecycleResult = {
  action: NotebookLifecycleAction;
  projectIds: string[];
};
