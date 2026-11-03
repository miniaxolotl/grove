import { z } from "zod";
import { uuidSchema, type Notebook } from "@lib/shared/contracts";

export const notebookCatalogSchema = z
  .object({
    status: z.enum(["active", "archived"]).default("active"),
    limit: z.coerce.number().int().min(1).max(200).default(200),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
export type NotebookCatalogInput = z.input<typeof notebookCatalogSchema>;
export type NotebookCatalog = {
  items: Notebook[];
  state: string;
  nextCursor: string | null;
};
export const organizeNotebookSchema = z
  .object({
    operationId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    expectedState: z.string().regex(/^[a-f0-9]{64}$/),
    parentId: uuidSchema.nullable(),
    beforeId: uuidSchema.optional(),
    afterId: uuidSchema.optional(),
  })
  .strict()
  .refine((input) => !(input.beforeId && input.afterId), {
    message: "Choose before or after, not both",
  });
export type OrganizeNotebook = z.infer<typeof organizeNotebookSchema>;
export type NotebookOrganization = {
  project: Notebook;
  state: string;
  undo: Pick<OrganizeNotebook, "parentId" | "beforeId" | "afterId">;
};
